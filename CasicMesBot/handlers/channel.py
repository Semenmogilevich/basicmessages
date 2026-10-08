import os
import time
import asyncio
import random
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InputMediaPhoto, MessageEntity
from aiogram.fsm.context import FSMContext
from aiogram.exceptions import TelegramBadRequest, TelegramRetryAfter
from config import OWNER_ID, PHONE
from filters.admin_filter import AdminFilter
from states.channel_states import ChannelStates
from keyboards.inline import (
    get_channel_menu_kb,
    get_range_selection_kb,
    get_confirm_kb,
    get_cancel_kb,
    get_numpad_kb
)
from utils.helpers import parse_channel_input, verify_channel_rights, fetch_existing_posts_web, scan_channel_api_bulletproof
from utils.telethon_client import (
    is_telethon_ready,
    start_persistent_auth,
    complete_persistent_auth,
    logout_telethon,
    get_channel_entity,
    get_channel_total_messages,
    get_existing_message_ids,
    telethon_edit_messages
)

router = Router()
router.message.filter(AdminFilter())
router.callback_query.filter(AdminFilter())

async def render_channel_menu(call_or_msg, state: FSMContext, user_id: int):
    data = await state.get_data()
    is_owner = (user_id == OWNER_ID)
    telethon_active = False

    if is_owner:
        telethon_active = await is_telethon_ready()

    explicit_id = data.get("explicit_id")
    id_note = f"\n🎯 Задан верхний ID: <b>{explicit_id}</b>" if explicit_id else ""
    telethon_status = "🟢 Telethon: Подключен" if telethon_active else "⚪️ Telethon: Не авторизован"
    owner_info = f"\nℹ️ <i>{telethon_status}</i>" if is_owner else ""

    text = f"📢 Канал: <b>{data['channel_title']}</b>{id_note}{owner_info}\n\nВыбери действие:"
    kb = get_channel_menu_kb(is_owner=is_owner, telethon_active=telethon_active)

    if isinstance(call_or_msg, CallbackQuery):
        await call_or_msg.message.edit_text(text, reply_markup=kb)
    else:
        await call_or_msg.answer(text, reply_markup=kb)

@router.message(ChannelStates.waiting_for_channel)
async def process_channel_input(message: Message, state: FSMContext):
    if not message.text:
        await message.answer("Пришли ссылку или юзернейм канала.")
        return

    raw_target = message.text.strip()
    target, explicit_id = parse_channel_input(raw_target)
    status_msg = await message.answer("🔍 Подключаюсь к каналу...")

    is_ok, err_desc, chat = await verify_channel_rights(message.bot, target)
    if not is_ok:
        await status_msg.edit_text(f"{err_desc}\n\nПопробуй еще раз:")
        return

    await state.update_data(
        raw_target=raw_target,
        channel_id=chat.id,
        channel_title=chat.title,
        channel_username=chat.username,
        explicit_id=explicit_id,
        existing_ids=[]
    )

    await status_msg.delete()
    await render_channel_menu(message, state, message.from_user.id)
    await state.set_state(ChannelStates.channel_menu)

@router.callback_query(F.data == "btn_set_id_manually", ChannelStates.channel_menu)
async def cb_set_id_manually(call: CallbackQuery, state: FSMContext):
    await call.message.edit_text(
        "✏️ Отправь <b>число последнего ID</b> (например, <code>312</code>)\n"
        "Или пришли прямую ссылку на последний пост в канале:",
        reply_markup=get_cancel_kb()
    )
    await state.set_state(ChannelStates.waiting_for_manual_id)
    await call.answer()

@router.message(ChannelStates.waiting_for_manual_id)
async def process_manual_id(message: Message, state: FSMContext):
    text = (message.text or "").strip()
    new_id = None

    if text.isdigit():
        new_id = int(text)
    else:
        _, parsed_id = parse_channel_input(text)
        if parsed_id:
            new_id = parsed_id

    if not new_id or new_id <= 0:
        await message.answer("Не удалось распознать ID. Отправь просто число или ссылку на пост:")
        return

    await state.update_data(explicit_id=new_id, existing_ids=[])
    await render_channel_menu(message, state, message.from_user.id)
    await state.set_state(ChannelStates.channel_menu)

@router.callback_query(F.data == "btn_change_channel")
async def cb_change_channel(call: CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.edit_text("Отправь ссылку или юзернейм нового канала:", reply_markup=get_cancel_kb())
    await state.set_state(ChannelStates.waiting_for_channel)
    await call.answer()

# ==================== ПОДСЧЕТ ====================

@router.callback_query(F.data == "btn_count_messages", ChannelStates.channel_menu)
async def cb_count_messages(call: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    username = data.get("channel_username")
    channel_id = data["channel_id"]
    channel_title = data["channel_title"]
    explicit_id = data.get("explicit_id")

    status_msg = await call.message.edit_text("🔍 Проверяю сообщения в канале...")
    await call.answer()

    existing_ids = []
    if username:
        try:
            existing_ids = await fetch_existing_posts_web(username)
        except Exception:
            existing_ids = []

    if not existing_ids:
        try:
            await status_msg.edit_text("🔍 Сканирую канал через Telegram API...")
        except Exception:
            pass

        async def on_api_progress(found: int, checked: int, total: int | None):
            total_str = f"/{total}" if total else ""
            try:
                await status_msg.edit_text(
                    f"🔍 Сканирую канал <b>{channel_title}</b>...\n"
                    f"Проверено: <code>{checked}{total_str}</code> | Живых постов: <b>{found}</b>"
                )
            except Exception:
                pass

        existing_ids = await scan_channel_api_bulletproof(call.bot, channel_id, explicit_id, on_api_progress)

    await state.update_data(existing_ids=existing_ids)
    is_owner = (call.from_user.id == OWNER_ID)
    telethon_active = await is_telethon_ready() if is_owner else False

    await status_msg.edit_text(
        f"📊 <b>Результат проверки (Bot API):</b>\n\n"
        f"📢 Канал: <b>{channel_title}</b>\n"
        f"✅ <b>Реально существующих сообщений:</b> <b>{len(existing_ids)}</b>\n\n"
        f"<i>(Удаленные сообщения отсеяны)</i>",
        reply_markup=get_channel_menu_kb(is_owner=is_owner, telethon_active=telethon_active)
    )

# ==================== TELETHON АВТОРИЗАЦИЯ ====================

@router.callback_query(F.data == "btn_telethon_login", ChannelStates.channel_menu)
async def cb_telethon_login(call: CallbackQuery, state: FSMContext):
    if call.from_user.id != OWNER_ID:
        await call.answer("Доступ запрещен.", show_alert=True)
        return

    await call.message.edit_text("⏳ Запрашиваю код подтверждения в Telegram...")
    await call.answer()

    ok, desc = await start_persistent_auth()
    if not ok:
        await call.message.edit_text(f"❌ Ошибка Telethon: {desc}")
        await asyncio.sleep(2)
        await render_channel_menu(call, state, call.from_user.id)
        return

    await state.update_data(entered_code="")
    await state.set_state(ChannelStates.waiting_for_telethon_code)

    await call.message.edit_text(
        f"📩 <b>Код отправлен в Telegram ({PHONE})!</b>\n\n"
        "Введи код кнопками на клавиатуре ниже:\n\n"
        "Код: <code>[ _ _ _ _ _ ]</code>",
        reply_markup=get_numpad_kb()
    )

@router.callback_query(F.data == "btn_telethon_logout", ChannelStates.channel_menu)
async def cb_telethon_logout(call: CallbackQuery, state: FSMContext):
    if call.from_user.id != OWNER_ID:
        await call.answer("Доступ запрещен.", show_alert=True)
        return

    await logout_telethon()
    await call.answer("Сессия твинка удалена!", show_alert=True)
    await render_channel_menu(call, state, call.from_user.id)

@router.callback_query(F.data == "btn_count_telethon", ChannelStates.channel_menu)
async def cb_count_telethon(call: CallbackQuery, state: FSMContext):
    if call.from_user.id != OWNER_ID:
        await call.answer("Доступ запрещен.", show_alert=True)
        return

    data = await state.get_data()
    raw_target = data.get("raw_target") or str(data["channel_id"])
    title = data["channel_title"]

    try:
        t0 = time.time()
        entity = await get_channel_entity(raw_target)
        total = await get_channel_total_messages(entity)
        elapsed = time.time() - t0

        await call.message.edit_text(
            f"📊 <b>Результат проверки (Telethon MTProto):</b>\n\n"
            f"📢 Канал: <b>{title}</b>\n"
            f"✅ Реальных сообщений в канале: <b>{total}</b>\n"
            f"⚡️ Время вычисления: <code>{elapsed:.2f} сек</code>",
            reply_markup=get_channel_menu_kb(is_owner=True, telethon_active=True)
        )
    except Exception as e:
        await call.message.edit_text(f"❌ Ошибка Telethon: {e}")
        await asyncio.sleep(2)
        await render_channel_menu(call, state, call.from_user.id)
    await call.answer()

@router.callback_query(F.data.startswith("np:"), ChannelStates.waiting_for_telethon_code)
async def cb_numpad_input(call: CallbackQuery, state: FSMContext):
    action = call.data.split(":")[1]
    data = await state.get_data()
    code = data.get("entered_code", "")

    if action.isdigit():
        if len(code) < 5:
            code += action
    elif action == "del":
        code = code[:-1]

    await state.update_data(entered_code=code)

    if len(code) == 5:
        await call.message.edit_text(f"⏳ Проверяю код <code>{code}</code>...")
        await call.answer()

        ok, msg = await complete_persistent_auth(code)
        if not ok:
            await call.message.edit_text(f"{msg}\n\nПопробуй ввести еще раз:", reply_markup=get_numpad_kb())
            await state.update_data(entered_code="")
            return

        await call.message.edit_text("✅ <b>Telethon успешно авторизован!</b>")
        await asyncio.sleep(1.5)
        await render_channel_menu(call, state, call.from_user.id)
        await state.set_state(ChannelStates.channel_menu)
        return

    stars = " ".join([code[i] if i < len(code) else "_" for i in range(5)])
    try:
        await call.message.edit_text(
            f"📩 <b>Код отправлен в Telegram ({PHONE})!</b>\n\n"
            "Введи код кнопками на клавиатуре ниже:\n\n"
            f"Код: <code>[ {stars} ]</code>",
            reply_markup=get_numpad_kb(len(code))
        )
    except Exception:
        pass
    await call.answer()

@router.callback_query(F.data == "btn_cancel_telethon_auth", ChannelStates.waiting_for_telethon_code)
async def cb_cancel_telethon_auth(call: CallbackQuery, state: FSMContext):
    await render_channel_menu(call, state, call.from_user.id)
    await state.set_state(ChannelStates.channel_menu)
    await call.answer()

# ==================== ЗАМЕНА И ВЫБОР ДИАПАЗОНА ====================

@router.callback_query(F.data == "btn_replace_messages", ChannelStates.channel_menu)
async def cb_ask_content_bot(call: CallbackQuery, state: FSMContext):
    await state.update_data(engine="bot")
    await call.message.edit_text(
        "📥 <b>[Bot API] Отправь сообщение для замены:</b>\n\n"
        "• Текст с любым оформлением (жирный, курсив, спойлеры, скрытые ссылки, код)\n"
        "• Либо фото с описанием.",
        reply_markup=get_cancel_kb()
    )
    await state.set_state(ChannelStates.waiting_for_content)
    await call.answer()

@router.callback_query(F.data == "btn_replace_telethon", ChannelStates.channel_menu)
async def cb_ask_content_telethon(call: CallbackQuery, state: FSMContext):
    if call.from_user.id != OWNER_ID:
        await call.answer("Доступ запрещен.", show_alert=True)
        return

    await state.update_data(engine="telethon")
    await call.message.edit_text(
        "📥 <b>[Telethon Твинк] Отправь сообщение для замены:</b>\n\n"
        "• Текст с разметкой (жирный, ссылки, спойлеры, код)\n"
        "• Либо фото с описанием.",
        reply_markup=get_cancel_kb()
    )
    await state.set_state(ChannelStates.waiting_for_content)
    await call.answer()

@router.message(ChannelStates.waiting_for_content)
async def process_replacement_content(message: Message, state: FSMContext):
    photo_id = None
    text_content = ""
    raw_entities = []
    media_path = None
    formatted_html = message.html_text or ""

    if message.photo:
        photo = message.photo[-1]
        photo_id = photo.file_id
        text_content = message.caption or ""
        raw_entities = [e.model_dump() for e in (message.caption_entities or [])]

        os.makedirs("downloads", exist_ok=True)
        media_path = f"downloads/photo_{photo.file_unique_id}.jpg"
        await message.bot.download(photo.file_id, destination=media_path)
    elif message.text:
        text_content = message.text
        raw_entities = [e.model_dump() for e in (message.entities or [])]
    else:
        await message.answer("Пришли текст или фото с подписью!")
        return

    await state.update_data(
        replace_photo=photo_id,
        replace_text=text_content,
        replace_entities=raw_entities,
        media_path=media_path,
        formatted_html=formatted_html
    )

    await message.answer(
        "🎯 <b>Выбери, какие сообщения менять:</b>",
        reply_markup=get_range_selection_kb()
    )
    await state.set_state(ChannelStates.choosing_range_type)

@router.callback_query(F.data.startswith("rng_"), ChannelStates.choosing_range_type)
async def process_range_choice(call: CallbackQuery, state: FSMContext):
    choice = call.data

    if choice == "rng_all":
        await state.update_data(range_type="all", range_param=0)
        await show_replacement_confirmation(call, state)
        return

    prompts = {
        "rng_last_x": "⏱ Введи число <b>X</b> (сколько последних сообщений изменить):",
        "rng_1_to_x": "🔢 Введи число <b>X</b> (изменить с 1 по какое сообщение):",
        "rng_x_to_last": "⏩ Введи число <b>X</b> (начиная с какого сообщения и до конца менять):"
    }

    await state.update_data(range_type=choice.replace("rng_", ""))
    await call.message.edit_text(prompts[choice], reply_markup=get_cancel_kb())
    await state.set_state(ChannelStates.waiting_for_range_param)
    await call.answer()

@router.message(ChannelStates.waiting_for_range_param)
async def process_range_param_input(message: Message, state: FSMContext):
    val = (message.text or "").strip()
    if not val.isdigit() or int(val) <= 0:
        await message.answer("Пожалуйста, отправь положительное число X:")
        return

    await state.update_data(range_param=int(val))
    await show_replacement_confirmation(message, state)

async def show_replacement_confirmation(event: Message | CallbackQuery, state: FSMContext):
    data = await state.get_data()
    engine_name = "Telethon (Твинк)" if data.get("engine") == "telethon" else "Bot API"
    r_type = data.get("range_type", "all")
    r_param = data.get("range_param", 0)

    range_desc = {
        "all": "Все сообщения канала",
        "last_x": f"Последние <b>{r_param}</b> сообщений",
        "1_to_x": f"С 1 по <b>{r_param}</b> сообщение",
        "x_to_last": f"С <b>{r_param}</b> по последнее сообщение"
    }.get(r_type, "Все")

    text = (
        f"⚠️ <b>Подтверждение замены</b>\n\n"
        f"📢 Канал: <b>{data['channel_title']}</b>\n"
        f"⚙️ Режим: <b>{engine_name}</b>\n"
        f"🎯 Диапазон: {range_desc}\n"
        f"📦 Формат: <b>{'Фото + Текст' if data.get('replace_photo') else 'Только текст'}</b>\n\n"
        f"Запустить замену публикаций?"
    )

    if isinstance(event, CallbackQuery):
        await event.message.edit_text(text, reply_markup=get_confirm_kb())
    else:
        await event.answer(text, reply_markup=get_confirm_kb())
    await state.set_state(ChannelStates.confirm_replacement)

@router.callback_query(F.data == "btn_cancel_replace", ChannelStates.confirm_replacement)
async def cb_cancel_replace(call: CallbackQuery, state: FSMContext):
    await render_channel_menu(call, state, call.from_user.id)
    await state.set_state(ChannelStates.channel_menu)
    await call.answer()

@router.callback_query(F.data == "btn_confirm_replace", ChannelStates.confirm_replacement)
async def cb_execute_replacement_start(call: CallbackQuery, state: FSMContext):
    data = await state.get_data()
    engine = data.get("engine", "bot")
    range_type = data.get("range_type", "all")
    range_param = data.get("range_param", 0)

    # 1. TELETHON
    if engine == "telethon":
        raw_target = data.get("raw_target") or str(data["channel_id"])
        title = data["channel_title"]
        html_text = data.get("formatted_html", "")
        media_path = data.get("media_path")

        await state.set_state(ChannelStates.processing)
        status_msg = await call.message.edit_text("⚡️ [Telethon] Получаю посты канала по MTProto...")
        await call.answer()

        try:
            entity = await get_channel_entity(raw_target)
            all_ids = await get_existing_message_ids(entity)

            # Применение диапазона
            if range_type == "last_x":
                target_ids = all_ids[-range_param:]
            elif range_type == "1_to_x":
                target_ids = all_ids[:range_param]
            elif range_type == "x_to_last":
                target_ids = all_ids[max(0, range_param - 1):]
            else:
                target_ids = all_ids

            total = len(target_ids)
            if total == 0:
                await status_msg.edit_text("В выбранном диапазоне нет сообщений.")
                await asyncio.sleep(2)
                await render_channel_menu(call, state, call.from_user.id)
                await state.set_state(ChannelStates.channel_menu)
                return

            await status_msg.edit_text(f"🚀 [Telethon] Выбрано <b>{total}</b> постов. Запуск...")

            async def on_telethon_progress(done, total_cnt, edited_cnt):
                pct = (done / total_cnt) * 100
                try:
                    await status_msg.edit_text(
                        f"⚡️ <b>[Telethon] Замена постов...</b>\n\n"
                        f"Прогресс: <code>{done}/{total_cnt}</code> ({pct:.0f}%)\n"
                        f"✅ Отредактировано: <b>{edited_cnt}</b>"
                    )
                except Exception:
                    pass

            edited, skipped = await telethon_edit_messages(
                entity, target_ids, html_text, media_path, on_telethon_progress
            )

            if media_path and os.path.exists(media_path):
                os.remove(media_path)

            await status_msg.edit_text(
                f"🏁 <b>[Telethon] Замена завершена!</b>\n\n"
                f"📢 Канал: <b>{title}</b>\n"
                f"✅ Отредактировано: <b>{edited}</b>\n"
                f"⏭ Пропущено: <b>{skipped}</b>",
                reply_markup=get_channel_menu_kb(is_owner=True, telethon_active=True)
            )
            await state.set_state(ChannelStates.channel_menu)
            return

        except Exception as e:
            await status_msg.edit_text(f"❌ Ошибка Telethon: {e}")
            await asyncio.sleep(2)
            await render_channel_menu(call, state, call.from_user.id)
            await state.set_state(ChannelStates.channel_menu)
            return

    # 2. BOT API
    channel_id = data["channel_id"]
    channel_title = data["channel_title"]
    username = data.get("channel_username")
    explicit_id = data.get("explicit_id")
    photo_id = data.get("replace_photo")
    content_text = data.get("replace_text", "")
    raw_entities = data.get("replace_entities", [])
    existing_ids = data.get("existing_ids", [])

    await state.set_state(ChannelStates.processing)
    status_msg = await call.message.edit_text("⚡️ Подготовка к замене постов...")
    await call.answer()

    if not existing_ids:
        if username:
            try:
                existing_ids = await fetch_existing_posts_web(username)
            except Exception:
                existing_ids = []

        if not existing_ids:
            existing_ids = await scan_channel_api_bulletproof(call.bot, channel_id, explicit_id)

        await state.update_data(existing_ids=existing_ids)

    # Применение диапазона
    if range_type == "last_x":
        target_ids = existing_ids[-range_param:]
    elif range_type == "1_to_x":
        target_ids = existing_ids[:range_param]
    elif range_type == "x_to_last":
        target_ids = existing_ids[max(0, range_param - 1):]
    else:
        target_ids = existing_ids

    total_target = len(target_ids)
    if total_target == 0:
        await status_msg.edit_text("В выбранном диапазоне нет сообщений.")
        await asyncio.sleep(2)
        await render_channel_menu(call, state, call.from_user.id)
        await state.set_state(ChannelStates.channel_menu)
        return

    entities = [MessageEntity(**e) for e in raw_entities] if raw_entities else None
    caption_text = content_text[:1024] if content_text else ""
    caption_entities = [e for e in entities if (e.offset + e.length) <= 1024] if entities else None

    text_content_safe = content_text[:4096] if content_text else ""
    text_entities_safe = [e for e in entities if (e.offset + e.length) <= 4096] if entities else None

    edited = 0
    checked = 0
    is_running = True
    sem = asyncio.Semaphore(18)

    async def replace_one(msg_id: int):
        nonlocal edited, checked
        async with sem:
            await asyncio.sleep(random.uniform(0.04, 0.08))
            for attempt in range(8):
                try:
                    if photo_id:
                        media = InputMediaPhoto(
                            media=photo_id,
                            caption=caption_text,
                            caption_entities=caption_entities,
                            parse_mode=None
                        )
                        await call.bot.edit_message_media(chat_id=channel_id, message_id=msg_id, media=media)
                        edited += 1
                        break
                    else:
                        await call.bot.edit_message_text(
                            chat_id=channel_id,
                            message_id=msg_id,
                            text=text_content_safe,
                            entities=text_entities_safe,
                            parse_mode=None,
                            disable_web_page_preview=False
                        )
                        edited += 1
                        break

                except TelegramBadRequest as e:
                    err = str(e).lower()
                    if "not modified" in err:
                        edited += 1
                        break

                    if "there is no media" in err and photo_id:
                        try:
                            await call.bot.edit_message_text(
                                chat_id=channel_id,
                                message_id=msg_id,
                                text=text_content_safe if text_content_safe else " ",
                                entities=text_entities_safe if text_content_safe else None,
                                parse_mode=None,
                                disable_web_page_preview=False
                            )
                            edited += 1
                            break
                        except Exception:
                            break

                    elif "there is no text" in err and not photo_id:
                        try:
                            await call.bot.edit_message_caption(
                                chat_id=channel_id,
                                message_id=msg_id,
                                caption=caption_text,
                                caption_entities=caption_entities,
                                parse_mode=None
                            )
                            edited += 1
                            break
                        except Exception:
                            break
                    break

                except TelegramRetryAfter as e:
                    await asyncio.sleep(e.retry_after + random.uniform(0.1, 0.3))
                    continue
                except Exception:
                    break
            checked += 1

    async def progress_tracker():
        while is_running:
            await asyncio.sleep(1.0)
            pct = (checked / total_target * 100) if total_target > 0 else 0
            try:
                await status_msg.edit_text(
                    f"⚡️ <b>Замена постов на канале...</b>\n\n"
                    f"Прогресс: <code>{checked}/{total_target}</code> ({pct:.0f}%)\n"
                    f"✅ Отредактировано: <b>{edited}</b>"
                )
            except Exception:
                pass

    tracker = asyncio.create_task(progress_tracker())
    tasks = [replace_one(mid) for mid in reversed(target_ids)]
    await asyncio.gather(*tasks)

    is_running = False
    tracker.cancel()

    is_owner = (call.from_user.id == OWNER_ID)
    telethon_active = await is_telethon_ready() if is_owner else False

    await status_msg.edit_text(
        f"🏁 <b>Все живые посты успешно обновлены!</b>\n\n"
        f"📢 Канал: <b>{channel_title}</b>\n"
        f"✅ Изменено сообщений: <b>{edited}</b> из <b>{total_target}</b>",
        reply_markup=get_channel_menu_kb(is_owner=is_owner, telethon_active=telethon_active)
    )
    await state.set_state(ChannelStates.channel_menu)
