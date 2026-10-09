import { api } from 'sdk';

/**
 * FAST PROBING STRATEGY V4 (The ultimate safe method).
 * We simply attempt to edit the message's text to its current text, or apply `editMessageReplyMarkup`.
 * We do this strictly sequentially but without `delay` on success.
 * If we hit 429 Too Many Requests, we do a synchronous busy-wait, then continue.
 *
 * We will update the progress in the UI so the user knows it's not frozen.
 */
export async function getActivePostIds(channelId, adminId, maxDepth = 400, onProgress) {
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
  const total = latestId - start + 1;
  let checkedCount = 0;

  let lastProgressUpdate = Date.now();

  for (let msgId = latestId; msgId >= start; msgId--) {
    let success = false;
    let attempt = 0;
    while (!success && attempt < 3) {
      try {
        await api.editMessageReplyMarkup({
            chat_id: channelId,
            message_id: msgId,
            reply_markup: { inline_keyboard: [] }
        });
        activeIds.push(msgId);
        success = true;
      } catch (err) {
         const msg = err.description ? err.description.toLowerCase() : "";
         if (msg.includes('message is not modified') || msg.includes('there is no text') || msg.includes('message is not a text message')) {
             activeIds.push(msgId);
             success = true;
         } else if (msg.includes('too many requests') || msg.includes('retry after')) {
             const retryAfter = err.parameters?.retry_after || 1;
             const startWait = Date.now();
             while(Date.now() - startWait < (retryAfter * 1000) + 100) { }
             attempt++;
         } else {
             // "message to edit not found" -> deleted
             success = true;
         }
      }
    }
    checkedCount++;

    if (onProgress && Date.now() - lastProgressUpdate > 2000) {
       await onProgress(activeIds.length, checkedCount, total).catch(()=>{});
       lastProgressUpdate = Date.now();
    }
  }

  return activeIds.sort((a, b) => b - a);
}
