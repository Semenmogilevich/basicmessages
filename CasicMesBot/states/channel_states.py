from aiogram.fsm.state import State, StatesGroup

class ChannelStates(StatesGroup):
    waiting_for_channel = State()
    channel_menu = State()
    waiting_for_manual_id = State()
    waiting_for_content = State()
    choosing_range_type = State()
    waiting_for_range_param = State()
    confirm_replacement = State()
    waiting_for_telethon_code = State()
    processing = State()
