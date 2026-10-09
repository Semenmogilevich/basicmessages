import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb, getRangeMenuKb } from '../lib/menus.js';
import { runReplacementTask } from '../lib/replacer.js';
import { getActivePostIds } from '../lib/webParser.js';

export default async function (cb) {
  const adminId = cb.from.id;
  const data = cb.data;

  let state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) return;

  const renderMainMenu = async (textPrefix = "") => {
    let info = textPrefix ? `${textPrefix}\n\n` : "⚙️ <b>Панель управления</b>\n\n";
    info += `📢 Канал: <b>${state.channelTitle || "Не выбран"}</b>`;
    if (state.targetIds) info += ` <i>(Активных постов: ${state.targetIds.length})</i>`;
    info += `\n📝 Шаблон: <b>${state.templateText || state.templatePhoto ? "Задан ✅" : "Нет ❌"}</b> `;
    if (state.templatePhoto) info += `<i>(с фото 🖼)</i>`;
    info += "\n";

    if (state.templateText && state.templateText.includes('{link}')) {
      info += `🔗 Ссылок загружено: <b>${state.links ? state.links.length : 0}</b>\n`;
    }

    let rangeStr = "Все";
    if (state.rangeType === 'first_x') rangeStr = `Первые ${state.rangeStartX}`;
    else if (state.rangeType === 'last_x') rangeStr = `Последние ${state.rangeStartX}`;
    else if (state.rangeType === 'x_to_y') rangeStr = `С ${state.rangeStartX} по ${state.rangeEndY}`;
    info += `📊 Диапазон: <b>${rangeStr}</b>\n`;

    await api.editMessageText({
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: info,
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
  };

  const runParserAndSave = async (chatId, msgId, channelId) => {
      const startTime = Date.now();
      const onProgress = async (found, checked, total) => {
         if (checked % 20 === 0 || checked === total) {
           const pct = ((checked/total)*100).toFixed(0);

           let etaStr = "Вычисляется...";
           if (checked > 0) {
              const elapsed = Date.now() - startTime;
              const msPerItem = elapsed / checked;
              const remaining = total - checked;
              const s = Math.ceil((remaining * msPerItem) / 1000);
              const m = Math.floor(s / 60);
              const sec = s % 60;
              etaStr = m > 0 ? `${m} мин ${sec} сек` : `${sec} сек`;
           }

           await api.editMessageText({
              chat_id: chatId,
              message_id: msgId,
              text: `🔍 <b>Считаю активные сообщения...</b>\n\nПроверено: <b>${checked}</b> из <b>${total}</b> (${pct}%)\nНайдено живых: <b>${found}</b>\n⏳ Осталось времени: <b>${etaStr}</b>`,
              parse_mode: 'HTML'
           }).catch(()=>{});
         }
      };
      const targetIds = await getActivePostIds(channelId, adminId, 400, onProgress);
      await db.update(states).set({ targetIds }).where(eq(states.adminId, adminId)).run();
      state.targetIds = targetIds;
      return targetIds;
  };

  try {
    if (data === 'cancel_state') {
      await db.update(states).set({ step: 'idle' }).where(eq(states.adminId, adminId)).run();
      state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
      await renderMainMenu();
    }
    else if (data === 'set_template') {
      await db.update(states).set({ step: 'wait_template' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "📝 <b>Отправьте текст или фото с подписью.</b>\n\nВы можете использовать премиум-эмодзи и форматирование. Для замены разных ссылок используйте слово <code>{link}</code>.",
        parse_mode: 'HTML',
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'select_channel') {
      await db.update(states).set({ step: 'wait_channel' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "📢 <b>Отправьте канал:</b>\n\n- Перешлите пост из канала\n- Пришлите ссылку (https://t.me/channel)\n- Пришлите username (@channel)\n- Пришлите ID (-100...)",
        parse_mode: 'HTML',
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'upload_links') {
      await db.update(states).set({ step: 'wait_links' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "📄 <b>Отправьте .txt файл</b>, где каждая ссылка с новой строки.\nОни будут подставляться на место <code>{link}</code>.",
        parse_mode: 'HTML',
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'use_old_links') {
       await db.update(states).set({ step: 'idle' }).where(eq(states.adminId, adminId)).run();
       await renderMainMenu("✅ Оставлены старые ссылки.");
    }
    else if (data === 'recalc_posts') {
       if (!state.channelId) {
         return api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Вы не выбрали канал!", show_alert: true });
       }
       await api.editMessageText({
         chat_id: cb.message.chat.id,
         message_id: cb.message.message_id,
         text: "🔍 Подготовка к парсингу..."
       });
       await api.answerCallbackQuery({ callback_query_id: cb.id });
       try {
         await runParserAndSave(cb.message.chat.id, cb.message.message_id, state.channelId);
         await renderMainMenu(`✅ Активные посты пересчитаны!`);
       } catch (e) {
         await renderMainMenu(`❌ Ошибка подсчета: ${e.message || e}`);
       }
    }
    else if (data === 'range_menu') {
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "Выберите, какие сообщения заменять (по их реальным порядковым номерам):",
        reply_markup: getRangeMenuKb()
      });
    }
    else if (data === 'range_all') {
      await db.update(states).set({ rangeType: 'all', step: 'idle' }).where(eq(states.adminId, adminId)).run();
      state.rangeType = 'all';
      await renderMainMenu("✅ Выбрано: Все сообщения");
    }
    else if (data === 'range_first_x') {
      await db.update(states).set({ step: 'wait_range_first_x' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "🔢 Сколько ПЕРВЫХ сообщений заменить (начиная с самых старых)?",
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'range_last_x') {
      await db.update(states).set({ step: 'wait_range_last_x' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "🔢 Сколько ПОСЛЕДНИХ сообщений заменить (начиная с самых новых)?",
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'range_x_to_y') {
      await db.update(states).set({ step: 'wait_range_x_to_y' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "🔢 Введите два числа через пробел (например, 10 50):",
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'start_replacement') {
      if (!state.channelId) {
        return api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Вы не выбрали канал!", show_alert: true });
      }
      if (!state.templateText && !state.templatePhoto) {
        return api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Вы не задали шаблон текста/фото!", show_alert: true });
      }
      if (state.templateText && state.templateText.includes('{link}') && (!state.links || state.links.length === 0)) {
        return api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Шаблон содержит {link}, но ссылки не загружены!", show_alert: true });
      }

      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "⚡️ Подготовка к замене..."
      });
      await api.answerCallbackQuery({ callback_query_id: cb.id });

      let targetIds = state.targetIds;
      if (!targetIds || targetIds.length === 0) {
        try {
          await api.editMessageText({
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: "⚡️ Подготовка...\n\nСчитаю живые посты канала..."
          });
          await runParserAndSave(cb.message.chat.id, cb.message.message_id, state.channelId);
        } catch (e) {
          await api.editMessageText({
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: `❌ Ошибка парсинга канала:\n${e.message || e}`,
            reply_markup: getMainMenuKb()
          });
          return;
        }
      }

      await runReplacementTask(adminId, cb.message.chat.id, cb.message.message_id).catch(console.error);
    }

    if (data !== 'start_replacement' && data !== 'recalc_posts') {
      await api.answerCallbackQuery({ callback_query_id: cb.id }).catch(()=>{});
    }
  } catch (err) {
    if (!err.message || (!err.message.includes('message is not modified') && !err.message.includes('query is too old'))) {
      console.error(err);
    }
  }
}
