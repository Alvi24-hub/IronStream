from fastapi import APIRouter, Depends
from app.services.health import HealthService

router = APIRouter()

# Global refs (will be set from main)
_websocket_manager = None
_ring_buffer = None

def set_health_dependencies(wsm, rb):
    global _websocket_manager, _ring_buffer
    _websocket_manager = wsm
    _ring_buffer = rb

@router.get("/health")
async def health_check():
    """Complete health check with all services"""
    return await HealthService.get_health(_websocket_manager, _ring_buffer)

@router.get("/health/readiness")
async def readiness():
    """Kubernetes readiness probe"""
    return {"status": "ready"}

@router.get("/health/liveness")
async def liveness():
    """Kubernetes liveness probe"""
    return {"status": "alive"}
