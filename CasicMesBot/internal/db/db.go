package db

import (
	"database/sql"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var DB *sql.DB

func InitDB(filepath string) {
	var err error
	DB, err = sql.Open("sqlite3", filepath)
	if err != nil {
		log.Fatalf("Failed to open db: %v", err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY,
		username TEXT,
		status TEXT DEFAULT 'pending', -- 'owner', 'whitelist', 'pending', 'banned'
		ban_until DATETIME,
		last_request DATETIME,
		reject_count INTEGER DEFAULT 0,
		messages_replaced INTEGER DEFAULT 0,
		channels_processed INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS requests (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER,
		status TEXT DEFAULT 'pending',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS templates (
		user_id INTEGER PRIMARY KEY,
		text TEXT,
		photo_id TEXT,
		entities TEXT, -- JSON
		links TEXT,    -- JSON array
		link_index INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS global_stats (
		id INTEGER PRIMARY KEY,
		total_replaced INTEGER DEFAULT 0,
		total_channels INTEGER DEFAULT 0,
		total_requests INTEGER DEFAULT 0
	);
	`
	_, err = DB.Exec(createTables)
	if err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}

	// Initialize global stats row if not exists
	DB.Exec("INSERT OR IGNORE INTO global_stats (id, total_replaced) VALUES (1, 0)")
}

func EnsureUser(userID int64, username string, defaultStatus string) {
	_, err := DB.Exec(`INSERT INTO users (id, username, status) VALUES (?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET username=excluded.username`, userID, username, defaultStatus)
	if err != nil {
		log.Printf("EnsureUser error: %v", err)
	}
}

func GetUserStatus(userID int64) (string, time.Time, int) {
	var status string
	var banUntil sql.NullTime
	var rejectCount int
	err := DB.QueryRow("SELECT status, ban_until, reject_count FROM users WHERE id = ?", userID).Scan(&status, &banUntil, &rejectCount)
	if err != nil {
		return "pending", time.Time{}, 0
	}
	return status, banUntil.Time, rejectCount
}
