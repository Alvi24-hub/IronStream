import time
import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import logging

# Setup logger
logger = logging.getLogger("ironstream")

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Generate correlation ID
        correlation_id = str(uuid.uuid4())[:8]
        
        # Log request (skip WebSocket)
        if request.url.path != "/ws/ingest":
            logger.info(
                f"Request: {request.method} {request.url.path}",
                extra={
                    "correlation_id": correlation_id,
                    "client_ip": request.client.host if request.client else "unknown",
                    "user_agent": request.headers.get("user-agent", "unknown")
                }
            )
        
        # Process request
        start_time = time.time()
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        
        # Log response (skip WebSocket)
        if request.url.path != "/ws/ingest":
            logger.info(
                f"Response: {request.method} {request.url.path} - {response.status_code}",
                extra={
                    "correlation_id": correlation_id,
                    "status_code": response.status_code,
                    "duration_ms": round(process_time, 2)
                }
            )
        
        # Add correlation ID to response headers
        response.headers["X-Correlation-ID"] = correlation_id
        
        return response
