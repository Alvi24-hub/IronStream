// telemetry.worker.js
let frameRequested = false;
const requestCanvasUpdate = () => {
  if (!frameRequested) {
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      drawCanvas();
    });
  }
};
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
      console.log('[WORKER] WebSocket connected');
      self.postMessage({ type: 'WS_CONNECTED' });
    };
    ws.onmessage = (event) => {
      console.log('[WORKER] 📩 RAW DATA received');
      try {
        const data = JSON.parse(event.data);
        console.log('[WORKER] Parsed type:', data.type || 'unknown');
        
        // Forward to main App
        self.postMessage({ 
          type: 'TELEMETRY_DATA', 
          payload: data 
        });
        
        // Draw on canvas if not paused and canvas ready
        if (!paused && canvas && ctx) {
          processData(data, false);
        }
        
      } catch (err) {
        console.warn('[WORKER] ❌ Parse error:', err);
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
  
  // ✅ IMPROVED FAULT DETECTION
  let isFault = data.type === 'fault' || (flags && flags.length > 0) || data.is_fault;
  
  // ✅ Check for NaN, null, undefined, INVALID_TS in the data
  if (data.payload && data.payload.metrics) {
    const metrics = data.payload.metrics;
    if (metrics.temperature === "NaN" || metrics.temperature === null || metrics.temperature === undefined) {
      isFault = true;
      if (!flags.includes('NaN')) flags.push('NaN');
    }
    if (metrics.vibration === "NaN" || metrics.vibration === null || metrics.vibration === undefined) {
      isFault = true;
      if (!flags.includes('NaN')) flags.push('NaN');
    }
    temp = typeof metrics.temperature === 'number' ? metrics.temperature : null;
    vib = typeof metrics.vibration === 'number' ? metrics.vibration : null;
  }
  
  // ✅ Check if temp/vib are NaN strings
  if (temp === null && data.payload && data.payload.temperature !== undefined) {
    const val = data.payload.temperature;
    if (val === "NaN" || val === null || val === undefined) {
      isFault = true;
      if (!flags.includes('NaN')) flags.push('NaN');
    } else {
      temp = typeof val === 'number' ? val : parseFloat(val);
    }
  }
  
  if (vib === null && data.payload && data.payload.vibration !== undefined) {
    const val = data.payload.vibration;
    if (val === "NaN" || val === null || val === undefined) {
      isFault = true;
      if (!flags.includes('NaN')) flags.push('NaN');
    } else {
      vib = typeof val === 'number' ? val : parseFloat(val);
    }
  }
  
  // ✅ Check direct data fields
  if (temp === null && data.temperature !== undefined) {
    const val = data.temperature;
    if (val === "NaN" || val === null || val === undefined) {
      isFault = true;
      if (!flags.includes('NaN')) flags.push('NaN');
    } else {
      temp = typeof val === 'number' ? val : parseFloat(val);
    }
  }
  
  if (vib === null && data.vibration !== undefined) {
    const val = data.vibration;
    if (val === "NaN" || val === null || val === undefined) {
      isFault = true;
      if (!flags.includes('NaN')) flags.push('NaN');
    } else {
      vib = typeof val === 'number' ? val : parseFloat(val);
    }
  }

  // ✅ Check for INVALID_TS
  if (data.timestamp === "INVALID_TS" || data.payload?.timestamp === "INVALID_TS") {
    isFault = true;
    if (!flags.includes('INVALID_TS')) flags.push('INVALID_TS');
  }

  console.log('[WORKER] Extracted temp:', temp, 'vib:', vib, 'isFault:', isFault, 'flags:', flags);

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

  // Temp curve (Teal)
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

  // Vib curve (Amber)
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

  // Fault markers (Red circles)
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

