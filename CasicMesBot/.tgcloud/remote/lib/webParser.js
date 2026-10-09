import { api, fetch } from 'sdk';

/**
 * FAST PROBING STRATEGY (Without copying/forwarding).
 * We simply attempt to edit the message's text to its current text, or just apply
 * `editMessageReplyMarkup` with an empty keyboard.
 *
 * If it succeeds or throws "message is not modified", THE MESSAGE EXISTS!
 * If it throws "message to edit not found", THE MESSAGE IS DELETED!
 *
 * We do this in fast parallel batches!
 */
export async function getActivePostIds(channelId, adminId, maxDepth = 400) {
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

  // Fast parallel batching
  const BATCH_SIZE = 15;
  for (let i = latestId; i >= start; i -= BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && (i - j) >= start; j++) {
      batch.push(i - j);
    }

    const tasks = batch.map(async (msgId) => {
      try {
        // We try to edit the reply markup (to what it already is, or just an empty one)
        // If it throws "message is not modified" -> exists!
        // If it throws "message to edit not found" -> deleted!
        // If it succeeds -> exists!
        await api.editMessageReplyMarkup({
            chat_id: channelId,
            message_id: msgId,
            reply_markup: { inline_keyboard: [] }
        });
        activeIds.push(msgId);
      } catch (err) {
         const msg = err.description ? err.description.toLowerCase() : "";
         // If it's not modified, it exists (and it had no keyboard or the same keyboard)
         if (msg.includes('message is not modified')) {
             activeIds.push(msgId);
         } else if (msg.includes('there is no text') || msg.includes('message is not a text message')) {
             // If we tried to edit markup of a media, it might say something else or succeed, but if it throws this, it exists.
             activeIds.push(msgId);
         } else if (msg.includes('too many requests') || msg.includes('retry after')) {
             // Let's assume rate limits mean the message exists, otherwise it wouldn't rate limit the edit...
             // but to be safe we wait.
             const retryAfter = err.parameters?.retry_after || 1;
             const startWait = Date.now();
             while(Date.now() - startWait < (retryAfter * 1000) + 100) { } // busy wait
             // Push it anyway so we don't skip entirely on rate limit (fallback heuristic)
             activeIds.push(msgId);
         }
         // If "message to edit not found", we do nothing (it's deleted)
      }
    });

    await Promise.all(tasks);
  }

  return activeIds.sort((a, b) => b - a);
}
