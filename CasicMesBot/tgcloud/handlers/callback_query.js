import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb } from '../lib/menus.js';
import { runReplacementTask } from '../lib/replacer.js';

export default async function (cb) {
  const adminId = cb.from.id;
  const data = cb.data;

  let state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) return;

  try {
    if (data === 'cancel_state') {
      await db.update(states).set({ step: 'idle' }).where(eq(states.adminId, adminId)).run();
      await api.editMessageText({
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "❌ Действие отменено.\n\nГлавное меню:",
        reply_markup: getMainMenuKb()
      });
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
        text: "⚡️ Запуск замены...\nЭто может занять время. Не выключайте бота."
      });
      await api.answerCallbackQuery({ callback_query_id: cb.id });

      // Because V8 isolate terminates on handler return, we must await the long-running task here.
      // Note: V8 sandboxes might time out if running for too long depending on provider limits,
      // but waiting for the promise guarantees execution won't be prematurely cancelled immediately.
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
