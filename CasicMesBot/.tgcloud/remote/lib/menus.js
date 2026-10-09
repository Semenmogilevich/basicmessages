export function getMainMenuKb() {
  return {
    inline_keyboard: [
      [{ text: "📢 Выбрать канал", callback_data: "select_channel" }, { text: "🔄 Пересчитать посты", callback_data: "recalc_posts" }],
      [{ text: "📝 Шаблон текста/фото", callback_data: "set_template" }],
      [{ text: "📄 Загрузить ссылки (.txt)", callback_data: "upload_links" }],
      [{ text: "⚙️ Диапазон сообщений", callback_data: "range_menu" }],
      [{ text: "🚀 ЗАПУСТИТЬ", callback_data: "start_replacement" }]
    ]
  };
}

export function getRangeMenuKb() {
  return {
    inline_keyboard: [
      [{ text: "Все сообщения", callback_data: "range_all" }],
      [{ text: "Первые X", callback_data: "range_first_x" }, { text: "Последние X", callback_data: "range_last_x" }],
      [{ text: "От X до Y", callback_data: "range_x_to_y" }],
      [{ text: "◀️ Назад", callback_data: "cancel_state" }]
    ]
  };
}

export function getCancelKb() {
  return {
    inline_keyboard: [
      [{ text: "❌ Отмена", callback_data: "cancel_state" }]
    ]
  };
}

export function getUsePreviousLinksKb() {
  return {
    inline_keyboard: [
      [{ text: "✅ Использовать старые ссылки", callback_data: "use_old_links" }],
      [{ text: "🆕 Загрузить новые", callback_data: "upload_links" }]
    ]
  };
}
