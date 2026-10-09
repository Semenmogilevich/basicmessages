import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { states } from '../schema.js';
import { getMainMenuKb, getCancelKb, getUsePreviousLinksKb } from '../lib/menus.js';

const VERSION = "1.5";

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
    if (state.targetIds) info += ` <i>(Макс ID: ${state.targetIds.length > 0 ? Math.max(...state.targetIds) : 0})</i>`;
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
      text: `👋 <b>Добро пожаловать!</b> [Версия: v${VERSION}]\n\nЯ заменяю тексты и фото в каналах. Поддерживаю премиум эмодзи, форматирование и динамическую подстановку <code>{link}</code> из txt-файла.`,
      parse_mode: 'HTML',
      reply_markup: getMainMenuKb()
    });
    return;
  }

  // Rest of handler logic
}
