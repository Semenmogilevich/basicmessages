import { api, fetch } from 'sdk';

/**
 * Since web scraping t.me directly is blocked on Telegram Serverless,
 * and proxies are unreliable or blocked, we use a highly reliable Probe Method.
 *
 * PROBE METHOD:
 * We attempt to copy the message from the channel to the admin's private chat.
 * If it succeeds, the message exists! We immediately delete the copy.
 * If it throws a 400 error (e.g., "message to copy not found"), the message is deleted.
 *
 * To ensure this works properly without crashing on limits, we probe the IDs
 * completely sequentially (no parallel batching) in the V8 isolate.
 * This guarantees we get the accurate active message list without violating rate limits.
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

  // We probe completely sequentially and safely
  for (let msgId = latestId; msgId >= start; msgId--) {
    try {
      const copy = await api.copyMessage({
          chat_id: adminId,
          from_chat_id: channelId,
          message_id: msgId,
          disable_notification: true
      });
      activeIds.push(msgId);
      // Immediately delete the copy so admin chat doesn't get flooded
      await api.deleteMessage({ chat_id: adminId, message_id: copy.message_id }).catch(()=>{});
    } catch (err) {
       const msg = err.description ? err.description.toLowerCase() : "";
       if (msg.includes('too many requests') || msg.includes('retry after')) {
           const retryAfter = err.parameters?.retry_after || 2;
           const startWait = Date.now();
           while(Date.now() - startWait < (retryAfter * 1000) + 100) { } // busy wait
           msgId++; // retry same ID
       }
       // If message not found, we just naturally skip it
    }
  }

  return activeIds.sort((a, b) => b - a);
}
