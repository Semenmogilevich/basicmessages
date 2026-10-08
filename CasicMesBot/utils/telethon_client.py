import asyncio
import os
import random
from typing import List, Tuple, Optional
from telethon import TelegramClient, errors
from config import API_ID, API_HASH, PHONE, PASSWORD, SESSION_NAME

client = TelegramClient(
    SESSION_NAME,
    API_ID,
    API_HASH,
    device_model="iPhone 16 Pro",
    system_version="iOS 18.0",
    app_version="11.2",
    lang_code="ru",
    system_lang_code="ru-RU"
)

auth_flow_data = {}

async def is_telethon_ready() -> bool:
    try:
        if not client.is_connected():
            await client.connect()
        return await client.is_user_authorized()
    except Exception:
        return False

async def start_persistent_auth() -> Tuple[bool, str]:
    try:
        if not client.is_connected():
            await client.connect()

        if await client.is_user_authorized():
            return True, "Уже авторизован"

        req = await client.send_code_request(PHONE)
        auth_flow_data["phone_code_hash"] = req.phone_code_hash
        return True, "Код отправлен"
    except Exception as e:
        return False, str(e)

async def complete_persistent_auth(code: str) -> Tuple[bool, str]:
    phone_code_hash = auth_flow_data.get("phone_code_hash")
    if not phone_code_hash:
        return False, "Сессия авторизации не найдена. Начни заново."

    try:
        try:
            await client.sign_in(PHONE, code, phone_code_hash=phone_code_hash)
        except errors.SessionPasswordNeededError:
            await client.sign_in(password=PASSWORD)
        auth_flow_data.clear()
        return True, "Успешная авторизация!"
    except errors.PhoneCodeInvalidError:
        return False, "❌ Неверный код подтверждения."
    except errors.PhoneCodeExpiredError:
        auth_flow_data.clear()
        return False, "❌ Срок действия кода истек."
    except Exception as e:
        auth_flow_data.clear()
        return False, f"❌ Ошибка входа: {e}"

async def logout_telethon() -> bool:
    try:
        if not client.is_connected():
            await client.connect()
        await client.log_out()
        return True
    except Exception:
        return False

async def get_channel_entity(target: str):
    if not client.is_connected():
        await client.connect()
    target_clean = target.strip()
    if target_clean.startswith("-100"):
        target_clean = int(target_clean)
    elif target_clean.isdigit():
        target_clean = int(f"-100{target_clean}")
    return await client.get_entity(target_clean)

async def get_channel_total_messages(entity) -> int:
    res = await client.get_messages(entity, limit=0)
    return res.total

async def get_existing_message_ids(entity) -> List[int]:
    ids = []
    async for msg in client.iter_messages(entity):
        if not msg.action:
            ids.append(msg.id)
    return sorted(ids)

async def telethon_edit_messages(
    entity,
    message_ids: List[int],
    text: str,
    media_path: Optional[str] = None,
    progress_callback = None
) -> Tuple[int, int]:
    edited = 0
    checked = 0
    total = len(message_ids)

    uploaded_file = None
    if media_path and os.path.exists(media_path):
        uploaded_file = await client.upload_file(media_path)

    sem = asyncio.Semaphore(3)

    async def replace_one(msg_id: int):
        nonlocal edited, checked
        async with sem:
            await asyncio.sleep(0.28 + random.uniform(0.02, 0.08))
            for attempt in range(8):
                try:
                    if uploaded_file:
                        try:
                            await client.edit_message(entity, msg_id, text=text, file=uploaded_file, parse_mode="html")
                        except Exception:
                            await client.edit_message(entity, msg_id, text=text, parse_mode="html")
                    else:
                        await client.edit_message(entity, msg_id, text=text, parse_mode="html")
                    edited += 1
                    break

                except errors.MessageNotModifiedError:
                    edited += 1
                    break

                except errors.FloodWaitError as e:
                    await asyncio.sleep(e.seconds + random.uniform(1.0, 2.5))
                    continue

                except (errors.MessageAuthorRequiredError, errors.MessageIdInvalidError):
                    break

                except Exception:
                    break

            checked += 1
            if progress_callback and checked % 5 == 0:
                try:
                    await progress_callback(checked, total, edited)
                except Exception:
                    pass

    tasks = [replace_one(mid) for mid in reversed(message_ids)]
    await asyncio.gather(*tasks)

    return edited, total - edited
