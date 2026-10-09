package main

import (
	"casicmesbot/internal/config"
	"casicmesbot/internal/db"
	"casicmesbot/internal/handlers"
	"log"
	"time"

	tele "gopkg.in/telebot.v3"
)

func main() {
	cfg := config.Load()
	db.InitDB("bot.db")

	pref := tele.Settings{
		Token:  cfg.BotToken,
		Poller: &tele.LongPoller{Timeout: 10 * time.Second},
	}

	b, err := tele.NewBot(pref)
	if err != nil {
		log.Fatal(err)
		return
	}

	b.Use(handlers.AccessMiddleware(cfg))
	handlers.SetupFSM(b)

	// Create dummy buttons specifically to register handlers for \f callback data safely
	btnApproveReject := &tele.Btn{Unique: "admin_decision"}
	b.Handle(btnApproveReject, handlers.HandleAdminDecisions(cfg, b))
	// Actually we catch all callbacks and filter inside the handler because the data is dynamic (approve_123456)
	b.Handle(tele.OnCallback, handlers.HandleAdminDecisions(cfg, b))

	btnApply := &tele.Btn{Unique: "apply_access"}
	b.Handle(btnApply, handlers.HandleAccessRequest(cfg, b))

	log.Printf("Бот %s запущен. Владелец: %d", b.Me.Username, cfg.OwnerID)
	b.Start()
}
