package replacer

import (
	tele "gopkg.in/telebot.v3"
	"math"
	"strconv"
)

func GetTargetIDs(b *tele.Bot, channelID string, maxDepth int) ([]int, error) {
	chID, err := strconv.ParseInt(channelID, 10, 64)
	if err != nil {
		return nil, err
	}
	chat, err := b.ChatByID(chID)
	if err != nil {
		return nil, err
	}

	msg, err := b.Send(chat, ".")
	if err != nil {
		return nil, err
	}
	latestID := msg.ID
	b.Delete(msg)

	start := int(math.Max(1, float64(latestID-maxDepth)))

	var ids []int
	for i := latestID; i >= start; i-- {
		ids = append(ids, i)
	}

	return ids, nil
}
