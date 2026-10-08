import { fetch } from 'sdk';

/**
 * Scrapes https://t.me/s/username to get all active, non-deleted message IDs.
 * Bypasses the Bot API "no history" limitation.
 */
export async function fetchExistingPostsWeb(username) {
  let cleanName = username.replace('https://t.me/', '').replace('t.me/', '').replace('@', '').split('/')[0];
  const baseUrl = `https://t.me/s/${cleanName}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
  };

  const existingIds = new Set();
  let beforeId = null;

  for (let i = 0; i < 40; i++) {
    const url = beforeId ? `${baseUrl}?before=${beforeId}` : baseUrl;
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) break;

      const html = await resp.text();

      // Match data-post="channel_name/123"
      const regex = /data-post="[^"/]+\/(\d+)"/g;
      let match;
      const matches = [];
      while ((match = regex.exec(html)) !== null) {
        matches.push(parseInt(match[1], 10));
      }

      if (matches.length === 0) break;

      let addedAny = false;
      let minId = Infinity;
      for (const id of matches) {
        if (!existingIds.has(id)) {
          existingIds.add(id);
          addedAny = true;
        }
        if (id < minId) minId = id;
      }

      if (!addedAny) break;
      if (minId <= 1) break;

      beforeId = minId;
    } catch (err) {
      break;
    }
  }

  // Return sorted descending (newest first, same as Telegram order)
  return Array.from(existingIds).sort((a, b) => b - a);
}
