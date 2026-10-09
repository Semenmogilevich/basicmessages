package db

import (
	"time"
)

// AttemptRequest tries to submit an access request. Returns error string if blocked.
func AttemptRequest(userID int64) string {
	status, banUntil, rejectCount := GetUserStatus(userID)

	if status == "owner" || status == "whitelist" {
		return "У вас уже есть доступ."
	}
	if status == "banned" || (!banUntil.IsZero() && time.Now().Before(banUntil)) {
		return "Вы заблокированы за частые отклоненные заявки."
	}

	var lastReq time.Time
	DB.QueryRow("SELECT last_request FROM users WHERE id = ?", userID).Scan(&lastReq)

	if time.Since(lastReq) < time.Hour {
		return "Вы уже подавали заявку недавно. Следующая попытка возможна через 1 час."
	}

	if rejectCount >= 3 {
		// Ban for 7 days
		DB.Exec("UPDATE users SET status='banned', ban_until=? WHERE id=?", time.Now().Add(7*24*time.Hour), userID)
		return "Ваши заявки были отклонены 3 раза. Вы заблокированы на неделю."
	}

	// Submit request
	DB.Exec("UPDATE users SET last_request=? WHERE id=?", time.Now(), userID)
	DB.Exec("INSERT INTO requests (user_id) VALUES (?)", userID)

	return "success"
}

func UpdateStats(userID int64, replaced int, channels int) {
	DB.Exec("UPDATE users SET messages_replaced = messages_replaced + ?, channels_processed = channels_processed + ? WHERE id = ?", replaced, channels, userID)
	DB.Exec("UPDATE global_stats SET total_replaced = total_replaced + ?, total_channels = total_channels + ? WHERE id = 1", replaced, channels)
}

func GetGlobalStats() (int, int, int, int) {
	var tr, tc, tq, activeUsers int
	DB.QueryRow("SELECT total_replaced, total_channels, total_requests FROM global_stats WHERE id = 1").Scan(&tr, &tc, &tq)
	DB.QueryRow("SELECT COUNT(*) FROM users WHERE status IN ('owner', 'whitelist')").Scan(&activeUsers)
	return tr, tc, tq, activeUsers
}
