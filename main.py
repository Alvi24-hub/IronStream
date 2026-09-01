"""
IronStream — FastAPI Ingestion Pipeline with TimescaleDB Batch Persistence
Teammate A (M2 MacBook Air) | Python 3.11+ | uvloop | asyncpg
"""
from __future__ import annotations

import asyncio
import collections
import json
import os
import time
import getpass
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

# =============================================================================
# CONFIGURATION 
# =============================================================================
RING_BUFFER_SIZE = 30_000          # 500 evt/s × 60 s
FAULT_MARKERS = [b'"NaN"', b'"INVALID_TS"', b'"null"', b'"undefined"', b'NaN']

db_user = getpass.getuser()
DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://{db_user}@localhost:5432/ironstream")

BATCH_SIZE = 500
FLUSH_INTERVAL_SEC = 2.0

# =============================================================================
# IN-MEMORY STATE & DB POOL
# =============================================================================
ring_buffer: collections.deque[dict[str, Any]] = collections.deque(maxlen=RING_BUFFER_SIZE)
db_batch_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100_000)
ui_clients: list[WebSocket] = []

db_pool: asyncpg.Pool | None = None

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
# BACKGROUND TIMESCALEDB BATCH WRITER
# =============================================================================
async def timescaledb_batch_writer():
    global db_pool
    while True:
        await asyncio.sleep(FLUSH_INTERVAL_SEC)
        if db_pool is None:
            continue
        
        batch = []
        while not db_batch_queue.empty() and len(batch) < BATCH_SIZE:
            try:
                batch.append(db_batch_queue.get_nowait())
            except asyncio.QueueEmpty:
                break
                
        if not batch:
            continue

        try:
            async with db_pool.acquire() as conn:
                records = []
                for item in batch:
                    ts = item["ts"]
                    from datetime import datetime
                    dt = datetime.fromtimestamp(ts / 1000)
                    device_id = item["device_id"]
                    payload = item["payload"]
                    is_fault = item["type"] == "fault"
                    
                    metrics = payload.get("metrics", {})
                    temp = metrics.get("temperature") if isinstance(metrics.get("temperature"), (int, float)) else None
                    vib = metrics.get("vibration") if isinstance(metrics.get("vibration"), (int, float)) else None
                    raw_str = json.dumps(payload)

                    records.append((dt, device_id, temp, vib, is_fault, raw_str))

                await conn.executemany(
                    """
                    INSERT INTO sensor_metrics (time, device_id, temperature, vibration, is_fault, raw_payload)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    records
                )
        except Exception as exc:
            print(f"[DB-FLUSH-ERROR] Failed to write batch to TimescaleDB: {exc}")

# =============================================================================
# UI BROADCAST
# =============================================================================
async def broadcast_to_ui(payload: dict[str, Any]):
    dead: list[WebSocket] = []
    tasks = []
    for ws in ui_clients:
        tasks.append(asyncio.create_task(safe_send(ws, payload)))
    
    # Wait for all sends with timeout
    done, pending = await asyncio.wait(tasks, timeout=0.05)
    for task in done:
        try:
            await task
        except Exception:
            pass
    # Cancel remaining
    for task in pending:
        task.cancel()

async def safe_send(ws: WebSocket, payload: dict):
    try:
        await ws.send_json(payload)
    except Exception:
        raise

# =============================================================================
# FASTAPI LIFESPAN
# =============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    print("[SYSTEM] IronStream Pipeline Online | uvloop active")
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        print("[DB] Connected to TimescaleDB pool successfully")
    except Exception as exc:
        print(f"[DB-WARN] Running without TimescaleDB persistence: {exc}")
        db_pool = None

    writer_task = asyncio.create_task(timescaledb_batch_writer())
    yield
    writer_task.cancel()
    if db_pool:
        await db_pool.close()
    print("[SYSTEM] Shutting down...")

app = FastAPI(title="IronStream Dashboard", lifespan=lifespan)

# =============================================================================
# WEBSOCKET: SENSOR INGESTION (500 Hz Target)
# =============================================================================
@app.websocket("/ws/ingest")
async def websocket_ingest(websocket: WebSocket):
    await websocket.accept()
    ui_clients.append(websocket)
    print("[INGEST] Sensor stream connected")
    try:
        while True:
            message = await websocket.receive()
            msg_type = message.get("type")
            if msg_type == "websocket.disconnect":
                break
            if msg_type == "websocket.ping":
                await websocket.send({ "type": "websocket.pong" })
                continue

            if "text" in message:
                raw_text = message["text"]
                raw_bytes = raw_text.encode("utf-8")
            elif "bytes" in message:
                raw_bytes = message["bytes"]
                raw_text = raw_bytes.decode("utf-8", errors="replace")
            else:
                continue

            current_ts = time.time_ns() // 1_000_000

            ring_buffer.append({
                "ts": current_ts,
                "raw": raw_text
            })

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
                "ts": current_ts
            }

            if db_pool and not db_batch_queue.full():
                try:
                    db_batch_queue.put_nowait(ui_payload)
                except asyncio.QueueFull:
                    pass

            await broadcast_to_ui(ui_payload)

    except WebSocketDisconnect:
        print("[INGEST] Sensor stream disconnected")
    except Exception as exc:
        print(f"[INGEST-FAULT] Unhandled exception: {exc}")
    finally:
        if websocket in ui_clients:
            ui_clients.remove(websocket)

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

# =============================================================================
# HISTORICAL QUERY ENDPOINT (TimescaleDB)
# =============================================================================
@app.get("/api/historical")
async def get_historical_data(
    device_id: str | None = Query(None, description="Filter by sensor ID"),
    limit: int = Query(100, ge=1, le=1000)
):
    if not db_pool:
        return JSONResponse(status_code=503, content={"error": "TimescaleDB connection not active"})
    
    try:
        async with db_pool.acquire() as conn:
            if device_id:
                rows = await conn.fetch(
                    "SELECT time, device_id, temperature, vibration, is_fault, raw_payload FROM sensor_metrics WHERE device_id = $1 ORDER BY time DESC LIMIT $2",
                    device_id, limit
                )
            else:
                rows = await conn.fetch(
                    "SELECT time, device_id, temperature, vibration, is_fault, raw_payload FROM sensor_metrics ORDER BY time DESC LIMIT $1",
                    limit
                )
            
            data = [dict(row) for row in rows]
            for d in data:
                if "time" in d and d["time"]:
                    d["time"] = d["time"].isoformat()

            return JSONResponse(content={"count": len(data), "data": data})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})

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

@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "ring_buffer_size": len(ring_buffer),
        "db_connected": db_pool is not None,
        "clients": len(ui_clients)
    }
# ============================================================
# HEALTH CHECK - Added to existing main.py
# ============================================================

@app.get("/health")
async def health_check():
    """Enhanced health check with system status"""
    import psutil
    from datetime import datetime
    
    # Get WebSocket stats
    ws_stats = {}
    if 'websocket_manager' in globals() and websocket_manager:
        ws_stats = {
            "active_connections": len(websocket_manager.clients),
            "status": "healthy"
        }
    else:
        ws_stats = {"status": "not_initialized"}
    
    # Get buffer stats
    buffer_stats = {}
    if 'ring_buffer' in globals() and ring_buffer:
        buffer_stats = {
            "size": len(ring_buffer),
            "max_size": ring_buffer._maxlen if hasattr(ring_buffer, '_maxlen') else 30000,
            "status": "healthy"
        }
    else:
        buffer_stats = {"status": "not_initialized"}
    
    # System metrics
    try:
        system_stats = {
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_usage": psutil.disk_usage('/').percent,
        }
    except:
        system_stats = {"status": "psutil not available"}
    
    return {
        "status": "online",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.0.0",
        "services": {
            "websocket": ws_stats,
            "ring_buffer": buffer_stats,
            "api": {"status": "healthy"},
            "system": system_stats
        }
    }

@app.get("/health/readiness")
async def readiness():
    """Kubernetes readiness probe"""
    return {"status": "ready"}

@app.get("/health/liveness")
async def liveness():
    """Kubernetes liveness probe"""
    return {"status": "alive"}

# ============================================================
# PROMETHEUS METRICS
# ============================================================

from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response

# Metrics definitions
EVENTS_INGESTED = Counter(
    'events_ingested_total',
    'Total events ingested via WebSocket',
    ['device_id', 'status']
)

FAULTS_DETECTED = Counter(
    'faults_detected_total',
    'Total faults detected',
    ['fault_type', 'device_id']
)

WEBSOCKET_CONNECTIONS = Gauge(
    'websocket_connections_active',
    'Active WebSocket connections'
)

EVENT_PROCESSING_TIME = Histogram(
    'event_processing_seconds',
    'Time to process an event',
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5]
)

RING_BUFFER_SIZE = Gauge(
    'ring_buffer_size',
    'Current size of ring buffer'
)

DB_QUERY_TIME = Histogram(
    'db_query_seconds',
    'Database query duration',
    ['query_type']
)

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    # Update ring buffer size
    if ring_buffer:
        RING_BUFFER_SIZE.set(len(ring_buffer))
    
    # Update WebSocket connections
    if websocket_manager:
        WEBSOCKET_CONNECTIONS.set(len(websocket_manager.clients))
    
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )

# Helper functions
def increment_events(device_id: str = "unknown", status: str = "success"):
    EVENTS_INGESTED.labels(device_id=device_id, status=status).inc()

def increment_faults(fault_type: str, device_id: str = "unknown"):
    FAULTS_DETECTED.labels(fault_type=fault_type, device_id=device_id).inc()

# ============================================================
# PROMETHEUS METRICS
# ============================================================

from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response

# Metrics definitions
EVENTS_INGESTED = Counter(
    'events_ingested_total',
    'Total events ingested via WebSocket',
    ['device_id', 'status']
)

FAULTS_DETECTED = Counter(
    'faults_detected_total',
    'Total faults detected',
    ['fault_type', 'device_id']
)

WEBSOCKET_CONNECTIONS = Gauge(
    'websocket_connections_active',
    'Active WebSocket connections'
)

EVENT_PROCESSING_TIME = Histogram(
    'event_processing_seconds',
    'Time to process an event',
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5]
)

RING_BUFFER_SIZE = Gauge(
    'ring_buffer_size',
    'Current size of ring buffer'
)

DB_QUERY_TIME = Histogram(
    'db_query_seconds',
    'Database query duration',
    ['query_type']
)

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    # Update ring buffer size
    if 'ring_buffer' in globals() and ring_buffer:
        RING_BUFFER_SIZE.set(len(ring_buffer))
    
    # Update WebSocket connections
    if 'websocket_manager' in globals() and websocket_manager:
        WEBSOCKET_CONNECTIONS.set(len(websocket_manager.clients))
    
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )

# Helper functions
def increment_events(device_id: str = "unknown", status: str = "success"):
    EVENTS_INGESTED.labels(device_id=device_id, status=status).inc()

def increment_faults(fault_type: str, device_id: str = "unknown"):
    FAULTS_DETECTED.labels(fault_type=fault_type, device_id=device_id).inc()
