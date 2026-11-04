import time
from collections import defaultdict

from fastapi import HTTPException, Request

_hits: dict[str, list[float]] = defaultdict(list)


def limit(request: Request, action: str, max_hits: int, window_seconds: int) -> None:
    host = request.client.host if request.client else "unknown"
    key = f"{action}:{host}"
    now = time.monotonic()
    recent = [stamp for stamp in _hits[key] if now - stamp < window_seconds]
    if len(recent) >= max_hits:
        raise HTTPException(status_code=429, detail="Slow down a second and try again.")
    recent.append(now)
    _hits[key] = recent
