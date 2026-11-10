import asyncio
import json
import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket.auth import (
    authenticate_websocket_handshake,
    decode_ws_token,
    verify_user_exists,
)
from app.websocket.connection import WebSocketConnection
from app.websocket.events import (
    AUTH_AUTHENTICATE,
    AUTH_ERROR,
    AUTH_SUCCESS,
    CONNECTION_ERROR,
    CONNECTION_PING,
    CONNECTION_PONG,
    CONNECTION_READY,
    PRESENCE_QUERY,
    PRESENCE_STATUS,
    make_event,
)
from app.websocket.manager import ws_manager
from app.websocket.router import ws_router

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Central reusable WebSocket endpoint for FMLCore."""
    # 1. Attempt handshake authentication (cookies / query token)
    user_id = authenticate_websocket_handshake(websocket)

    if user_id and not verify_user_exists(user_id):
        user_id = None

    await websocket.accept()

    # 2. If not authenticated at handshake, allow a 5-second window for auth message
    if not user_id:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            data = json.loads(raw)
            if data.get("event") == AUTH_AUTHENTICATE:
                token = data.get("data", {}).get("token") or data.get("data", {}).get("ticket")
                candidate_id = decode_ws_token(token) if token else None
                if candidate_id and verify_user_exists(candidate_id):
                    user_id = candidate_id
                    await websocket.send_json(make_event(AUTH_SUCCESS, {"user_id": str(user_id)}))
                else:
                    await websocket.send_json(make_event(AUTH_ERROR, {"message": "Invalid authentication token."}))
                    await websocket.close(code=4001, reason="Unauthorized")
                    return
            else:
                await websocket.send_json(make_event(AUTH_ERROR, {"message": "Authentication required."}))
                await websocket.close(code=4001, reason="Unauthorized")
                return
        except (asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
            try:
                await websocket.close(code=4001, reason="Authentication timeout")
            except Exception:
                pass
            return

    # 3. Connection is authenticated. Register with manager.
    connection = await ws_manager.connect(websocket=websocket, user_id=user_id)

    # 4. Send connection.ready event
    await connection.send_event(
        event=CONNECTION_READY,
        data={
            "user_id": str(user_id),
            "connection_id": connection.connection_id,
            "connected_at": connection.connected_at.isoformat(),
        },
    )

    # 5. Receive loop
    try:
        while True:
            raw_text = await websocket.receive_text()
            if not raw_text.strip():
                continue

            try:
                msg = json.loads(raw_text)
            except json.JSONDecodeError:
                await connection.send_event(
                    event=CONNECTION_ERROR,
                    data={"message": "Malformed JSON payload."},
                )
                continue

            event_name = msg.get("event")
            if not event_name or not isinstance(event_name, str):
                await connection.send_event(
                    event=CONNECTION_ERROR,
                    data={"message": "Missing 'event' field."},
                )
                continue

            event_id = msg.get("event_id") or ""
            data_payload = msg.get("data")
            if not isinstance(data_payload, dict):
                data_payload = {}

            # Handle system ping / pong
            if event_name == CONNECTION_PING:
                await connection.send_event(event=CONNECTION_PONG, data={}, event_id=event_id)
                continue

            # Dispatch to feature router
            await ws_router.dispatch(
                connection=connection,
                event=event_name,
                data=data_payload,
                event_id=event_id,
            )

    except WebSocketDisconnect:
        logger.debug("WebSocket client disconnected: %s", user_id)
    except Exception as err:
        logger.warning("WebSocket connection exception for %s: %s", user_id, err)
    finally:
        await ws_manager.disconnect(connection)


@ws_router.on(PRESENCE_QUERY)
async def handle_presence_query(
    connection: WebSocketConnection,
    data: dict[str, Any],
    event_id: str,
) -> None:
    raw_ids = data.get("user_ids", [])
    valid_uids = []
    for r in raw_ids:
        try:
            valid_uids.append(UUID(str(r)))
        except (ValueError, TypeError):
            pass
    online_uids = [str(uid) for uid in ws_manager.get_online_users(valid_uids)]
    await connection.send_event(
        event=PRESENCE_STATUS,
        data={"online_user_ids": online_uids},
        event_id=event_id,
    )
