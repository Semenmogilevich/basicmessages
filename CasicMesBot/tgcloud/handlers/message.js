import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb } from '../lib/menus.js';

export default async function (message) {
  const adminId = message.from.id;

  // Create or fetch admin state
  let state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) {
    state = { adminId, step: 'idle' };
    await db.insert(states).values(state).run();
  }

  // Handle /start or cancellation
  if (message.text === '/start') {
    await db.update(states).set({ step: 'idle' }).where(eq(states.adminId, adminId)).run();
    await api.sendMessage({
      chat_id: adminId,
      text: "👋 <b>Добро пожаловать в панель управления заменой!</b>\n\nЯ умею массово менять посты в каналах на высокой скорости. Вы можете использовать плейсхолдер <code>{link}</code> в тексте, и я буду подставлять туда ссылки из txt-файла по кругу.\n\nЧто будем делать?",
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
    return;
  }

  // FSM Routing
  if (state.step === 'wait_template') {
    const text = message.text || message.caption;
    if (!text) {
      await api.sendMessage({ chat_id: adminId, text: "Отправьте текст (можно с премиум-эмодзи)." });
      return;
    }

    // Save text and entities
    const entities = message.entities || message.caption_entities || [];
    await db.update(states)
      .set({
        step: 'idle',
        templateText: text,
        templateEntities: entities
      })
      .where(eq(states.adminId, adminId)).run();

    await api.sendMessage({
      chat_id: adminId,
      text: "✅ <b>Шаблон сохранен!</b> Эмодзи и форматирование учтены.",
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
  }
  else if (state.step === 'wait_channel') {
    // If user forwards a message from a channel
    if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
      const channelId = message.forward_from_chat.id.toString();
      const channelTitle = message.forward_from_chat.title;

      await db.update(states)
        .set({
          step: 'idle',
          channelId: channelId,
          channelTitle: channelTitle
        })
        .where(eq(states.adminId, adminId)).run();

      await api.sendMessage({
        chat_id: adminId,
        text: `✅ <b>Канал выбран:</b> ${channelTitle}`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKb()
      });
    } else {
      await api.sendMessage({
        chat_id: adminId,
        text: "❌ Перешлите пост из канала, в котором бот является администратором с правом редактирования.",
        reply_markup: getCancelKb()
      });
    }
  }
  else if (state.step === 'wait_links') {
    if (!message.document) {
      await api.sendMessage({ chat_id: adminId, text: "Пожалуйста, отправьте файл формата .txt", reply_markup: getCancelKb() });
      return;
    }

    if (!message.document.file_name.endsWith('.txt')) {
      await api.sendMessage({ chat_id: adminId, text: "Файл должен иметь расширение .txt", reply_markup: getCancelKb() });
      return;
    }

    // Download file
    try {
      const bytes = await api.getFileContent(message.document.file_id);
      const decoder = new TextDecoder('utf-8');
      const content = decoder.decode(bytes);

      const lines = content.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      if (lines.length === 0) {
        await api.sendMessage({ chat_id: adminId, text: "Файл пуст или содержит только пробелы.", reply_markup: getCancelKb() });
        return;
      }

      await db.update(states)
        .set({
          step: 'idle',
          links: lines,
          linkIndex: 0
        })
        .where(eq(states.adminId, adminId)).run();

      await api.sendMessage({
        chat_id: adminId,
        text: `✅ <b>Файл загружен!</b>\nНайдено ссылок: <b>${lines.length}</b>.\nОни будут подставляться по кругу вместо <code>{link}</code>.`,
        parse_mode: 'HTML',
        reply_markup: getMainMenuKb()
      });
    } catch (err) {
      console.error(err);
      await api.sendMessage({ chat_id: adminId, text: "❌ Ошибка при скачивании файла.", reply_markup: getCancelKb() });
    }
  }
}
