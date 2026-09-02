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
INTERVAL = 1.0 / RATE_HZ  # 0.002 seconds = 2ms
FAULT_RATE = 0.08

def generate_event(fault: bool = False) -> str:
    ts = int(time.time() * 1000)
    
    # Generate random sensor ID (1-16)
    sensor_num = random.randint(1, 16)
    device_id = f"sensor_f1_{sensor_num:02d}"
    
    if not fault:
        # Normal data
        return json.dumps({
            "timestamp": ts,
            "device_id": device_id,
            "metrics": {
                "temperature": round(random.uniform(20.0, 120.0), 2),
                "vibration": round(random.uniform(0.0, 9.81), 3),
            }
        })
    
    # Fault data - inject different types
    fault_type = random.choice(["nan_temp", "nan_vib", "bad_ts", "truncated"])
    
    if fault_type == "nan_temp":
        return json.dumps({
            "timestamp": ts,
            "device_id": device_id,
            "metrics": {
                "temperature": "NaN",  # ← Fault!
                "vibration": round(random.uniform(0.0, 9.81), 3),
            }
        })
    elif fault_type == "nan_vib":
        return json.dumps({
            "timestamp": ts,
            "device_id": device_id,
            "metrics": {
                "temperature": round(random.uniform(20.0, 120.0), 2),
                "vibration": "NaN",  # ← Fault!
            }
        })
    elif fault_type == "bad_ts":
        return json.dumps({
            "timestamp": "INVALID_TS",  # ← Fault!
            "device_id": device_id,
            "metrics": {
                "temperature": round(random.uniform(20.0, 120.0), 2),
                "vibration": round(random.uniform(0.0, 9.81), 3),
            }
        })
    elif fault_type == "truncated":
        # Truncated JSON - will cause parse error
        return '{"timestamp": ' + str(ts) + ', "device_id": "' + device_id + '", "metrics": {"temperature":'
        
    return json.dumps({
        "timestamp": ts,
        "device_id": device_id,
        "metrics": {
            "temperature": round(random.uniform(20.0, 120.0), 2),
            "vibration": round(random.uniform(0.0, 9.81), 3),
        }
    })

async def sensor_stream():
    retry_count = 0
    
    # ✅ Use high precision timer for 500 Hz
    while True:
        try:
            async with websockets.connect(
                URI,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10
            ) as ws:
                print(f"[MOCK] ✅ Connected to {URI}")
                print(f"[MOCK] 📡 Sending at {RATE_HZ} Hz | Fault rate: {FAULT_RATE*100:.0f}%")
                retry_count = 0
                
                # ✅ Accurate timing for 500 Hz
                next_send = time.perf_counter()
                event_count = 0
                start_time = time.time()
                
                while True:
                    # Send event
                    is_fault = random.random() < FAULT_RATE
                    await ws.send(generate_event(fault=is_fault))
                    event_count += 1
                    
                    # ✅ Print stats every second
                    if event_count % 500 == 0:
                        elapsed = time.time() - start_time
                        print(f"[MOCK] 📊 Sent {event_count} events in {elapsed:.2f}s (Rate: {event_count/elapsed:.0f} Hz)")
                    
                    # ✅ Wait exactly 2ms
                    next_send += INTERVAL
                    sleep_time = next_send - time.perf_counter()
                    if sleep_time > 0:
                        await asyncio.sleep(sleep_time)
                    
        except websockets.exceptions.ConnectionClosedError as e:
            retry_count += 1
            print(f"[MOCK] ⚠️ Connection lost (attempt {retry_count}), reconnecting in 2s...")
            await asyncio.sleep(2)
        except Exception as e:
            retry_count += 1
            print(f"[MOCK] ❌ Error: {e} (attempt {retry_count}), reconnecting in 2s...")
            await asyncio.sleep(2)

if __name__ == "__main__":
    print("[MOCK] 🚀 IRONSTREAM Mock Sensor Starting...")
    print(f"[MOCK] 📡 Target: {URI}")
    print(f"[MOCK] ⚡ Rate: {RATE_HZ} Hz")
    asyncio.run(sensor_stream())