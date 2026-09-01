"""
IronStream Mock Sensor Generator - Fixed version with auto-reconnect
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
    """Stream sensor data with auto-reconnect"""
    while True:
        try:
            print(f"[MOCK] Connecting to {URI}...")
            async with websockets.connect(
                URI, 
                ping_interval=20, 
                ping_timeout=20,
                close_timeout=5
            ) as ws:
                print(f"[MOCK] ✅ Sensor online @ {RATE_HZ} Hz | Fault rate: {FAULT_RATE*100:.0f}%")
                count = 0
                
                while True:
                    try:
                        is_fault = random.random() < FAULT_RATE
                        await ws.send(generate_event(fault=is_fault))
                        count += 1
                        if count % 100 == 0:
                            print(f"[MOCK] Sent {count} events")
                        await asyncio.sleep(INTERVAL)
                    except websockets.ConnectionClosed:
                        print("[MOCK] ❌ Connection closed, reconnecting...")
                        break
                    except Exception as e:
                        print(f"[MOCK] ❌ Error: {e}")
                        break
                        
        except Exception as e:
            print(f"[MOCK] ❌ Connection failed: {e}")
            print("[MOCK] Retrying in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    try:
        asyncio.run(sensor_stream())
    except KeyboardInterrupt:
        print("\n[MOCK] 👋 Sensor stopped")
