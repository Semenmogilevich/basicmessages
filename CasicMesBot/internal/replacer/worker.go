package replacer

import (
	"casicmesbot/internal/entities"
	"casicmesbot/internal/db"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"math"
	"strconv"

	tele "gopkg.in/telebot.v3"
)

type ReplacerState struct {
	AdminID        int64
	ChannelID      string
	ChannelTitle   string
	TemplateText   string
	TemplatePhoto  string
	TemplateEnts   []tele.MessageEntity
	Links          []string
	LinkIndex      int
	TargetIDs      []int
	RangeType      string
	RangeStart     int
	RangeEnd       int
}

var activeTasks sync.Map

// Message wrapper for tele.Editable
type EditableMsg struct {
	ChatID string
	MsgID  int
}

func (e *EditableMsg) MessageSig() (string, int64) {
	return e.ChatID, int64(e.MsgID)
}

func RunTask(b *tele.Bot, state *ReplacerState, statusChat *tele.User, statusMsg *tele.Message) {
	activeTasks.Store(state.AdminID, true)
	defer activeTasks.Delete(state.AdminID)

    var finalIds []int
    if state.RangeType == "first" && len(state.TargetIDs) > 0 {
       // IDs are descending from newest to oldest
       // First X means oldest X
       endIdx := len(state.TargetIDs)
       startIdx := endIdx - state.RangeStart
       if startIdx < 0 { startIdx = 0 }
       finalIds = state.TargetIDs[startIdx:endIdx]
    } else if state.RangeType == "last" && len(state.TargetIDs) > 0 {
       // Last X means newest X
       endIdx := state.RangeStart
       if endIdx > len(state.TargetIDs) { endIdx = len(state.TargetIDs) }
       finalIds = state.TargetIDs[0:endIdx]
    } else if state.RangeType == "xy" {
       for _, id := range state.TargetIDs {
          if id >= state.RangeStart && id <= state.RangeEnd {
             finalIds = append(finalIds, id)
          }
       }
    } else {
       finalIds = state.TargetIDs
    }

	total := len(finalIds)
	var editedCount, checkedCount int32
	startTime := time.Now()

	updateStatus := func() {
		cc := atomic.LoadInt32(&checkedCount)
		ec := atomic.LoadInt32(&editedCount)
		pct := 0
		if total > 0 {
			pct = int((float64(cc) / float64(total)) * 100)
		}

		etaStr := "Вычисляется..."
		if cc > 0 {
			elapsed := time.Since(startTime)
			msPerItem := float64(elapsed.Milliseconds()) / float64(cc)
			remaining := total - int(cc)
			s := int(math.Ceil((float64(remaining) * msPerItem) / 1000))
			m := s / 60
			sec := s % 60
			if m > 0 {
				etaStr = fmt.Sprintf("%d мин %d сек", m, sec)
			} else {
				etaStr = fmt.Sprintf("%d сек", sec)
			}
		}

		barFilled := int(float64(pct) / 10.0)
		barEmpty := 10 - barFilled
		if barEmpty < 0 { barEmpty = 0 }
		bar := strings.Repeat("🟩", barFilled) + strings.Repeat("⬜️", barEmpty)

		text := fmt.Sprintf("⚡️ <b>Замена сообщений...</b>\n\n%s %d%%\n\n🔄 Проверено ID: <b>%d / %d</b>\n✅ Успешно заменено: <b>%d</b>\n⏳ Осталось времени: <b>%s</b>",
			bar, pct, cc, total, ec, etaStr)

		b.Edit(statusMsg, text, tele.ModeHTML)
	}

	updateStatus()

	numWorkers := 15
	jobs := make(chan int, total)
	var wg sync.WaitGroup

	var mu sync.Mutex
	currentLinkIndex := state.LinkIndex

	ticker := time.NewTicker(2 * time.Second)
	go func() {
		for range ticker.C {
			if _, ok := activeTasks.Load(state.AdminID); !ok {
				break
			}
			updateStatus()
		}
	}()

	chID, _ := strconv.ParseInt(state.ChannelID, 10, 64)
	chatRec, _ := b.ChatByID(chID)

	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for msgID := range jobs {
				text := state.TemplateText
				ents := state.TemplateEnts

				if strings.Contains(text, "{link}") && len(state.Links) > 0 {
					mu.Lock()
					linkToUse := state.Links[currentLinkIndex%len(state.Links)]
					currentLinkIndex++
					mu.Unlock()
					text, ents = entities.InjectLinkAndShift(text, ents, linkToUse)
				}

				msgObj := &tele.Message{Chat: chatRec, ID: msgID}

				attempt := 0
				success := false
				for attempt < 5 && !success {
					var err error
					if state.TemplatePhoto != "" {
						media := &tele.Photo{File: tele.File{FileID: state.TemplatePhoto}, Caption: text}
						_, err = b.EditMedia(msgObj, media)
					} else {
						opts := &tele.SendOptions{Entities: ents, DisableWebPagePreview: false}
						_, err = b.Edit(msgObj, text, opts)
					}

					if err != nil {
						errMsg := strings.ToLower(err.Error())
						if strings.Contains(errMsg, "message is not modified") {
							atomic.AddInt32(&editedCount, 1)
							success = true
							break
						}
						if strings.Contains(errMsg, "there is no text") && state.TemplatePhoto == "" {
						   _, errCap := b.EditCaption(msgObj, text, &tele.SendOptions{Entities: ents})
						   if errCap != nil {
						       if strings.Contains(strings.ToLower(errCap.Error()), "not modified") {
						           atomic.AddInt32(&editedCount, 1)
						       }
						   } else {
						       atomic.AddInt32(&editedCount, 1)
						   }
						   success = true
						   break
						}
						if strings.Contains(errMsg, "too many requests") || strings.Contains(errMsg, "retry after") {
							time.Sleep(2 * time.Second)
							attempt++
							continue
						}
						success = true
					} else {
						atomic.AddInt32(&editedCount, 1)
						success = true
					}
				}
				atomic.AddInt32(&checkedCount, 1)
			}
		}()
	}

	for _, id := range finalIds {
		jobs <- id
	}
	close(jobs)
	wg.Wait()
	ticker.Stop()

	updateStatus()

	db.UpdateStats(state.AdminID, int(editedCount), 1)

	lIndex := 0
	if len(state.Links) > 0 {
	   lIndex = currentLinkIndex % len(state.Links)
	}
	db.DB.Exec("UPDATE templates SET link_index = ? WHERE user_id = ?", lIndex, state.AdminID)

	b.Edit(statusMsg, fmt.Sprintf("🏁 <b>Замена завершена!</b>\n\n📢 Канал: <b>%s</b>\n✅ Успешно заменено: <b>%d</b>\n👻 Удаленных/пропущено: <b>%d</b>\n⏱ Затрачено: <b>%s</b>\n\n<i>Отправьте /start для нового задания.</i>",
		state.ChannelTitle, editedCount, total-int(editedCount), time.Since(startTime).Round(time.Second).String()), tele.ModeHTML)
}
