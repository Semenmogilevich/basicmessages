// Utility functions for string manipulation and entity offset updates

/**
 * Replaces the {link} placeholder in the text and shifts all subsequent entity offsets.
 * Telegram entities use UTF-16 code units for offset/length.
 */
export function injectLinkAndShiftEntities(text, entities, linkStr) {
  if (!text) return { text, entities: entities || [] };
  if (!entities) entities = [];

  const placeholder = '{link}';
  const idx = text.indexOf(placeholder);

  if (idx === -1) {
    return { text, entities };
  }

  // Calculate UTF-16 offsets
  // JS string indices map perfectly to UTF-16 code unit offsets, which is what Telegram expects.
  const utf16Offset = idx;
  const utf16LengthPlaceholder = placeholder.length;
  const utf16LengthLink = linkStr.length;

  const diff = utf16LengthLink - utf16LengthPlaceholder;

  const newText = text.slice(0, idx) + linkStr + text.slice(idx + placeholder.length);

  // Clone entities to avoid mutating the original template
  const newEntities = entities.map(e => ({ ...e }));

  for (let i = 0; i < newEntities.length; i++) {
    const e = newEntities[i];

    // If entity is completely after the placeholder, shift its offset
    if (e.offset >= utf16Offset + utf16LengthPlaceholder) {
      e.offset += diff;
    }
    // If entity envelops the placeholder (e.g., a bold block containing {link}), extend its length
    else if (e.offset <= utf16Offset && e.offset + e.length >= utf16Offset + utf16LengthPlaceholder) {
      e.length += diff;
    }
  }

  return { text: newText, entities: newEntities };
}

/**
 * Ensures text does not exceed max length, truncating entities if necessary.
 */
export function truncateTextAndEntities(text, entities, maxLength) {
  if (text.length <= maxLength) return { text, entities };

  const newText = text.slice(0, maxLength);
  const newEntities = [];

  for (const e of entities) {
    if (e.offset >= maxLength) continue;

    const clone = { ...e };
    if (clone.offset + clone.length > maxLength) {
      clone.length = maxLength - clone.offset;
    }
    newEntities.push(clone);
  }

  return { text: newText, entities: newEntities };
}
