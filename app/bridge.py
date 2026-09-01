"""
Bridge to import existing services from the root directory
"""
import sys
import os

# Add the parent directory (IronStream) to Python path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Now import from the root directory
try:
    from services.ring_buffer import ThreadSafeRingBuffer
    from services.websocket_manager import WebSocketManager
    from services.event_processor import EventProcessor
    from services.redis_subscriber import RedisSubscriber
except ImportError as e:
    print(f"Error importing services: {e}")
    print(f"Current sys.path: {sys.path}")
    raise

__all__ = [
    'ThreadSafeRingBuffer',
    'WebSocketManager', 
    'EventProcessor',
    'RedisSubscriber'
]
