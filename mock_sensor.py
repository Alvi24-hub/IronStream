"""
IronStream Mock Sensor Generator
Emits 500 events/sec over WebSocket with tunable fault injection.
"""
import asyncio
import json
import random
import time
import websockets

URI = "ws://localhost:8000/ws/ingest"
RATE_HZ = 500
INTERVAL = 1.0 / RATE_HZ
FAULT_RATE = 0.08

def generate_event(fault: bool = False) -> str:
    ts = int(time.time() * 1000)
    if not fault:
        return json.dumps({
            "timestamp": ts,
            "device_id": f"sensor_f1_{random.randint(1, 16):02d}",
            "metrics": {
                "temperature": round(random.uniform(20.0, 120.0), 2),
                "vibration": round(random.uniform(0.0, 9.81), 3),
            }
        })
    
    mode = random.choice(["nan", "bad_ts", "truncated"])
    base = {"timestamp": ts, "device_id": "sensor_f1_01", "metrics": {}}
    
    if mode == "nan":
        base["metrics"]["temperature"] = "NaN"
    elif mode == "bad_ts":
        base["timestamp"] = "INVALID_TS"
    elif mode == "truncated":
        return '{"timestamp": ' + str(ts) + ', "device_id": "s_01", "metrics": {"temp": "NaN"'
        
    return json.dumps(base)

async def sensor_stream():
    async with websockets.connect(URI, ping_interval=20, ping_timeout=20) as ws:
        print(f"[MOCK] Sensor online @ {RATE_HZ} Hz | Fault rate: {FAULT_RATE*100:.0f}%")
        while True:
            is_fault = random.random() < FAULT_RATE
            await ws.send(generate_event(fault=is_fault))
            await asyncio.sleep(INTERVAL)

if __name__ == "__main__":
    asyncio.run(sensor_stream())


