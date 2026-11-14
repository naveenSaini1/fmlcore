import time
from collections import defaultdict
from math import ceil

from fastapi import HTTPException, Request

_hits: dict[str, list[float]] = defaultdict(list)


def limit(
    request: Request, action: str, max_hits: int, window_seconds: int, *,
    actor_id: str | None = None,
) -> None:
    host = request.client.host if request.client else "unknown"
    key = f"{action}:{actor_id if actor_id is not None else host}"
    now = time.monotonic()
    recent = [stamp for stamp in _hits[key] if now - stamp < window_seconds]
    if len(recent) >= max_hits:
        if actor_id is not None:
            retry_after = ceil(window_seconds - (now - recent[0]))
            raise HTTPException(
                status_code=429,
                detail=f"Too many photo uploads. Try again in {ceil(retry_after / 60)} minute(s).",
                headers={"Retry-After": str(retry_after)},
            )
        raise HTTPException(status_code=429, detail="Slow down a second and try again.")
    recent.append(now)
    _hits[key] = recent
