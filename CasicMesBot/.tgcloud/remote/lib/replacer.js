import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { injectLinkAndShiftEntities, truncateTextAndEntities } from './utils.js';
import { getMainMenuKb } from './menus.js';

const delay = ms => new Promise(res => setTimeout(res, ms));

function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m} мин ${s} сек`;
  return `${s} сек`;
}

function getProgressBar(current, total, width = 10) {
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
      text: "❌ В канале не найдено активных сообщений.",
      reply_markup: getMainMenuKb()
    });
    return;
  }

  let sortedIds = [...targetIds].sort((a, b) => a - b);

  let finalIds = sortedIds;
  if (rangeType === 'last_x') {
    finalIds = sortedIds.slice(-rangeStartX);
  } else if (rangeType === 'first_x') {
    finalIds = sortedIds.slice(0, rangeStartX);
  } else if (rangeType === 'x_to_y') {
    const startIdx = Math.max(0, rangeStartX - 1);
    const endIdx = rangeEndY;
    finalIds = sortedIds.slice(startIdx, endIdx);
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
  const startTime = Date.now();

  const updateStatus = async () => {
    try {
      const pct = ((checkedCount / totalTarget) * 100).toFixed(0);
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
              `🔄 Обработано: <b>${checkedCount} / ${totalTarget}</b>\n` +
              `✅ Успешно заменено: <b>${editedCount}</b>\n` +
              `⏳ Осталось: <b>${etaStr}</b>`,
        parse_mode: 'HTML'
      });
    } catch (e) {}
  };

  await updateStatus();

  const CONCURRENCY = 15;
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
          success = true;
        } catch (err) {
          const errMsg = err.description ? err.description.toLowerCase() : String(err).toLowerCase();

          if (errMsg.includes('message is not modified')) {
             editedCount++;
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
              success = true;
            } catch (e) {
               if (String(e).toLowerCase().includes('not modified')) editedCount++;
               success = true;
            }
          } else if (errMsg.includes('too many requests') || errMsg.includes('retry after')) {
             const retryAfter = err.parameters?.retry_after || 2;
             await delay((retryAfter * 1000) + 300);
             attempt++;
          } else {
             success = true;
          }
        }
      }
      checkedCount++;
    });

    await Promise.all(tasks);

    if (Date.now() - lastUpdate > 2000 || checkedCount === totalTarget) {
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
          `✅ Изменено: <b>${editedCount}</b> из ${totalTarget}\n` +
          `⏱ Затрачено: <b>${formatTime(Date.now() - startTime)}</b>\n\n` +
          `Главное меню:`,
    parse_mode: 'HTML',
    reply_markup: getMainMenuKb()
  });
}
