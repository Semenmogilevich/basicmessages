import { api } from 'sdk';

/**
 * STRATEGY V5: ULTIMATE INSTANT SPEED.
 * Instead of probing every single ID (which takes time if there are thousands),
 * we simply find the LATEST message ID (by sending and instantly deleting a dummy message).
 * That takes exactly ~0.5 seconds.
 *
 * Then, instead of building a huge array of "only active IDs", we just build an array
 * of ALL IDs from 1 to `latestId` (or whatever range).
 *
 * At the time of REPLACEMENT, the bot will simply try to edit the ID. If it's deleted,
 * the API says "message not found" and we just instantly skip it.
 * This skips the parsing phase entirely, reducing parsing time to 1 second!
 */
export async function getActivePostIds(channelId, adminId, maxDepth = 2000) {
  let latestId = 0;
  try {
    const dummy = await api.sendMessage({ chat_id: channelId, text: "." });
    latestId = dummy.message_id;
    await api.deleteMessage({ chat_id: channelId, message_id: latestId }).catch(() => {});
  } catch (e) {
    throw new Error("Бот не является администратором с правом публикации в канале.");
  }

  const activeIds = [];
  const start = Math.max(1, latestId - maxDepth);

  // We simply assume ALL IDs in this range exist.
  // We will let the replacer logic naturally skip deleted ones.
  for (let msgId = latestId; msgId >= start; msgId--) {
      activeIds.push(msgId);
  }

  return activeIds.sort((a, b) => b - a);
}
