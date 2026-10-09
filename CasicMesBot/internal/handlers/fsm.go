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

const VERSION = "1.6"

func renderMainMenu(b *tele.Bot, c tele.Context, prefix string) error {
	status, _, _ := db.GetUserStatus(c.Sender().ID)

	menu := &tele.ReplyMarkup{}
	if status == "owner" {
		menu.Inline(
			menu.Row(BtnChannel),
			menu.Row(BtnTemplate),
			menu.Row(BtnLinks),
			menu.Row(BtnRange),
			menu.Row(BtnStart),
			menu.Row(BtnOwnerStats),
		)
	} else {
		menu.Inline(
			menu.Row(BtnChannel),
			menu.Row(BtnTemplate),
			menu.Row(BtnLinks),
			menu.Row(BtnRange),
			menu.Row(BtnStart),
		)
	}

	cfg := getConfig(c.Sender().ID)

	var info string
	if prefix != "" {
		info = prefix + "\n\n"
	}
	info += fmt.Sprintf("⚙️ <b>Панель управления (v%s)</b>\n\n", VERSION)

	chName := cfg.ChannelTitle
	if chName == "" { chName = "Не выбран" }
	info += fmt.Sprintf("📢 Канал: <b>%s</b>", chName)
	if len(cfg.TargetIDs) > 0 {
		info += fmt.Sprintf(" <i>(Макс ID: %d)</i>", cfg.TargetIDs[0])
	}
	info += "\n"

	tplStr := "Нет ❌"
	if cfg.TemplateText != "" || cfg.TemplatePhoto != "" {
		tplStr = "Задан ✅"
	}
	info += fmt.Sprintf("📝 Шаблон: <b>%s</b>", tplStr)
	if cfg.TemplatePhoto != "" {
		info += " <i>(с фото 🖼)</i>"
	}
	info += "\n"

	if strings.Contains(cfg.TemplateText, "{link}") {
		info += fmt.Sprintf("🔗 Ссылок загружено: <b>%d</b>\n", len(cfg.Links))
	}

	rangeStr := "Все"
	if cfg.RangeType == "first" {
		rangeStr = fmt.Sprintf("Первые %d", cfg.RangeStart)
	} else if cfg.RangeType == "last" {
		rangeStr = fmt.Sprintf("Последние %d", cfg.RangeStart)
	} else if cfg.RangeType == "xy" {
		rangeStr = fmt.Sprintf("С ID %d по ID %d", cfg.RangeStart, cfg.RangeEnd)
	}
	info += fmt.Sprintf("📊 Диапазон: <b>%s</b>\n", rangeStr)

	return c.Send(info, menu, tele.ModeHTML)
}

func SetupFSM(b *tele.Bot) {
	b.Handle("/start", func(c tele.Context) error {
		userSteps.Delete(c.Sender().ID)
		return renderMainMenu(b, c, "👋 <b>Добро пожаловать!</b>")
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
		c.Edit("❌ Действие отменено.")
		return renderMainMenu(b, c, "")
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
			return renderMainMenu(b, c, "✅ <b>Канал выбран:</b> " + chat.Title)

		case "wait_template":
		    cfg := getConfig(c.Sender().ID)
		    cfg.TemplateText = c.Text()
		    cfg.TemplateEnts = c.Message().Entities
		    cfg.TemplatePhoto = ""
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return renderMainMenu(b, c, "✅ <b>Шаблон сохранен!</b> Эмодзи и форматирование учтены.")

		case "wait_range_first":
		    cfg := getConfig(c.Sender().ID)
		    num, err := strconv.Atoi(strings.TrimSpace(c.Text()))
		    if err != nil || num <= 0 { return c.Send("❌ Введите положительное число.") }
		    cfg.RangeType = "first"
		    cfg.RangeStart = num
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return renderMainMenu(b, c, "✅ Диапазон (Первые X) сохранен.")

		case "wait_range_last":
		    cfg := getConfig(c.Sender().ID)
		    num, err := strconv.Atoi(strings.TrimSpace(c.Text()))
		    if err != nil || num <= 0 { return c.Send("❌ Введите положительное число.") }
		    cfg.RangeType = "last"
		    cfg.RangeStart = num
		    saveConfig(c.Sender().ID, cfg)
		    userSteps.Delete(c.Sender().ID)
		    return renderMainMenu(b, c, "✅ Диапазон (Последние X) сохранен.")

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
		    return renderMainMenu(b, c, fmt.Sprintf("✅ Диапазон установлен: ID от %d до %d", start, end))
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
		return renderMainMenu(b, c, "✅ <b>Шаблон (с фото) сохранен!</b>")
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
		return renderMainMenu(b, c, fmt.Sprintf("✅ <b>Загружено %d ссылок!</b>", len(valid)))
	})

	b.Handle(&BtnChannel, func(c tele.Context) error {
		userSteps.Store(c.Sender().ID, "wait_channel")
		c.Edit("📢 <b>Отправьте канал:</b>\n\n- Перешлите пост\n- Пришлите ссылку (t.me/...)\n- ID (-100...)", MenuCancel, tele.ModeHTML)
		return c.Respond()
	})

	b.Handle(&BtnTemplate, func(c tele.Context) error {
		userSteps.Store(c.Sender().ID, "wait_template")
		c.Edit("📝 <b>Отправьте текст или фото с подписью.</b>", MenuCancel, tele.ModeHTML)
		return c.Respond()
	})

	b.Handle(&BtnLinks, func(c tele.Context) error {
		userSteps.Store(c.Sender().ID, "wait_links")
		c.Edit("📄 <b>Отправьте .txt файл</b>, где каждая ссылка с новой строки.", MenuCancel, tele.ModeHTML)
		return c.Respond()
	})

	b.Handle(&BtnRange, func(c tele.Context) error {
	    c.Edit("Выберите, какие сообщения заменять:", MenuRange)
	    return c.Respond()
	})

	b.Handle(&BtnRangeAll, func(c tele.Context) error {
	    cfg := getConfig(c.Sender().ID)
	    cfg.RangeType = ""
	    saveConfig(c.Sender().ID, cfg)
	    c.Edit("✅ Выбраны все сообщения.")
	    return renderMainMenu(b, c, "")
	})
	b.Handle(&BtnRangeFirst, func(c tele.Context) error {
	    userSteps.Store(c.Sender().ID, "wait_range_first")
	    c.Edit("🔢 Сколько ПЕРВЫХ сообщений заменить (начиная с самых старых ID)?", MenuCancel)
	    return c.Respond()
	})
	b.Handle(&BtnRangeLast, func(c tele.Context) error {
	    userSteps.Store(c.Sender().ID, "wait_range_last")
	    c.Edit("🔢 Сколько ПОСЛЕДНИХ сообщений заменить (начиная с самых новых ID)?", MenuCancel)
	    return c.Respond()
	})
	b.Handle(&BtnRangeXY, func(c tele.Context) error {
	    userSteps.Store(c.Sender().ID, "wait_range_xy")
	    c.Edit("🔢 Введите два числа через пробел (например: ID 10 и ID 50):", MenuCancel)
	    return c.Respond()
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
			return renderMainMenu(b, c, "✅ <b>Канал выбран:</b> " + chat.Title)
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
		   c.Send("❌ Ошибка канала: " + err.Error())
		   return renderMainMenu(b, c, "")
		}
		cfg.TargetIDs = ids
		saveConfig(c.Sender().ID, cfg)

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
