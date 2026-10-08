from aiogram.filters import Filter
from aiogram.types import Message, CallbackQuery
from config import ADMIN_IDS

class AdminFilter(Filter):
    async def __call__(self, event: Message | CallbackQuery) -> bool:
        user = event.from_user
        return user is not None and user.id in ADMIN_IDS
