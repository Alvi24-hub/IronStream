// telemetry.worker.js
let canvas = null;
let ctx = null;
let ws = null;
let isConnected = false;
let dataPoints = [];
const MAX_POINTS = 300;

// Canvas dimensions
let canvasWidth = 800;
let canvasHeight = 400;
let dpr = 1;

// Chart state
let minTemp = 20;
let maxTemp = 120;

// OffscreenCanvas handling
self.onmessage = function(event) {
    console.log('[WORKER] Received:', event.data.type);
    
    switch (event.data.type) {
        case 'INIT':
            console.log('[WORKER] Initializing with canvas');
            canvas = event.data.payload.canvas;
            ctx = canvas.getContext('2d');
            canvasWidth = canvas.width;
            canvasHeight = canvas.height;
            dpr = 1;
            renderChart();
            break;
            
        case 'CONNECT_WS':
            console.log('[WORKER] Connecting to WebSocket:', event.data.payload.url);
            connectWebSocket(event.data.payload.url);
            break;
            
        case 'TELEMETRY_DATA':
            console.log('[WORKER] Telemetry point:', event.data.payload);
            processTelemetryPoint(event.data.payload);
            break;
            
        case 'RESIZE':
            console.log('[WORKER] Resize:', event.data.payload);
            canvasWidth = event.data.payload.width;
            canvasHeight = event.data.payload.height;
            if (canvas) {
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
            }
            renderChart();
            break;
            
        default:
            console.warn('[WORKER] Unknown message type:', event.data.type);
    }
};

function connectWebSocket(url) {
    ws = new WebSocket(url);
    
    ws.onopen = () => {
        console.log('[WORKER] ✅ WebSocket connected');
        isConnected = true;
        self.postMessage({ type: 'WS_STATUS', status: 'connected' });
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('[WORKER] WS Data:', data.type);
            
            if (data.type === 'telemetry' || data.type === 'fault') {
                // Extract temperature
                let temp = null;
                if (data.payload?.metrics?.temperature !== undefined) {
                    temp = parseFloat(data.payload.metrics.temperature);
                }
                
                if (!isNaN(temp) && temp !== null) {
                    processTelemetryPoint({
                        timestamp: data.ts || Date.now(),
                        temperature: temp,
                        device_id: data.device_id || 'unknown'
                    });
                } else if (data.type === 'fault') {
                    // Send to Chaos Interceptor
                    self.postMessage({
                        type: 'CHAOS_FAULT',
                        rawPayload: JSON.stringify(data.payload)
                    });
                }
            }
        } catch (err) {
            console.error('[WORKER] Parse error:', err);
        }
    };
    
    ws.onerror = (error) => {
        console.error('[WORKER] WebSocket error:', error);
        self.postMessage({ type: 'WS_ERROR', payload: error });
    };
    
    ws.onclose = () => {
        console.log('[WORKER] WebSocket closed');
        isConnected = false;
        self.postMessage({ type: 'WS_STATUS', status: 'disconnected' });
        // Auto-reconnect after 3 seconds
        setTimeout(() => connectWebSocket(url), 3000);
    };
}

function processTelemetryPoint(point) {
    if (!point || point.temperature === undefined || isNaN(point.temperature)) {
        return;
    }
    
    dataPoints.push({
        timestamp: point.timestamp || Date.now(),
        temperature: point.temperature
    });
    
    // Keep last MAX_POINTS
    if (dataPoints.length > MAX_POINTS) {
        dataPoints = dataPoints.slice(-MAX_POINTS);
    }
    
    // Update min/max
    const temps = dataPoints.map(p => p.temperature);
    minTemp = Math.min(...temps) - 5;
    maxTemp = Math.max(...temps) + 5;
    
    // Render
    renderChart();
}

function renderChart() {
    if (!ctx || !canvas) return;
    
    const w = canvas.width || canvasWidth;
    const h = canvas.height || canvasHeight;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    
    if (dataPoints.length < 2) {
        ctx.fillStyle = '#475569';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for telemetry data...', w/2, h/2);
        return;
    }
    
    // Draw grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let y = 0; y <= 4; y++) {
        const yPos = (y / 4) * h;
        ctx.beginPath();
        ctx.moveTo(0, yPos);
        ctx.lineTo(w, yPos);
        ctx.stroke();
        
        // Temperature labels
        const temp = maxTemp - (y / 4) * (maxTemp - minTemp);
        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(temp.toFixed(1) + '°F', w - 5, yPos - 4);
    }
    
    // Draw data line
    const padding = 40;
    const chartWidth = w - padding * 2;
    const chartHeight = h - padding * 2;
    
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    
    for (let i = 0; i < dataPoints.length; i++) {
        const x = padding + (i / (dataPoints.length - 1)) * chartWidth;
        const y = padding + chartHeight - ((dataPoints[i].temperature - minTemp) / (maxTemp - minTemp)) * chartHeight;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    
    // Draw current value
    if (dataPoints.length > 0) {
        const last = dataPoints[dataPoints.length - 1];
        const x = padding + chartWidth;
        const y = padding + chartHeight - ((last.temperature - minTemp) / (maxTemp - minTemp)) * chartHeight;
        
        // Dot
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Value label
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(last.temperature.toFixed(1) + '°F', x + 10, y + 4);
    }
    
    // Buffer info
    ctx.fillStyle = '#475569';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`BUFFER: ${dataPoints.length}/${MAX_POINTS} PTS`, 10, 15);
    
    if (isConnected) {
        ctx.fillStyle = '#22c55e';
        ctx.fillText('● LIVE', 10, 30);
    } else {
        ctx.fillStyle = '#ef4444';
        ctx.fillText('● DISCONNECTED', 10, 30);
    }
}