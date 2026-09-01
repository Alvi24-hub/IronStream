from datetime import datetime
import psutil
import os

class HealthService:
    @staticmethod
    async def get_health(websocket_manager=None, ring_buffer=None):
        """Enhanced health check with system status"""
        
        # Get WebSocket stats
        ws_stats = {}
        if websocket_manager:
            ws_stats = {
                "active_connections": len(websocket_manager.clients),
                "status": "healthy"
            }
        else:
            ws_stats = {"status": "not_initialized"}
        
        # Get buffer stats
        buffer_stats = {}
        if ring_buffer:
            buffer_stats = {
                "size": len(ring_buffer),
                "max_size": ring_buffer._maxlen if hasattr(ring_buffer, '_maxlen') else 30000,
                "status": "healthy"
            }
        else:
            buffer_stats = {"status": "not_initialized"}
        
        # System metrics
        system_stats = {
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_usage": psutil.disk_usage('/').percent,
            "pid": os.getpid()
        }
        
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
