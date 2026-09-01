// telemetry.worker.js
let canvas = null;
let ctx = null;
let ws = null;
let width = 800;
let height = 280;
let dataPoints = [];
const MAX_POINTS = 500;
let paused = false;
let hoverX = null;

const TEMP_COLOR = '#14B8A6';
const VIB_COLOR = '#F59E0B';
const FAULT_COLOR = '#EF4444';

self.onmessage = function(e) {
  const { type, payload } = e.data;
  switch(type) {
    case 'INIT':
      canvas = payload.canvas;
      ctx = canvas.getContext('2d');
      if (canvas.width === 0) {
        canvas.width = width;
        canvas.height = height;
      }
      console.log('[WORKER] Canvas ready, size:', canvas.width, 'x', canvas.height);
      drawCanvas();
      break;
    case 'RESIZE':
      width = payload.width;
      height = payload.height;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
        console.log('[WORKER] Resized to:', width, 'x', height);
        drawCanvas();
      }
      break;
    case 'CONNECT_WS':
      console.log('[WORKER] Connecting to URL:', payload.url);
      connectWebSocket(payload.url);
      break;
    case 'TELEMETRY_DATA':
      processData(payload, true);
      break;
    case 'PAUSE':
      paused = payload.paused;
      console.log('[WORKER] Pause state:', paused);
      break;
    case 'HOVER':
      hoverX = payload.x;
      drawCanvas();
      sendTooltipData(payload.x);
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
      // Send test message every 2 seconds to verify communication
      setInterval(() => {
        self.postMessage({
          type: 'TEST_MESSAGE',
          payload: { msg: 'ping from worker' }
        });
      }, 2000);
    };
    ws.onmessage = (event) => {
      console.log('[WORKER] RAW DATA:', event.data.slice(0, 200));
      try {
        const data = JSON.parse(event.data);
        console.log('[WORKER] Parsed:', data.type || 'unknown');
        self.postMessage({ type: 'TELEMETRY_DATA', payload: data });
        console.log('[WORKER] ✅ TELEMETRY_DATA sent to main thread');
        if (!paused) {
          processData(data, false);
        }
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

  // --- Robust extraction ---
  if (data.payload) {
    if (data.payload.metrics) {
      temp = data.payload.metrics.temperature;
      vib = data.payload.metrics.vibration;
    } else if (data.payload.raw) {
      let rawObj = data.payload.raw;
      if (typeof rawObj === 'string') {
        try {
          rawObj = JSON.parse(rawObj);
        } catch (e) {
          rawObj = null;
        }
      }
      if (rawObj) {
        if (rawObj.metrics) {
          temp = rawObj.metrics.temperature;
          vib = rawObj.metrics.vibration;
        } else if (rawObj.temperature !== undefined) {
          temp = rawObj.temperature;
          vib = rawObj.vibration;
        }
      }
    }
  } else if (data.metrics) {
    temp = data.metrics.temperature;
    vib = data.metrics.vibration;
  } else if (data.temperature !== undefined) {
    temp = data.temperature;
    vib = data.vibration;
  }

  console.log('[WORKER] Extracted temp:', temp, 'vib:', vib, 'isFault:', isFault);

  // Send fault event to main thread
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
    console.log('[WORKER] ✅ FAULT_EVENT sent to main thread');
  }

  const hasTemp = temp !== null && !isNaN(temp) && typeof temp === 'number';
  const hasVib = vib !== null && !isNaN(vib) && typeof vib === 'number';
  if (hasTemp || hasVib) {
    dataPoints.push({
      ts: Date.now(),
      temp: hasTemp ? temp : null,
      vib: hasVib ? vib : null,
      device_id: deviceId,
      isFault: isFault
    });
    if (dataPoints.length > MAX_POINTS) dataPoints.shift();
    console.log('[WORKER] dataPoints length:', dataPoints.length);
    drawCanvas();
  } else {
    drawCanvas();
  }
}

function drawCanvas() {
  if (!ctx || !canvas) return;
  const w = canvas.width || width;
  const h = canvas.height || height;
  if (w === 0 || h === 0) return;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0B0E14';
  ctx.fillRect(0, 0, w, h);

  if (dataPoints.length === 0) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for data...', w/2, h/2);
    return;
  }

  // Grid
  ctx.strokeStyle = 'rgba(42,49,60,0.5)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 10; i++) {
    const y = (i / 10) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const padding = { top: 20, bottom: 20, left: 40, right: 20 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const TEMP_MIN = 0, TEMP_MAX = 150;
  const VIB_MIN = 0, VIB_MAX = 10;
  const mapY = (val, min, max) => padding.top + chartH - ((val - min) / (max - min)) * chartH;

  // Temp curve
  ctx.strokeStyle = TEMP_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < dataPoints.length; i++) {
    const p = dataPoints[i];
    if (p.temp === null) continue;
    const x = padding.left + (i / (dataPoints.length - 1 || 1)) * chartW;
    const y = mapY(p.temp, TEMP_MIN, TEMP_MAX);
    if (first) { ctx.moveTo(x, y); first = false; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Vib curve
  ctx.strokeStyle = VIB_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  first = true;
  for (let i = 0; i < dataPoints.length; i++) {
    const p = dataPoints[i];
    if (p.vib === null) continue;
    const x = padding.left + (i / (dataPoints.length - 1 || 1)) * chartW;
    const y = mapY(p.vib, VIB_MIN, VIB_MAX);
    if (first) { ctx.moveTo(x, y); first = false; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fault markers
  for (let i = 0; i < dataPoints.length; i++) {
    const p = dataPoints[i];
    if (!p.isFault) continue;
    const x = padding.left + (i / (dataPoints.length - 1 || 1)) * chartW;
    if (p.temp !== null) {
      const yTemp = mapY(p.temp, TEMP_MIN, TEMP_MAX);
      ctx.fillStyle = FAULT_COLOR;
      ctx.beginPath();
      ctx.arc(x, yTemp, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (p.vib !== null) {
      const yVib = mapY(p.vib, VIB_MIN, VIB_MAX);
      ctx.fillStyle = FAULT_COLOR;
      ctx.beginPath();
      ctx.arc(x, yVib, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Hover line
  if (hoverX !== null) {
    const x = Math.min(Math.max(hoverX, padding.left), padding.left + chartW);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function sendTooltipData(x) {
  if (dataPoints.length === 0) return;
  const w = canvas.width || width;
  const padding = { top: 20, bottom: 20, left: 40, right: 20 };
  const chartW = w - padding.left - padding.right;
  const clampedX = Math.min(Math.max(x, padding.left), padding.left + chartW);
  let idx = Math.round((clampedX - padding.left) / chartW * (dataPoints.length - 1));
  idx = Math.max(0, Math.min(idx, dataPoints.length - 1));
  const p = dataPoints[idx];
  if (p) {
    const tooltip = {
      visible: true,
      x: clampedX,
      y: padding.top,
      ts: new Date(p.ts).toLocaleTimeString(),
      temp: p.temp !== null ? p.temp.toFixed(1) + '°C' : '--',
      vib: p.vib !== null ? p.vib.toFixed(2) + ' Hz' : '--',
      device: p.device_id,
      isFault: p.isFault
    };
    self.postMessage({ type: 'TOOLTIP', payload: tooltip });
  }
}