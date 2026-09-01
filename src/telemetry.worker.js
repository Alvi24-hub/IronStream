// telemetry.worker.js
let canvas = null;
let ctx = null;
let ws = null;
let width = 800;
let height = 420;
let dataPoints = [];
const MAX_POINTS = 500;

self.onmessage = function(e) {
  const { type, payload } = e.data;

  switch(type) {
    case 'INIT':
      canvas = payload.canvas;
      ctx = canvas.getContext('2d');
      console.log('[WORKER] Canvas ready');
      break;

    case 'RESIZE':
      width = payload.width;
      height = payload.height;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }
      console.log('[WORKER] Resize:', { width, height });
      break;

    case 'CONNECT_WS':
      console.log('[WORKER] Connecting to:', payload.url);
      connectWebSocket(payload.url);
      break;

    case 'TELEMETRY_DATA':
      console.log('[WORKER] Received replay data');
      processData(payload);
      break;

    default:
      console.log('[WORKER] Unknown message type:', type);
  }
};

function connectWebSocket(url) {
  try {
    ws = new WebSocket(url);
    
    ws.onopen = () => {
      console.log('[WORKER] ✅ WebSocket connected');
      self.postMessage({ type: 'WS_CONNECTED' });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WORKER] 📨 Received data:', data);
        processData(data);
      } catch (err) {
        console.warn('[WORKER] Parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('[WORKER] WebSocket closed, reconnecting...');
      setTimeout(() => connectWebSocket(url), 3000);
    };

    ws.onerror = (err) => {
      console.error('[WORKER] WebSocket error:', err);
      ws.close();
    };
  } catch (err) {
    console.error('[WORKER] Connection error:', err);
  }
}

function processData(data) {
  dataPoints.push(data);
  if (dataPoints.length > MAX_POINTS) {
    dataPoints.shift();
  }
  
  drawCanvas();
  
  // Check for faults
  if (data.flags && data.flags.length > 0) {
    self.postMessage({
      type: 'CHAOS_FAULT',
      rawPayload: JSON.stringify(data)
    });
  }
}

function drawCanvas() {
  if (!ctx || !canvas || dataPoints.length === 0) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const y = (i / 10) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  
  // Draw data line
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  let firstPoint = true;
  for (let i = 0; i < dataPoints.length; i++) {
    const x = (i / dataPoints.length) * canvas.width;
    let y = canvas.height / 2;
    
    // Try to get temperature
    const point = dataPoints[i];
    let temp = null;
    
    if (point.payload?.metrics?.temperature !== undefined) {
      temp = point.payload.metrics.temperature;
    } else if (point.temperature !== undefined) {
      temp = point.temperature;
    } else if (point.metrics?.temperature !== undefined) {
      temp = point.metrics.temperature;
    }
    
    if (temp !== null && typeof temp === 'number' && !isNaN(temp)) {
      y = (1 - (temp / 150)) * canvas.height;
    }
    
    if (firstPoint) {
      ctx.moveTo(x, y);
      firstPoint = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  
  // Draw fault indicators
  dataPoints.forEach((point, i) => {
    if (point.is_fault || (point.flags && point.flags.length > 0)) {
      const x = (i / dataPoints.length) * canvas.width;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(x, 20, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
