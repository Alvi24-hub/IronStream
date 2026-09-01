from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST, CollectorRegistry

registry = CollectorRegistry()

EVENTS_INGESTED = Counter(
    'events_ingested_total',
    'Total events ingested',
    ['device_id', 'status'],
    registry=registry
)

FAULTS_DETECTED = Counter(
    'faults_detected_total',
    'Total faults detected',
    ['fault_type', 'device_id'],
    registry=registry
)

WEBSOCKET_CONNECTIONS = Gauge(
    'websocket_connections_active',
    'Active WebSocket connections',
    registry=registry
)

RING_BUFFER_SIZE = Gauge(
    'ring_buffer_size',
    'Current ring buffer size',
    registry=registry
)

def get_metrics():
    return generate_latest(registry)

def get_content_type():
    return CONTENT_TYPE_LATEST

def update_websocket_count(count):
    WEBSOCKET_CONNECTIONS.set(count)

def update_ring_buffer_count(count):
    RING_BUFFER_SIZE.set(count)

def increment_events(device_id="unknown", status="success"):
    EVENTS_INGESTED.labels(device_id=device_id, status=status).inc()

def increment_faults(fault_type, device_id="unknown"):
    FAULTS_DETECTED.labels(fault_type=fault_type, device_id=device_id).inc()
