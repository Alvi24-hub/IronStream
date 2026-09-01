"""
IronStream — FastAPI Ingestion Pipeline
Teammate A (M2 MacBook Air) | Python 3.11+ | uvloop | redis.asyncio
"""
from __future__ import annotations

import asyncio
import collections
import json
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

# =============================================================================
# CONFIGURATION 
# =============================================================================
RING_BUFFER_SIZE = 30_000          # 500 evt/s × 60 s
FAULT_MARKERS = [b'"NaN"', b'"INVALID_TS"', b'"null"', b'"undefined"', b'NaN']

# =============================================================================
# IN-MEMORY STATE 
# =============================================================================
ring_buffer: collections.deque[dict[str, Any]] = collections.deque(maxlen=RING_BUFFER_SIZE)
ui_clients: list[WebSocket] = []

crdt_state: dict[str, Any] = {
    "alert_level": "normal",
    "sequence": 0
}

# =============================================================================
# STREAM INSPECTION GUARD 
# =============================================================================
def stream_inspection_guard(raw_bytes: bytes) -> tuple[bool, list[str]]:
    flags: list[str] = []
    for marker in FAULT_MARKERS:
        if marker in raw_bytes:
            flags.append(marker.decode("utf-8", errors="replace"))
    return len(flags) > 0, flags

# =============================================================================
# UI BROADCAST
# =============================================================================
async def broadcast_to_ui(payload: dict[str, Any]):
    dead: list[WebSocket] = []
    for ws in ui_clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in ui_clients:
            ui_clients.remove(ws)

# =============================================================================
# FASTAPI LIFESPAN
# =============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[SYSTEM] IronStream Pipeline Online | uvloop active")
    yield
    print("[SYSTEM] Shutting down...")

app = FastAPI(title="IronStream Dashboard", lifespan=lifespan)

# =============================================================================
# WEBSOCKET: SENSOR INGESTION (500 Hz Target)
# =============================================================================
@app.websocket("/ws/ingest")
async def websocket_ingest(websocket: WebSocket):
    await websocket.accept()
    print("[INGEST] Sensor stream connected")
    try:
        while True:
            # Accept either text or binary frames without crashing
            message = await websocket.receive()
            if "text" in message:
                raw_text = message["text"]
                raw_bytes = raw_text.encode("utf-8")
            elif "bytes" in message:
                raw_bytes = message["bytes"]
                raw_text = raw_bytes.decode("utf-8", errors="replace")
            else:
                continue

            # Zero-Allocation Ring Buffer
            ring_buffer.append({
                "ts": time.time_ns() // 1_000_000,
                "raw": raw_text
            })

            # Stream Inspection Guard
            is_corrupted, flags = stream_inspection_guard(raw_bytes)

            device_id = "unknown"
            parsed: dict[str, Any] = {}
            try:
                parsed = json.loads(raw_text)
                device_id = parsed.get("device_id", "unknown")
            except json.JSONDecodeError:
                is_corrupted = True
                flags.append("JSON_DECODE_ERROR")

            ui_payload = {
                "type": "fault" if is_corrupted else "telemetry",
                "device_id": device_id,
                "flags": flags,
                "payload": parsed if not is_corrupted else {"raw": raw_text},
                "ts": time.time_ns() // 1_000_000
            }

            await broadcast_to_ui(ui_payload)

    except WebSocketDisconnect:
        print("[INGEST] Sensor stream disconnected")
    except Exception as exc:
        print(f"[INGEST-FAULT] Unhandled exception: {exc}")

# =============================================================================
# REPLAY ENDPOINT (O(1) Flush from RAM)
# =============================================================================
@app.get("/api/replay")
async def replay_last_60s():
    return JSONResponse(content={
        "events": list(ring_buffer),
        "count": len(ring_buffer),
        "capacity": RING_BUFFER_SIZE,
        "replay_ms": time.time_ns() // 1_000_000
    })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        loop="uvloop",
        workers=1,
        log_level="warning"
    )


