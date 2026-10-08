import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb, getRangeMenuKb } from '../lib/menus.js';
import { runReplacementTask } from '../lib/replacer.js';
import { fetchExistingPostsWeb } from '../lib/webParser.js';

export default async function (cb) {
  const adminId = cb.from.id;
  const data = cb.data;

  let state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) return;

  const renderMainMenu = async (textPrefix = "") => {
    // Generate human-readable info
    let info = textPrefix ? `${textPrefix}\n\n` : "⚙️ <b>Панель управления</b>\n\n";
    info += `📢 Канал: <b>${state.channelTitle || "Не выбран"}</b>\n`;
    info += `📝 Шаблон: <b>${state.templateText ? "Задан ✅" : "Нет ❌"}</b>\n`;
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

  try {
    if (data === 'cancel_state') {
      await db.update(states).set({ step: 'idle' }).where(eq(states.adminId, adminId)).run();
      state = await db.select().from(states).where(eq(states.adminId, adminId)).get(); // Reload state
      await renderMainMenu();
    }
    else if (data === 'set_template') {
      await db.update(states).set({ step: 'wait_template' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "📝 <b>Отправьте текст для замены.</b>\n\nВы можете использовать премиум-эмодзи и форматирование. Если хотите подставлять разные ссылки, используйте в тексте слово <code>{link}</code>.",
        parse_mode: 'HTML',
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'select_channel') {
      await db.update(states).set({ step: 'wait_channel' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "📢 <b>Перешлите любой пост из канала</b>, в котором хотите менять сообщения (бот должен быть там администратором).",
        parse_mode: 'HTML',
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'upload_links') {
      await db.update(states).set({ step: 'wait_links' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "📄 <b>Отправьте .txt файл</b>, где каждая ссылка с новой строки.\nОни будут подставляться на место <code>{link}</code> по кругу.",
        parse_mode: 'HTML',
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'range_menu') {
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "Выберите, какие сообщения заменять:",
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
        text: "🔢 Введите число X (сколько ПЕРВЫХ сообщений заменить):",
        reply_markup: getCancelKb()
      });
    }
    else if (data === 'range_last_x') {
      await db.update(states).set({ step: 'wait_range_last_x' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "🔢 Введите число X (сколько ПОСЛЕДНИХ сообщений заменить):",
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
        await api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Вы не выбрали канал!", show_alert: true });
        return;
      }
      if (!state.templateText) {
        await api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Вы не задали шаблон текста!", show_alert: true });
        return;
      }
      if (state.templateText.includes('{link}') && (!state.links || state.links.length === 0)) {
        await api.answerCallbackQuery({ callback_query_id: cb.id, text: "❌ Шаблон содержит {link}, но ссылки не загружены!", show_alert: true });
        return;
      }

      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "⚡️ Запуск подготовки...\nПарсю активные сообщения канала..."
      });
      await api.answerCallbackQuery({ callback_query_id: cb.id });

      let targetIds = state.targetIds;
      if (!targetIds || targetIds.length === 0) {
        if (state.channelUsername) {
           targetIds = await fetchExistingPostsWeb(state.channelUsername);
        } else {
           // Fallback dummy probe
           let latestId = 0;
           try {
             const dummy = await api.sendMessage({ chat_id: state.channelId, text: "." });
             latestId = dummy.message_id;
             await api.deleteMessage({ chat_id: state.channelId, message_id: latestId });
           } catch (e) {}
           targetIds = [];
           for (let i = latestId; i > Math.max(0, latestId - 1000); i--) targetIds.push(i);
        }
        await db.update(states).set({ targetIds }).where(eq(states.adminId, adminId)).run();
      }

      await runReplacementTask(adminId, cb.message.chat.id, cb.message.message_id).catch(console.error);
    }

    if (data !== 'start_replacement') {
      await api.answerCallbackQuery({ callback_query_id: cb.id });
    }
  } catch (err) {
    if (!err.message || (!err.message.includes('message is not modified') && !err.message.includes('query is too old'))) {
      console.error(err);
    }
  }
}
