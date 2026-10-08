from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

def get_channel_menu_kb(is_owner: bool = False, telethon_active: bool = False) -> InlineKeyboardMarkup:
    kb = [
        [InlineKeyboardButton(text="🔢 Посчитать сообщения (Bot API)", callback_data="btn_count_messages")],
        [InlineKeyboardButton(text="⚡️ Заменить посты (Bot API)", callback_data="btn_replace_messages")]
    ]

    if is_owner:
        if telethon_active:
            kb.append([InlineKeyboardButton(text="⚡️ Посчитать (Telethon 0.05s)", callback_data="btn_count_telethon")])
            kb.append([InlineKeyboardButton(text="🛡 Заменить посты (Telethon Твинк)", callback_data="btn_replace_telethon")])
            kb.append([InlineKeyboardButton(text="🔴 Выйти из Telethon", callback_data="btn_telethon_logout")])
        else:
            kb.append([InlineKeyboardButton(text="🔑 Войти в Telethon (Твинк)", callback_data="btn_telethon_login")])

    kb.extend([
        [InlineKeyboardButton(text="✏️ Указать последний пост вручную", callback_data="btn_set_id_manually")],
        [InlineKeyboardButton(text="📢 Сменить канал", callback_data="btn_change_channel")],
        [InlineKeyboardButton(text="❌ Закрыть меню", callback_data="btn_close")]
    ])
    return InlineKeyboardMarkup(inline_keyboard=kb)

def get_range_selection_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📋 Все сообщения канала", callback_data="rng_all")],
        [InlineKeyboardButton(text="⏱ Последние X сообщений", callback_data="rng_last_x")],
        [InlineKeyboardButton(text="🔢 С 1 по X сообщение", callback_data="rng_1_to_x")],
        [InlineKeyboardButton(text="⏩ С X по последнее сообщение", callback_data="rng_x_to_last")],
        [InlineKeyboardButton(text="❌ Отмена", callback_data="btn_cancel_replace")]
    ])

def get_numpad_kb(code_length: int = 0) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="1", callback_data="np:1"),
            InlineKeyboardButton(text="2", callback_data="np:2"),
            InlineKeyboardButton(text="3", callback_data="np:3")
        ],
        [
            InlineKeyboardButton(text="4", callback_data="np:4"),
            InlineKeyboardButton(text="5", callback_data="np:5"),
            InlineKeyboardButton(text="6", callback_data="np:6")
        ],
        [
            InlineKeyboardButton(text="7", callback_data="np:7"),
            InlineKeyboardButton(text="8", callback_data="np:8"),
            InlineKeyboardButton(text="9", callback_data="np:9")
        ],
        [
            InlineKeyboardButton(text="⌫ Стереть", callback_data="np:del"),
            InlineKeyboardButton(text="0", callback_data="np:0"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="btn_cancel_telethon_auth")
        ]
    ])

def get_confirm_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="🚀 Запустить замену", callback_data="btn_confirm_replace"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="btn_cancel_replace")
        ]
    ])

def get_cancel_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Отмена", callback_data="btn_cancel")]
    ])
