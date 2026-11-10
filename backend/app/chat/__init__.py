from app.chat.routes import router as chat_router
import app.chat.websocket_handler  # noqa: F401 - registers handlers with ws_router

__all__ = ["chat_router"]
