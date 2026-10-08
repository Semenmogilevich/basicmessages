import re
import asyncio
import aiohttp
from typing import Union, Tuple, Optional, List, Set
from aiogram import Bot
from aiogram.types import Chat
from aiogram.exceptions import TelegramBadRequest, TelegramRetryAfter

def parse_channel_input(text: str) -> Tuple[Union[int, str], Optional[int]]:
    text = text.strip()
    priv_post = re.search(r"t\.me/c/(\d+)/(\d+)", text)
    if priv_post:
        return int(f"-100{priv_post.group(1)}"), int(priv_post.group(2))

    pub_post = re.search(r"t\.me/([^/]+)/(\d+)", text)
    if pub_post and pub_post.group(1) != "c":
        return f"@{pub_post.group(1)}", int(pub_post.group(2))

    if "/c/" in text:
        match = re.search(r"/c/(\d+)", text)
        if match:
            return int(f"-100{match.group(1)}"), None

    if re.match(r"^-?\d+$", text):
        val = int(text)
        if not str(val).startswith("-100") and val > 0:
            return int(f"-100{val}"), None
        return val, None

    if "t.me/" in text:
        username = text.split("t.me/")[-1].split("/")[0].split("?")[0].strip("@")
        return f"@{username}", None

    if text.startswith("@"):
        return text, None
    return f"@{text}", None

async def verify_channel_rights(bot: Bot, channel_input: Union[int, str]) -> Tuple[bool, str, Optional[Chat]]:
    try:
        chat = await bot.get_chat(channel_input)
        if chat.type != "channel":
            return False, f"Указанный чат не является каналом ({chat.type}).", None

        bot_member = await bot.get_chat_member(chat.id, bot.id)
        if bot_member.status not in ["administrator", "creator"]:
            return False, "❌ Бот не назначен администратором в этом канале!", None

        if bot_member.status == "administrator":
            can_edit = getattr(bot_member, "can_edit_messages", False)
            if not can_edit:
                return False, "❌ У бота нет обязательного права: «Редактирование сообщений».", None

        return True, "✅ Права подтверждены!", chat
    except Exception as e:
        return False, f"❌ Ошибка доступа к каналу: {str(e)}", None

async def fetch_existing_posts_web(username: str) -> List[int]:
    clean_name = username.replace("https://t.me/", "").replace("t.me/", "").replace("@", "").split("/")[0]
    base_url = f"https://t.me/s/{clean_name}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    existing_ids: Set[int] = set()
    before_id: Optional[int] = None
    connector = aiohttp.TCPConnector(ssl=False)

    try:
        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            for _ in range(40):
                url = f"{base_url}?before={before_id}" if before_id else base_url
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=3.0), allow_redirects=True) as resp:
                    if resp.status != 200:
                        break
                    html = await resp.text()

                matches = [int(m) for m in re.findall(r'data-post="[^"/]+/(\d+)"', html)]
                if not matches:
                    break

                new_batch = set(matches) - existing_ids
                if not new_batch:
                    break

                existing_ids.update(new_batch)
                min_id = min(matches)
                if min_id <= 1:
                    break
                before_id = min_id
    except Exception:
        pass

    return sorted(list(existing_ids))

async def scan_channel_api_bulletproof(bot: Bot, chat_id: int, explicit_top: Optional[int] = None, progress_cb = None) -> List[int]:
    existing_ids: List[int] = []
    sem = asyncio.Semaphore(25)

    async def probe(msg_id: int) -> bool:
        async with sem:
            for _ in range(4):
                try:
                    await bot.edit_message_reply_markup(chat_id=chat_id, message_id=msg_id, reply_markup=None)
                    return True
                except TelegramBadRequest as e:
                    err = str(e).lower()
                    if "not modified" in err:
                        return True
                    if "message can't be edited" in err or "message cannot be edited" in err:
                        return True
                    if "not found" in err:
                        return False
                    return False
                except TelegramRetryAfter as e:
                    await asyncio.sleep(e.retry_after + 0.15)
                    continue
                except Exception:
                    return False
            return False

    if explicit_top and explicit_top > 0:
        checked_count = 0
        chunk_size = 35

        for chunk_start in range(1, explicit_top + 1, chunk_size):
            chunk = list(range(chunk_start, min(chunk_start + chunk_size, explicit_top + 1)))
            results = await asyncio.gather(*(probe(mid) for mid in chunk))
            for mid, exists in zip(chunk, results):
                if exists:
                    existing_ids.append(mid)
            checked_count += len(chunk)
            if progress_cb:
                try:
                    await progress_cb(len(existing_ids), checked_count, explicit_top)
                except Exception:
                    pass

        return sorted(existing_ids)

    chunk_size = 35
    current_start = 1
    consecutive_empty_chunks = 0
    max_scan_ceiling = 10000

    while current_start < max_scan_ceiling:
        chunk = list(range(current_start, current_start + chunk_size))
        results = await asyncio.gather(*(probe(mid) for mid in chunk))
        chunk_found = [mid for mid, exists in zip(chunk, results) if exists]

        if chunk_found:
            existing_ids.extend(chunk_found)
            consecutive_empty_chunks = 0
        else:
            consecutive_empty_chunks += 1
            if existing_ids and consecutive_empty_chunks >= 2:
                break
            if not existing_ids and current_start > 250:
                break

        if progress_cb:
            try:
                await progress_cb(len(existing_ids), current_start + chunk_size - 1, None)
            except Exception:
                pass

        current_start += chunk_size

    return sorted(existing_ids)
