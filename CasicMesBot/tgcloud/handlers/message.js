import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb, getUsePreviousLinksKb } from '../lib/menus.js';
import { getActivePostIds } from '../lib/webParser.js';

export default async function (message) {
  const adminId = message.from.id;

  let state = await db.select().from(states).where(eq(states.adminId, adminId)).get();
  if (!state) {
    state = { adminId, step: 'idle' };
    await db.insert(states).values(state).run();
  }

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
      text: "👋 <b>Добро пожаловать!</b>\n\nЯ заменяю тексты и фото в каналах. Поддерживаю премиум эмодзи, форматирование и динамическую подстановку <code>{link}</code> из txt-файла.",
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
    return;
  }

  if (state.step === 'wait_template') {
    const text = message.text || message.caption || "";
    const entities = message.entities || message.caption_entities || [];

    let photoId = null;
    if (message.photo && message.photo.length > 0) {
      photoId = message.photo[message.photo.length - 1].file_id;
    }

    if (!text && !photoId) {
      return api.sendMessage({ chat_id: adminId, text: "Отправьте текст или фото." });
    }

    await db.update(states)
      .set({
        step: 'idle',
        templateText: text,
        templatePhoto: photoId,
        templateEntities: entities
      })
      .where(eq(states.adminId, adminId)).run();
    state.templateText = text;
    state.templatePhoto = photoId;

    if (text.includes('{link}') && state.links && state.links.length > 0) {
       await api.sendMessage({
         chat_id: adminId,
         text: `✅ <b>Шаблон сохранен!</b> Эмодзи и фото учтены.\n\nУ вас уже загружены ${state.links.length} ссылок из прошлого файла. Использовать их?`,
         parse_mode: 'HTML',
         reply_markup: getUsePreviousLinksKb()
       });
    } else {
       await renderMainMenu("✅ <b>Шаблон сохранен!</b> Эмодзи, форматирование и фото учтены.");
    }
  }
  else if (state.step === 'wait_channel') {
    let channelId = null;
    let channelUsername = null;

    if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
      channelId = message.forward_from_chat.id.toString();
      channelUsername = message.forward_from_chat.username || null;
    } else if (message.text) {
      const txt = message.text.trim();
      if (txt.startsWith('-100')) {
        channelId = txt;
      } else if (txt.startsWith('@')) {
        channelUsername = txt.substring(1);
        channelId = '@' + channelUsername;
      } else if (txt.includes('t.me/')) {
        channelUsername = txt.split('t.me/')[1].split('/')[0];
        channelId = '@' + channelUsername;
      }
    }

    if (!channelId && !channelUsername) {
      return api.sendMessage({ chat_id: adminId, text: "❌ Не удалось распознать канал. Перешлите пост, отправьте ссылку или ID.", reply_markup: getCancelKb() });
    }

    const waitMsg = await api.sendMessage({ chat_id: adminId, text: "🔍 Проверяю канал..." });

    try {
      const chatInfo = await api.getChat({ chat_id: channelId || channelUsername });
      const realId = chatInfo.id.toString();
      const realUsername = chatInfo.username || channelUsername;
      const title = chatInfo.title || realId;

      await api.editMessageText({ chat_id: adminId, message_id: waitMsg.message_id, text: "🔍 Считаю активные посты канала..." });

      let targetIds = await getActivePostIds(realId, adminId);

      await db.update(states)
        .set({
          step: 'idle',
          channelId: realId,
          channelTitle: title,
          channelUsername: realUsername,
          targetIds: targetIds.length > 0 ? targetIds : null
        })
        .where(eq(states.adminId, adminId)).run();

      state.channelTitle = title;
      state.targetIds = targetIds.length > 0 ? targetIds : null;

      await renderMainMenu(`✅ <b>Канал выбран!</b> Найдено активных постов: ${targetIds.length}`);
    } catch (e) {
       await api.editMessageText({ chat_id: adminId, message_id: waitMsg.message_id, text: `❌ Ошибка: бот не является админом в этом канале или канал не существует.\n\nДетали: ${e.message || e}`});
    }
  }
  else if (state.step === 'wait_links') {
    if (!message.document || !message.document.file_name.endsWith('.txt')) {
      return api.sendMessage({ chat_id: adminId, text: "❌ Пожалуйста, отправьте файл формата .txt", reply_markup: getCancelKb() });
    }

    try {
      const bytes = await api.getFileContent(message.document.file_id);
      const decoder = new TextDecoder('utf-8');
      const lines = decoder.decode(bytes).split('\n').map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length === 0) {
        return api.sendMessage({ chat_id: adminId, text: "Файл пуст.", reply_markup: getCancelKb() });
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
        return api.sendMessage({ chat_id: adminId, text: "❌ Введите корректное положительное число.", reply_markup: getCancelKb() });
      }
      const rType = state.step === 'wait_range_first_x' ? 'first_x' : 'last_x';
      await db.update(states).set({ step: 'idle', rangeType: rType, rangeStartX: num }).where(eq(states.adminId, adminId)).run();
      state.rangeType = rType; state.rangeStartX = num;
      await renderMainMenu(`✅ Диапазон обновлен.`);
    } else if (state.step === 'wait_range_x_to_y') {
      const parts = text.split(/\s+/).map(x => parseInt(x));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[0] <= 0 || parts[1] <= 0 || parts[0] > parts[1]) {
         return api.sendMessage({ chat_id: adminId, text: "❌ Введите два числа через пробел (X Y), где X <= Y.", reply_markup: getCancelKb() });
      }
      await db.update(states).set({ step: 'idle', rangeType: 'x_to_y', rangeStartX: parts[0], rangeEndY: parts[1] }).where(eq(states.adminId, adminId)).run();
      state.rangeType = 'x_to_y'; state.rangeStartX = parts[0]; state.rangeEndY = parts[1];
      await renderMainMenu(`✅ Диапазон обновлен.`);
    }
  }
}
