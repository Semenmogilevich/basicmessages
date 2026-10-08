from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from filters.admin_filter import AdminFilter
from states.channel_states import ChannelStates
from keyboards.inline import get_cancel_kb

router = Router()
router.message.filter(AdminFilter())
router.callback_query.filter(AdminFilter())

@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "👋 <b>Панель управления каналом</b>\n\n"
        "Отправь мне:\n"
        "• Ссылку на канал или <code>@username</code>\n"
        "• Либо <b>прямую ссылку на последний пост</b> (например, <code>t.me/channel/350</code>), если канал закрытый.",
        reply_markup=get_cancel_kb()
    )
    await state.set_state(ChannelStates.waiting_for_channel)

@router.callback_query(F.data == "btn_close")
async def cb_close(call: CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.edit_text("Сессия закрыта. Напиши /start для повторного запуска.")
    await call.answer()

@router.callback_query(F.data == "btn_cancel")
async def cb_cancel(call: CallbackQuery, state: FSMContext):
    await state.clear()
    await call.message.edit_text("Отменено. Напиши /start для запуска.")
    await call.answer()
