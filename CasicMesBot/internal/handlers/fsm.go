package handlers

import (
	"casicmesbot/internal/db"
	"casicmesbot/internal/replacer"
	"fmt"
	"strings"
	"strconv"
	"io"
	"bytes"

	tele "gopkg.in/telebot.v3"
)

import "sync"
var userSteps sync.Map
var userConfigs sync.Map

func SetupFSM(b *tele.Bot) {
	b.Handle("/start", func(c tele.Context) error {
		userSteps.Delete(c.Sender().ID)

		status, _, _ := db.GetUserStatus(c.Sender().ID)

		// Build menu dynamically to avoid global mutation
		menu := &tele.ReplyMarkup{}
		menu.Inline(
			menu.Row(BtnChannel),
			menu.Row(BtnTemplate),
			menu.Row(BtnLinks),
			menu.Row(BtnRange),
			menu.Row(BtnStart),
		)

		if status == "owner" {
			menu.Inline(
				menu.Row(BtnChannel),
				menu.Row(BtnTemplate),
				menu.Row(BtnLinks),
				menu.Row(BtnRange),
				menu.Row(BtnStart),
				menu.Row(BtnOwnerStats),
			)
		}

		return c.Send("👋 <b>Добро пожаловать в Про-версию на Golang!</b>\n\nЯ заменяю тексты и фото в каналах с невероятной скоростью. Поддерживаю премиум эмодзи, форматирование и динамическую подстановку <code>{link}</code> из txt-файла.", menu, tele.ModeHTML)
	})

	b.Handle(&BtnOwnerStats, func(c tele.Context) error {
		status, _, _ := db.GetUserStatus(c.Sender().ID)
		if status != "owner" { return c.Respond() }
		tr, tc, tq, au := db.GetGlobalStats()
		txt := fmt.Sprintf("📊 <b>Метрики бота</b>\n\nЗаменено сообщений: <b>%d</b>\nОбработано каналов: <b>%d</b>\nВсего заявок: <b>%d</b>\nАктивных юзеров в белом списке: <b>%d</b>", tr, tc, tq, au)
		return c.Send(txt, tele.ModeHTML)
	})

	b.Handle(&BtnCancel, func(c tele.Context) error {
		userSteps.Delete(c.Sender().ID)
		return c.Edit("❌ Действие отменено.")
	})

	b.Handle(tele.OnText, func(c tele.Context) error {
		step, ok := userSteps.Load(c.Sender().ID)
		if !ok { return nil }

		switch step.(string) {
		case "wait_channel":
			txt := c.Text()
			chID := txt
			if strings.HasPrefix(txt, "t.me/") || strings.HasPrefix(txt, "https://t.me/") {
				parts := strings.Split(txt, "t.me/")
				chID = "@" + strings.Split(parts[1], "/")[0]
			}

			var chat *tele.Chat
			var err error

			chInt, errParse := strconv.ParseInt(chID, 10, 64)
			if errParse == nil {
			    chat, err = b.ChatByID(chInt)
			} else {
			    chat = &tele.Chat{ID: 0, Username: chID, Title: chID}
			}

			if err != nil && errParse == nil {
				return c.Send("❌ Ошибка: бот не является админом в этом канале или канал не существует.", MenuCancel)
			}

			cfg := getConfig(c.Sender().ID)
			cfg.ChannelID = chID
			if chat.ID != 0 {
			    cfg.ChannelID = strconv.FormatInt(chat.ID, 10)
			}
			cfg.ChannelTitle = chat.Title
			saveConfig(c.Sender().ID, cfg)

			userSteps.Delete(c.Sender().ID)
			return c.Send("✅ <b>Канал выбран:</b> " + chat.Title, tele.ModeHTML)

		case "wait_template":
		    cfg := getConfig(c.Sender().ID)
		    cfg.TemplateText = c.Text()
		    cfg.TemplateEnts = c.Message().Entities
		    cfg.TemplatePhoto = ""
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return c.Send("✅ <b>Шаблон сохранен!</b> Эмодзи и форматирование учтены.", tele.ModeHTML)

		case "wait_range_first":
		    cfg := getConfig(c.Sender().ID)
		    cfg.RangeType = "first"
		    num, err := strconv.Atoi(strings.TrimSpace(c.Text()))
		    if err != nil || num <= 0 { return c.Send("❌ Введите положительное число.") }
		    cfg.RangeStart = num
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return c.Send("✅ Диапазон (Первые X) сохранен.")

		case "wait_range_last":
		    cfg := getConfig(c.Sender().ID)
		    cfg.RangeType = "last"
		    num, err := strconv.Atoi(strings.TrimSpace(c.Text()))
		    if err != nil || num <= 0 { return c.Send("❌ Введите положительное число.") }
		    cfg.RangeStart = num
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return c.Send("✅ Диапазон (Последние X) сохранен.")

		case "wait_range_xy":
		    cfg := getConfig(c.Sender().ID)
		    parts := strings.Fields(c.Text())
		    if len(parts) != 2 { return c.Send("❌ Введите два числа через пробел.") }
		    start, err1 := strconv.Atoi(parts[0])
		    end, err2 := strconv.Atoi(parts[1])
		    if err1 != nil || err2 != nil || start <= 0 || end <= 0 || start > end {
		       return c.Send("❌ Введите корректные числа (X Y, где X <= Y).")
		    }
		    cfg.RangeType = "xy"
		    cfg.RangeStart = start
		    cfg.RangeEnd = end
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return c.Send(fmt.Sprintf("✅ Диапазон установлен: ID от %d до %d", start, end))
		}
		return nil
	})

	b.Handle(tele.OnPhoto, func(c tele.Context) error {
	    step, ok := userSteps.Load(c.Sender().ID)
		if !ok || step.(string) != "wait_template" { return nil }

		cfg := getConfig(c.Sender().ID)
		cfg.TemplateText = c.Message().Caption
		cfg.TemplateEnts = c.Message().CaptionEntities
		if c.Message().Photo != nil {
		    cfg.TemplatePhoto = c.Message().Photo.FileID
		}
		saveConfig(c.Sender().ID, cfg)
		userSteps.Delete(c.Sender().ID)
		return c.Send("✅ <b>Шаблон (с фото) сохранен!</b>", tele.ModeHTML)
	})

	b.Handle(tele.OnDocument, func(c tele.Context) error {
	    step, ok := userSteps.Load(c.Sender().ID)
		if !ok || step.(string) != "wait_links" { return nil }

		doc := c.Message().Document
		if !strings.HasSuffix(doc.FileName, ".txt") {
		   return c.Send("❌ Только .txt файлы.")
		}

		reader, err := b.File(&doc.File)
		if err != nil { return c.Send("❌ Ошибка загрузки.") }
		defer reader.Close()
		buf := new(bytes.Buffer)
		io.Copy(buf, reader)

		lines := strings.Split(buf.String(), "\n")
		var valid []string
		for _, l := range lines {
		   if len(strings.TrimSpace(l)) > 0 { valid = append(valid, strings.TrimSpace(l)) }
		}

		cfg := getConfig(c.Sender().ID)
		cfg.Links = valid
		saveConfig(c.Sender().ID, cfg)
		userSteps.Delete(c.Sender().ID)
		return c.Send(fmt.Sprintf("✅ <b>Загружено %d ссылок!</b>", len(valid)), tele.ModeHTML)
	})

	b.Handle(&BtnChannel, func(c tele.Context) error {
		userSteps.Store(c.Sender().ID, "wait_channel")
		return c.Edit("📢 <b>Отправьте канал:</b>\n\n- Перешлите пост\n- Пришлите ссылку (t.me/...)\n- ID (-100...)", MenuCancel, tele.ModeHTML)
	})

	b.Handle(&BtnTemplate, func(c tele.Context) error {
		userSteps.Store(c.Sender().ID, "wait_template")
		return c.Edit("📝 <b>Отправьте текст или фото с подписью.</b>", MenuCancel, tele.ModeHTML)
	})

	b.Handle(&BtnLinks, func(c tele.Context) error {
		userSteps.Store(c.Sender().ID, "wait_links")
		return c.Edit("📄 <b>Отправьте .txt файл</b>, где каждая ссылка с новой строки.", MenuCancel, tele.ModeHTML)
	})

	b.Handle(&BtnRange, func(c tele.Context) error {
	    return c.Edit("Выберите, какие сообщения заменять:", MenuRange)
	})

	b.Handle(&BtnRangeAll, func(c tele.Context) error {
	    cfg := getConfig(c.Sender().ID)
	    cfg.RangeType = ""
	    saveConfig(c.Sender().ID, cfg)
	    return c.Edit("✅ Выбраны все сообщения.")
	})
	b.Handle(&BtnRangeFirst, func(c tele.Context) error {
	    userSteps.Store(c.Sender().ID, "wait_range_first")
	    return c.Edit("🔢 Сколько ПЕРВЫХ сообщений заменить (начиная с самых старых ID)?", MenuCancel)
	})
	b.Handle(&BtnRangeLast, func(c tele.Context) error {
	    userSteps.Store(c.Sender().ID, "wait_range_last")
	    return c.Edit("🔢 Сколько ПОСЛЕДНИХ сообщений заменить (начиная с самых новых ID)?", MenuCancel)
	})
	b.Handle(&BtnRangeXY, func(c tele.Context) error {
	    userSteps.Store(c.Sender().ID, "wait_range_xy")
	    return c.Edit("🔢 Введите два числа через пробел (например: ID 10 и ID 50):", MenuCancel)
	})

	b.Handle(tele.OnChannelPost, func(c tele.Context) error {
	    if c.Message().IsForwarded() {
	        step, ok := userSteps.Load(c.Sender().ID)
		if ok && step.(string) == "wait_channel" {
		    chat := c.Message().OriginalChat
		    cfg := getConfig(c.Sender().ID)
			cfg.ChannelID = strconv.FormatInt(chat.ID, 10)
			cfg.ChannelTitle = chat.Title
			saveConfig(c.Sender().ID, cfg)
			userSteps.Delete(c.Sender().ID)
			return c.Send("✅ <b>Канал выбран:</b> " + chat.Title, tele.ModeHTML)
		}
	    }
	    return nil
	})

	b.Handle(&BtnStart, func(c tele.Context) error {
		cfg := getConfig(c.Sender().ID)
		if cfg.ChannelID == "" || (cfg.TemplateText == "" && cfg.TemplatePhoto == "") {
		    return c.Respond(&tele.CallbackResponse{Text: "Задайте канал и шаблон!", ShowAlert: true})
		}

		c.Edit("⚡️ <b>Получаю ID постов...</b>", tele.ModeHTML)

		ids, err := replacer.GetTargetIDs(b, cfg.ChannelID, 50000)
		if err != nil {
		   return c.Edit("❌ Ошибка канала: " + err.Error())
		}
		cfg.TargetIDs = ids

		statusMsg, _ := b.Send(c.Sender(), "🚀 <b>Запуск пула воркеров...</b>", tele.ModeHTML)
		go replacer.RunTask(b, cfg, c.Sender(), statusMsg)

		return c.Respond()
	})
}

func getConfig(uid int64) *replacer.ReplacerState {
    val, ok := userConfigs.Load(uid)
    if !ok { return &replacer.ReplacerState{AdminID: uid} }
    return val.(*replacer.ReplacerState)
}

func saveConfig(uid int64, cfg *replacer.ReplacerState) {
    userConfigs.Store(uid, cfg)
}
