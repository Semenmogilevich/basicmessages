package handlers

import (
	"casicmesbot/internal/db"
	"casicmesbot/internal/config"
	tele "gopkg.in/telebot.v3"
	"time"
	"strconv"
	"strings"
)

func AccessMiddleware(cfg *config.Config) tele.MiddlewareFunc {
	return func(next tele.HandlerFunc) tele.HandlerFunc {
		return func(c tele.Context) error {
			if c.Sender() == nil {
				return next(c)
			}
			userID := c.Sender().ID
			username := c.Sender().Username

			defaultStatus := "pending"
			if userID == cfg.OwnerID {
				defaultStatus = "owner"
			} else if userID == cfg.Admin2 {
				defaultStatus = "whitelist"
			}

			db.EnsureUser(userID, username, defaultStatus)
			status, banUntil, _ := db.GetUserStatus(userID)

			if status == "banned" && time.Now().Before(banUntil) {
				return c.Send("⛔️ Доступ запрещен (Блокировка).")
			}

			if status != "owner" && status != "whitelist" {
				// We can't strictly match c.Callback().Data in middleware because of '\f'.
				// So we just allow anything that contains "apply_access".
				if c.Callback() != nil && strings.Contains(c.Callback().Data, "apply_access") {
					return next(c)
				}

				menu := &tele.ReplyMarkup{}
				btn := menu.Data("📝 Подать заявку на доступ", "apply_access")
				menu.Inline(menu.Row(btn))
				return c.Send("❌ <b>Доступ закрыт.</b>\n\nБот работает только по вайтлисту. Вы можете подать заявку на использование. Одобрение зависит от владельца.", menu, tele.ModeHTML)
			}

			return next(c)
		}
	}
}

func HandleAccessRequest(cfg *config.Config, b *tele.Bot) tele.HandlerFunc {
	return func(c tele.Context) error {
		userID := c.Sender().ID
		res := db.AttemptRequest(userID)

		if res != "success" {
			return c.Send("⚠️ " + res)
		}

		menu := &tele.ReplyMarkup{}
		btnApprove := menu.Data("✅ Одобрить", "approve_"+strconv.FormatInt(userID, 10))
		btnReject := menu.Data("❌ Отклонить", "reject_"+strconv.FormatInt(userID, 10))
		menu.Inline(menu.Row(btnApprove, btnReject))

		ownerChat := &tele.User{ID: cfg.OwnerID}
		b.Send(ownerChat, "🔔 <b>Новая заявка на доступ</b>\n\nID: <code>" + strconv.FormatInt(userID, 10) + "</code>\nЮзер: @" + c.Sender().Username, menu, tele.ModeHTML)

		return c.Edit("✅ <b>Заявка отправлена!</b>\n\nВам придет уведомление, если владелец одобрит вас.", tele.ModeHTML)
	}
}

func HandleAdminDecisions(cfg *config.Config, b *tele.Bot) tele.HandlerFunc {
	return func(c tele.Context) error {
		if c.Sender().ID != cfg.OwnerID {
			return c.Respond()
		}

		data := c.Callback().Data

		// Telebot adds \f, so we trim it
		data = strings.TrimLeft(data, "\f")

		var action, idStr string
		if strings.HasPrefix(data, "approve_") {
			action = "approve"
			idStr = strings.TrimPrefix(data, "approve_")
		} else if strings.HasPrefix(data, "reject_") {
			action = "reject"
			idStr = strings.TrimPrefix(data, "reject_")
		} else {
			return c.Respond()
		}

		targetID, _ := strconv.ParseInt(idStr, 10, 64)
		targetChat := &tele.User{ID: targetID}

		if action == "approve" {
			db.DB.Exec("UPDATE users SET status='whitelist', reject_count=0 WHERE id=?", targetID)
			c.Edit("✅ Одобрен ID: " + idStr)
			b.Send(targetChat, "🎉 <b>Ваша заявка одобрена!</b>\nНажмите /start для начала работы.", tele.ModeHTML)
		} else {
			db.DB.Exec("UPDATE users SET reject_count = reject_count + 1 WHERE id=?", targetID)
			c.Edit("❌ Отклонен ID: " + idStr)
			b.Send(targetChat, "❌ <b>Ваша заявка отклонена.</b>", tele.ModeHTML)
		}

		return c.Respond()
	}
}
