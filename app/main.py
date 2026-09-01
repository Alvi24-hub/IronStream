from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging
import json

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import services from bridge
from app.bridge import (
    ThreadSafeRingBuffer,
    WebSocketManager,
    EventProcessor,
    RedisSubscriber
)

# Global instances
ring_buffer = ThreadSafeRingBuffer(maxlen=30000)
websocket_manager = WebSocketManager(max_queue_size=100)
event_processor = EventProcessor(
    ring_buffer=ring_buffer,
    websocket_manager=websocket_manager,
    max_workers=4
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 Starting IronStream Pipeline...")
    
    # Initialize event processor
    await event_processor.start()
    
    # Start Redis subscriber (optional)
    # redis_subscriber = RedisSubscriber(
    #     redis_url="redis://localhost:6379/0",
    #     channel="fusion:crdt",
    #     message_handler=event_processor.process_event
    # )
    # await redis_subscriber.start()
    
    yield
    
    # Shutdown
    logger.info("👋 Shutting down IronStream Pipeline...")
    await event_processor.stop()
    logger.info("✅ Shutdown complete")

app = FastAPI(
    title="IronStream",
    description="Fault-resilient real-time telemetry pipeline",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and include routers
from app.api.health import router as health_router, set_health_dependencies
app.include_router(health_router)

# Update health dependencies with actual services
set_health_dependencies(websocket_manager, ring_buffer)

@app.websocket("/ws/ingest")
async def websocket_ingest(websocket: WebSocket):
    """WebSocket endpoint for 500Hz telemetry ingestion"""
    await websocket.accept()
    logger.info(f"✅ WebSocket connected")
    
    # Track connection in metrics
    try:
        while True:
            # Receive message
            data = await websocket.receive_text()
            
            # Process via event processor
            if event_processor:
                await event_processor.process_event(data.encode('utf-8'))
            
    except WebSocketDisconnect:
        logger.info(f"❌ WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        pass

@app.get("/")
async def root():
    return {
        "service": "IronStream",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/api/replay")
async def get_replay():
    """Get events from ring buffer"""
    if ring_buffer is None:
        return {"error": "Ring buffer not initialized"}
    
    try:
        events = await ring_buffer.get_snapshot()
        return {
            "events": events,
            "count": len(events),
            "capacity": ring_buffer._maxlen if hasattr(ring_buffer, '_maxlen') else 30000,
            "replay_ms": int(time.time() * 1000)
        }
    except Exception as e:
        logger.error(f"Replay error: {e}")
        return {"error": str(e)}

# Add your other endpoints here
