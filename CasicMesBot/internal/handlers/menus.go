package handlers

import (
	tele "gopkg.in/telebot.v3"
)

var (
	MenuMain = &tele.ReplyMarkup{}
	BtnChannel = MenuMain.Data("📢 Выбрать канал", "select_channel")
	BtnTemplate = MenuMain.Data("📝 Шаблон текста/фото", "set_template")
	BtnLinks = MenuMain.Data("📄 Загрузить ссылки (.txt)", "upload_links")
	BtnRange = MenuMain.Data("⚙️ Диапазон сообщений", "range_menu")
	BtnStart = MenuMain.Data("🚀 ЗАПУСТИТЬ", "start_replacement")

	MenuRange = &tele.ReplyMarkup{}
	BtnRangeAll = MenuRange.Data("Все сообщения", "range_all")
	BtnRangeFirst = MenuRange.Data("Первые X", "range_first_x")
	BtnRangeLast = MenuRange.Data("Последние X", "range_last_x")
	BtnRangeXY = MenuRange.Data("От X до Y", "range_x_to_y")
	BtnRangeBack = MenuRange.Data("◀️ Назад", "cancel_state")

	MenuCancel = &tele.ReplyMarkup{}
	BtnCancel = MenuCancel.Data("❌ Отмена", "cancel_state")

	MenuLinks = &tele.ReplyMarkup{}
	BtnLinksOld = MenuLinks.Data("✅ Использовать старые ссылки", "use_old_links")
	BtnLinksNew = MenuLinks.Data("🆕 Загрузить новые", "upload_links")

	MenuOwner = &tele.ReplyMarkup{}
	BtnOwnerStats = MenuOwner.Data("📊 Статистика бота", "owner_stats")
)

func init() {
	MenuMain.Inline(
		MenuMain.Row(BtnChannel),
		MenuMain.Row(BtnTemplate),
		MenuMain.Row(BtnLinks),
		MenuMain.Row(BtnRange),
		MenuMain.Row(BtnStart),
	)

	MenuRange.Inline(
		MenuRange.Row(BtnRangeAll),
		MenuRange.Row(BtnRangeFirst, BtnRangeLast),
		MenuRange.Row(BtnRangeXY),
		MenuRange.Row(BtnRangeBack),
	)

	MenuCancel.Inline(MenuCancel.Row(BtnCancel))
	MenuLinks.Inline(MenuLinks.Row(BtnLinksOld), MenuLinks.Row(BtnLinksNew))
}
