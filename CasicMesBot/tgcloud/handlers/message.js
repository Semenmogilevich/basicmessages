import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb } from '../lib/menus.js';

export default async function (message) {
  const adminId = message.from.id;

  let state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) {
    state = { adminId, step: 'idle' };
    await db.insert(states).values(state).run();
  }

  const renderMainMenu = async (textPrefix = "") => {
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

    await api.sendMessage({
      chat_id: adminId,
      text: info,
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
  };

  if (message.text === '/start') {
    await db.update(states).set({ step: 'idle' }).where(eq(states.adminId, adminId)).run();
    await api.sendMessage({
      chat_id: adminId,
      text: "👋 <b>Добро пожаловать!</b>\n\nЯ умею массово менять посты в каналах на высокой скорости. Вы можете использовать плейсхолдер <code>{link}</code> в тексте, и я буду подставлять туда ссылки из txt-файла по кругу.\n\nЧто будем делать?",
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
    return;
  }

  if (state.step === 'wait_template') {
    const text = message.text || message.caption;
    if (!text) {
      await api.sendMessage({ chat_id: adminId, text: "Отправьте текст (можно с премиум-эмодзи)." });
      return;
    }

    const entities = message.entities || message.caption_entities || [];
    await db.update(states)
      .set({
        step: 'idle',
        templateText: text,
        templateEntities: entities
      })
      .where(eq(states.adminId, adminId)).run();
    state.templateText = text;
    await renderMainMenu("✅ <b>Шаблон сохранен!</b> Эмодзи и форматирование учтены.");
  }
  else if (state.step === 'wait_channel') {
    if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
      const channelId = message.forward_from_chat.id.toString();
      const channelTitle = message.forward_from_chat.title;
      const channelUsername = message.forward_from_chat.username || null;

      await db.update(states)
        .set({
          step: 'idle',
          channelId: channelId,
          channelTitle: channelTitle,
          channelUsername: channelUsername,
          targetIds: null // reset cached ids
        })
        .where(eq(states.adminId, adminId)).run();
      state.channelTitle = channelTitle;
      await renderMainMenu(`✅ <b>Канал выбран:</b> ${channelTitle}`);
    } else {
      await api.sendMessage({
        chat_id: adminId,
        text: "❌ Перешлите пост из канала, в котором бот является администратором с правом редактирования.",
        reply_markup: getCancelKb()
      });
    }
  }
  else if (state.step === 'wait_links') {
    if (!message.document || !message.document.file_name.endsWith('.txt')) {
      await api.sendMessage({ chat_id: adminId, text: "❌ Пожалуйста, отправьте файл формата .txt", reply_markup: getCancelKb() });
      return;
    }

    try {
      const bytes = await api.getFileContent(message.document.file_id);
      const decoder = new TextDecoder('utf-8');
      const lines = decoder.decode(bytes).split('\n').map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length === 0) {
        await api.sendMessage({ chat_id: adminId, text: "Файл пуст.", reply_markup: getCancelKb() });
        return;
      }

      await db.update(states)
        .set({ step: 'idle', links: lines, linkIndex: 0 })
        .where(eq(states.adminId, adminId)).run();

      state.links = lines;
      await renderMainMenu(`✅ <b>Файл загружен!</b>\nНайдено ссылок: <b>${lines.length}</b>.`);
    } catch (err) {
      await api.sendMessage({ chat_id: adminId, text: "❌ Ошибка при скачивании файла.", reply_markup: getCancelKb() });
    }
  }
  else if (state.step.startsWith('wait_range_')) {
    const text = (message.text || "").trim();
    if (state.step === 'wait_range_first_x' || state.step === 'wait_range_last_x') {
      const num = parseInt(text);
      if (isNaN(num) || num <= 0) {
        await api.sendMessage({ chat_id: adminId, text: "❌ Введите корректное положительное число.", reply_markup: getCancelKb() });
        return;
      }
      const rType = state.step === 'wait_range_first_x' ? 'first_x' : 'last_x';
      await db.update(states).set({ step: 'idle', rangeType: rType, rangeStartX: num }).where(eq(states.adminId, adminId)).run();
      state.rangeType = rType; state.rangeStartX = num;
      await renderMainMenu(`✅ Диапазон обновлен.`);
    } else if (state.step === 'wait_range_x_to_y') {
      const parts = text.split(/\s+/).map(x => parseInt(x));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[0] <= 0 || parts[1] <= 0 || parts[0] > parts[1]) {
         await api.sendMessage({ chat_id: adminId, text: "❌ Введите два числа через пробел (X Y), где X <= Y.", reply_markup: getCancelKb() });
         return;
      }
      await db.update(states).set({ step: 'idle', rangeType: 'x_to_y', rangeStartX: parts[0], rangeEndY: parts[1] }).where(eq(states.adminId, adminId)).run();
      state.rangeType = 'x_to_y'; state.rangeStartX = parts[0]; state.rangeEndY = parts[1];
      await renderMainMenu(`✅ Диапазон обновлен.`);
    }
  }
}
