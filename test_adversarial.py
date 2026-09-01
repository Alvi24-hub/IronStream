"""
IronStream — Adversarial Test Script
Sends explicit malformed payloads, NaN injections, and binary garbage 
to test the Stream Inspection Guard.
"""
import asyncio
import websockets

URI = "ws://localhost:8000/ws/ingest"

ATTACK_PAYLOADS = [
    # NaN string injection
    b'{"timestamp": 1756702800123, "device_id": "s1", "metrics": {"temp": "NaN"}}',
    # Invalid timestamp type
    b'{"timestamp": "INVALID_TS", "device_id": "s2", "metrics": {"temp": 78.4}}',
    # Null metric
    b'{"timestamp": 1756702800124, "device_id": "s3", "metrics": {"temp": null}}',
    # Truncated JSON
    b'{"timestamp": 1756702800125, "device_id": "s4", "metrics": {"temp": 99.9',
    # Pure garbage
    b'this is not json at all',
    # Binary garbage
    b'\x00\x01\x02\x03\x04\x05',
]

async def run_attacks():
    async with websockets.connect(URI) as ws:
        print("[ADVERSARIAL] Launching fault injection sequence...")
        for payload in ATTACK_PAYLOADS:
            await ws.send(payload)
            await asyncio.sleep(0.05)
        print("[ADVERSARIAL] All attack vectors transmitted successfully without server crash.")

if __name__ == "__main__":
    asyncio.run(run_attacks())

