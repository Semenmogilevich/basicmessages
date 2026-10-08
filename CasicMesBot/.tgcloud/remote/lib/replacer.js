import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { injectLinkAndShiftEntities, truncateTextAndEntities } from './utils.js';
import { getMainMenuKb } from './menus.js';

const delay = ms => new Promise(res => setTimeout(res, ms));

export async function runReplacementTask(adminId, statusChatId, statusMsgId) {
  const state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) return;

  const { channelId, templateText, templateEntities, links } = state;
  let linkIndex = state.linkIndex || 0;

  let editedCount = 0;
  let checkedCount = 0;

  const updateStatus = async (msg) => {
    try {
      await api.editMessageText({
        chat_id: statusChatId,
        message_id: statusMsgId,
        text: msg,
        parse_mode: 'HTML'
      });
    } catch (e) {
      // Ignore not modified
    }
  };

  await updateStatus("🔍 Получаю список постов канала...");

  let latestId = 0;
  try {
    const dummy = await api.sendMessage({ chat_id: channelId, text: "." });
    latestId = dummy.message_id;
    await api.deleteMessage({ chat_id: channelId, message_id: latestId });
  } catch (err) {
    await updateStatus("❌ Ошибка: бот не может писать в канал. Выдайте права администратора.");
    await delay(3000);
    await updateStatus("Главное меню:", { reply_markup: getMainMenuKb() });
    return;
  }

  // Support full scan up to a massive depth if needed, but typically channels don't have 10M messages.
  const MAX_DEPTH = 50000;
  let targetIds = [];
  for (let i = latestId; i > Math.max(0, latestId - MAX_DEPTH); i--) {
    targetIds.push(i);
  }

  const totalTarget = targetIds.length;
  await updateStatus(`🚀 Начинаю замену <b>до ${totalTarget}</b> возможных постов...`);

  // Using a smaller concurrency to reduce rate limit hits
  const CONCURRENCY = 10;

  for (let i = 0; i < targetIds.length; i += CONCURRENCY) {
    const batch = targetIds.slice(i, i + CONCURRENCY);

    const tasks = batch.map(async (msgId) => {
      let currentText = templateText;
      let currentEntities = templateEntities || [];

      if (currentText.includes('{link}') && links && links.length > 0) {
        const linkToUse = links[linkIndex % links.length];
        const res = injectLinkAndShiftEntities(currentText, currentEntities, linkToUse);
        currentText = res.text;
        currentEntities = res.entities;

        linkIndex++;
      }

      const { text: safeText, entities: safeEntities } = truncateTextAndEntities(currentText, currentEntities, 4096);

      // Robust retry logic
      let attempt = 0;
      let success = false;
      while (attempt < 5 && !success) {
        try {
          await api.editMessageText({
            chat_id: channelId,
            message_id: msgId,
            text: safeText,
            entities: safeEntities.length > 0 ? safeEntities : undefined,
            disable_web_page_preview: false
          });
          editedCount++;
          success = true;
        } catch (err) {
          const errMsg = err.description ? err.description.toLowerCase() : String(err).toLowerCase();

          if (errMsg.includes('message is not modified')) {
             editedCount++;
             success = true;
             break;
          }

          if (errMsg.includes('there is no text') || errMsg.includes('message is not a text message')) {
            try {
              const { text: capText, entities: capEntities } = truncateTextAndEntities(currentText, currentEntities, 1024);
              await api.editMessageCaption({
                chat_id: channelId,
                message_id: msgId,
                caption: capText,
                caption_entities: capEntities.length > 0 ? capEntities : undefined
              });
              editedCount++;
              success = true;
            } catch (e) {
               // likely message not modified
               if (String(e).toLowerCase().includes('not modified')) {
                  editedCount++;
               }
               success = true;
            }
          } else if (errMsg.includes('too many requests') || errMsg.includes('retry after')) {
             // Use API provided retry_after if available, else static
             const retryAfter = err.parameters?.retry_after || 2;
             await delay((retryAfter * 1000) + 500);
             attempt++;
          } else {
             // For messages that simply don't exist (e.g. deleted gaps) or other hard errors
             success = true;
          }
        }
      }
      checkedCount++;
    });

    await Promise.all(tasks);

    if (checkedCount % (CONCURRENCY * 5) === 0 || checkedCount === totalTarget) {
      const pct = ((checkedCount / totalTarget) * 100).toFixed(0);
      await updateStatus(
        `⚡️ <b>Замена постов...</b>\n\n` +
        `Проверено ID: <code>${checkedCount}/${totalTarget}</code> (${pct}%)\n` +
        `✅ Успешно заменено: <b>${editedCount}</b>`
      );
    }
  }

  await db.update(states)
    .set({ linkIndex: linkIndex % (links ? links.length : 1) })
    .where(eq(states.adminId, adminId)).run();

  await api.editMessageText({
    chat_id: statusChatId,
    message_id: statusMsgId,
    text: `🏁 <b>Замена завершена!</b>\n\n📢 Канал: <b>${state.channelTitle}</b>\n✅ Изменено постов: <b>${editedCount}</b>\n\nГлавное меню:`,
    parse_mode: 'HTML',
    reply_markup: getMainMenuKb()
  });
}
