package config

import "os"

type Config struct {
	BotToken string
	OwnerID  int64
	Admin2   int64
}

func Load() *Config {
	token := os.Getenv("BOT_TOKEN")
	if token == "" {
		token = "YOUR_BOT_TOKEN_HERE" // Fallback or loaded from env
	}
	return &Config{
		BotToken: token,
		OwnerID:  5172556128,
		Admin2:   5847661785,
	}
}
