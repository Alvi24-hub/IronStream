let canvas = null;
let ctx = null;
const dataBuffer = [];
const MAX_BUFFER_SIZE = 300; // Stores ~0.6s window at 500Hz for 60 FPS plotting

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    canvas = payload.canvas;
    ctx = canvas.getContext('2d');
    requestAnimationFrame(renderLoop);
  }

  if (type === 'TELEMETRY_DATA') {
    if (payload && typeof payload.metrics?.temperature === 'number') {
      dataBuffer.push(payload.metrics.temperature);
      if (dataBuffer.length > MAX_BUFFER_SIZE) {
        dataBuffer.shift(); // Maintain bounded circular window
      }
    }
  }
};

function renderLoop() {
  if (!ctx || !canvas) return;

  // Clear frame
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Render 60 FPS real-time line plot off DOM thread
  if (dataBuffer.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;

    const step = canvas.width / MAX_BUFFER_SIZE;
    for (let i = 0; i < dataBuffer.length; i++) {
      const x = i * step;
      // Scale temperature metrics (range 40-90) onto canvas height
      const y = canvas.height - ((dataBuffer[i] - 40) / 50) * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  requestAnimationFrame(renderLoop);
}