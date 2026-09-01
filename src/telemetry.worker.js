// telemetry.worker.js
let canvas = null;
let ctx = null;
let ws = null;
let width = 800;
let height = 280;
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
      break;
    case 'CONNECT_WS':
      console.log('[WORKER] Connecting to:', payload.url);
      connectWebSocket(payload.url);
      break;
    case 'TELEMETRY_DATA':
      processData(payload, true);
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
        // Forward to main thread for stats and grid
        self.postMessage({ type: 'TELEMETRY_DATA', payload: data });
        // Process for canvas
        processData(data, false);
      } catch (err) {
        console.warn('[WORKER] Parse error:', err);
        self.postMessage({
          type: 'FAULT_EVENT',
          payload: {
            device_id: 'unknown',
            flags: ['PARSE_ERROR'],
            ts: Date.now(),
            raw: event.data
          }
        });
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

function processData(data, isReplay) {
  const deviceId = data.device_id || data.device || 'unknown';
  let temp = null;
  let vib = null;
  let flags = data.flags || [];

  const isFault = data.type === 'fault' || (flags && flags.length > 0) || data.is_fault;

  if (data.payload) {
    if (data.payload.metrics) {
      temp = data.payload.metrics.temperature;
      vib = data.payload.metrics.vibration;
    } else if (data.payload.raw) {
      try {
        const parsed = JSON.parse(data.payload.raw);
        if (parsed.metrics) {
          temp = parsed.metrics.temperature;
          vib = parsed.metrics.vibration;
        } else if (parsed.temperature !== undefined) {
          temp = parsed.temperature;
          vib = parsed.vibration;
        }
      } catch (e) {}
    }
  } else if (data.metrics) {
    temp = data.metrics.temperature;
    vib = data.metrics.vibration;
  } else if (data.temperature !== undefined) {
    temp = data.temperature;
    vib = data.vibration;
  }

  if (isFault) {
    self.postMessage({
      type: 'FAULT_EVENT',
      payload: {
        device_id: deviceId,
        flags: flags.length ? flags : ['MALFORMED'],
        ts: data.ts || data.timestamp || Date.now(),
        raw: JSON.stringify(data)
      }
    });
  }

  if (temp !== null && !isNaN(temp) && typeof temp === 'number') {
    dataPoints.push({ timestamp: Date.now(), temperature: temp });
    if (dataPoints.length > MAX_POINTS) dataPoints.shift();
    drawCanvas();
  }
}

function drawCanvas() {
  if (!ctx || !canvas || dataPoints.length === 0) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const y = (i / 10) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < dataPoints.length; i++) {
    const x = (i / dataPoints.length) * canvas.width;
    const temp = dataPoints[i].temperature;
    const y = (1 - (temp / 150)) * canvas.height;
    if (first) { ctx.moveTo(x, y); first = false; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}