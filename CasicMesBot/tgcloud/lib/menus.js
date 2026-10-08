export function getMainMenuKb() {
  return {
    inline_keyboard: [
      [{ text: "📝 Задать шаблон текста", callback_data: "set_template" }],
      [{ text: "📢 Выбрать канал", callback_data: "select_channel" }],
      [{ text: "📄 Загрузить ссылки (.txt)", callback_data: "upload_links" }],
      [{ text: "🚀 Запустить замену", callback_data: "start_replacement" }]
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
