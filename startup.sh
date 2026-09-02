#!/bin/bash
echo "🚀 Starting IRONSTREAM Backend..."

# Start mock sensor in background
python mock_sensor.py &

# Wait for mock sensor to start
sleep 2

# Start FastAPI
uvicorn main:app --host 0.0.0.0 --port 10000