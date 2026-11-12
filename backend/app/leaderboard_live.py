"""Public invalidations contain no post, voter, or account information."""
import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()
_subscribers: set[asyncio.Queue] = set()


def publish_leaderboard_change() -> None:
    for queue in tuple(_subscribers):
        if queue.empty():
            queue.put_nowait(True)


@router.get('/leaderboard/events')
async def leaderboard_events(request: Request):
    async def events():
        queue = asyncio.Queue(maxsize=1)
        _subscribers.add(queue)
        try:
            yield 'retry: 3000\nevent: changed\ndata: {}\n\n'
            while not await request.is_disconnected():
                try:
                    await asyncio.wait_for(queue.get(), timeout=20)
                    yield 'event: changed\ndata: {}\n\n'
                except asyncio.TimeoutError:
                    yield ': keepalive\n\n'
        finally:
            _subscribers.discard(queue)
    return StreamingResponse(events(), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
    })
