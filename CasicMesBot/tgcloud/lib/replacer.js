import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { injectLinkAndShiftEntities, truncateTextAndEntities } from './utils.js';
import { getMainMenuKb } from './menus.js';

function delay(ms) {
  const start = Date.now();
  while(Date.now() - start < ms) { }
}

function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m} мин ${s} сек`;
  return `${s} сек`;
}

function getProgressBar(current, total, width = 10) {
  if (total === 0) return '⬜️'.repeat(width);
  const progress = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(width * progress);
  const empty = width - filled;
  return '🟩'.repeat(filled) + '⬜️'.repeat(empty);
}

export async function runReplacementTask(adminId, statusChatId, statusMsgId) {
  const state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) return;

  const { channelId, templateText, templatePhoto, templateEntities, links, targetIds, rangeType, rangeStartX, rangeEndY } = state;
  let linkIndex = state.linkIndex || 0;

  if (!targetIds || targetIds.length === 0) {
    await api.editMessageText({
      chat_id: statusChatId,
      message_id: statusMsgId,
      text: "❌ Ошибка: Не удалось определить ID постов.",
      reply_markup: getMainMenuKb()
    });
    return;
  }

  // targetIds originally newest first. Sort oldest first.
  let sortedIds = [...targetIds].sort((a, b) => a - b);

  let finalIds = sortedIds;
  if (rangeType === 'last_x') {
    finalIds = sortedIds.slice(-rangeStartX);
  } else if (rangeType === 'first_x') {
    finalIds = sortedIds.slice(0, rangeStartX);
  } else if (rangeType === 'x_to_y') {
    // Treat inputs as ID bounds
    finalIds = sortedIds.filter(id => id >= rangeStartX && id <= rangeEndY);
  }

  if (finalIds.length === 0) {
     await api.editMessageText({
      chat_id: statusChatId,
      message_id: statusMsgId,
      text: "❌ В выбранном диапазоне нет сообщений.",
      reply_markup: getMainMenuKb()
    });
    return;
  }

  const totalTarget = finalIds.length;
  let editedCount = 0;
  let checkedCount = 0;
  let actualFound = 0; // True count of messages that actually existed and were touched
  const startTime = Date.now();

  const updateStatus = async () => {
    try {
      const pct = totalTarget > 0 ? ((checkedCount / totalTarget) * 100).toFixed(0) : 0;
      const bar = getProgressBar(checkedCount, totalTarget, 10);

      const elapsed = Date.now() - startTime;
      let etaStr = "Вычисляется...";
      if (checkedCount > 0) {
         const msPerItem = elapsed / checkedCount;
         const remaining = totalTarget - checkedCount;
         etaStr = formatTime(remaining * msPerItem);
      }

      await api.editMessageText({
        chat_id: statusChatId,
        message_id: statusMsgId,
        text: `⚡️ <b>Замена сообщений...</b>\n\n` +
              `${bar} ${pct}%\n\n` +
              `🔄 Проверено ID: <b>${checkedCount} / ${totalTarget}</b>\n` +
              `✅ Успешно заменено: <b>${editedCount}</b>\n` +
              `⏳ Осталось времени: <b>${etaStr}</b>`,
        parse_mode: 'HTML'
      });
    } catch (e) {}
  };

  await updateStatus();

  // Very high concurrency because we are skipping the parsing step!
  const CONCURRENCY = 20;
  let lastUpdate = Date.now();

  for (let i = 0; i < finalIds.length; i += CONCURRENCY) {
    const batch = finalIds.slice(i, i + CONCURRENCY);

    const tasks = batch.map(async (msgId) => {
      let currentText = templateText || "";
      let currentEntities = templateEntities || [];

      if (currentText.includes('{link}') && links && links.length > 0) {
        const linkToUse = links[linkIndex % links.length];
        const res = injectLinkAndShiftEntities(currentText, currentEntities, linkToUse);
        currentText = res.text;
        currentEntities = res.entities;

        // Atomically increment locally
        linkIndex++;
      }

      let attempt = 0;
      let success = false;

      while (attempt < 5 && !success) {
        try {
          if (templatePhoto) {
            const { text: capText, entities: capEntities } = truncateTextAndEntities(currentText, currentEntities, 1024);
            await api.editMessageMedia({
              chat_id: channelId,
              message_id: msgId,
              media: {
                type: 'photo',
                media: templatePhoto,
                caption: capText || undefined,
                caption_entities: capEntities.length > 0 ? capEntities : undefined
              }
            });
          } else {
            const { text: safeText, entities: safeEntities } = truncateTextAndEntities(currentText, currentEntities, 4096);
            await api.editMessageText({
              chat_id: channelId,
              message_id: msgId,
              text: safeText,
              entities: safeEntities.length > 0 ? safeEntities : undefined,
              disable_web_page_preview: false
            });
          }
          editedCount++;
          actualFound++;
          success = true;
        } catch (err) {
          const errMsg = err.description ? err.description.toLowerCase() : String(err).toLowerCase();

          if (errMsg.includes('message is not modified')) {
             editedCount++;
             actualFound++;
             success = true;
             break;
          }

          if ((errMsg.includes('there is no text') || errMsg.includes('message is not a text message')) && !templatePhoto) {
            try {
              const { text: capText, entities: capEntities } = truncateTextAndEntities(currentText, currentEntities, 1024);
              await api.editMessageCaption({
                chat_id: channelId,
                message_id: msgId,
                caption: capText || undefined,
                caption_entities: capEntities.length > 0 ? capEntities : undefined
              });
              editedCount++;
              actualFound++;
              success = true;
            } catch (e) {
               if (String(e).toLowerCase().includes('not modified')) {
                  editedCount++;
                  actualFound++;
               }
               success = true;
            }
          } else if (errMsg.includes('too many requests') || errMsg.includes('retry after')) {
             const retryAfter = err.parameters?.retry_after || 1;
             const startWait = Date.now();
             while(Date.now() - startWait < (retryAfter * 1000) + 100) { }
             attempt++;
          } else {
             // "message to edit not found" -> it was deleted. We just skip it silently!
             success = true;
          }
        }
      }
      checkedCount++;
    });

    await Promise.all(tasks);

    // Update status every ~1.5 seconds
    if (Date.now() - lastUpdate > 1500 || checkedCount === totalTarget) {
      await updateStatus();
      lastUpdate = Date.now();
    }
  }

  await db.update(states)
    .set({ linkIndex: linkIndex % (links ? links.length : 1), targetIds: null })
    .where(eq(states.adminId, adminId)).run();

  await api.editMessageText({
    chat_id: statusChatId,
    message_id: statusMsgId,
    text: `🏁 <b>Замена завершена!</b>\n\n` +
          `📢 Канал: <b>${state.channelTitle}</b>\n` +
          `✅ Успешно заменено: <b>${editedCount}</b>\n` +
          `👻 Удаленных/пропущено: <b>${totalTarget - actualFound}</b>\n` +
          `⏱ Затрачено: <b>${formatTime(Date.now() - startTime)}</b>\n\n` +
          `Главное меню:`,
    parse_mode: 'HTML',
    reply_markup: getMainMenuKb()
  });
}
