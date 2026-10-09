package entities

import (
	"strings"
	"unicode/utf16"
	tele "gopkg.in/telebot.v3"
)

// InjectLinkAndShift replaces "{link}" with linkStr and correctly shifts UTF-16 entity offsets.
// Telegram API requires offsets and lengths to be calculated in UTF-16 code units.
func InjectLinkAndShift(text string, entities []tele.MessageEntity, linkStr string) (string, []tele.MessageEntity) {
	placeholder := "{link}"
	idx := strings.Index(text, placeholder)
	if idx == -1 {
		return text, entities
	}

	utf16PlaceholderLen := len(utf16.Encode([]rune(placeholder)))
	utf16LinkLen := len(utf16.Encode([]rune(linkStr)))

	// Convert byte index to utf16 index
	utf16Offset := len(utf16.Encode([]rune(text[:idx])))

	diff := utf16LinkLen - utf16PlaceholderLen

	newText := strings.Replace(text, placeholder, linkStr, 1)

	var newEntities []tele.MessageEntity
	for _, e := range entities {
		clone := e
		// If entity starts after placeholder
		if clone.Offset >= utf16Offset + utf16PlaceholderLen {
			clone.Offset += diff
		} else if clone.Offset <= utf16Offset && clone.Offset+clone.Length >= utf16Offset+utf16PlaceholderLen {
			// Entity encapsulates the placeholder
			clone.Length += diff
		}
		newEntities = append(newEntities, clone)
	}

	return newText, newEntities
}
