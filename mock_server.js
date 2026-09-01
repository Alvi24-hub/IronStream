// mock_server.js
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
console.log("[MOCK SERVER] Running at ws://localhost:8080 (500 Hz Stream)");

wss.on('connection', (ws) => {
  let seq = 0;
  // 500 events/sec = 1 message every 2ms
  const interval = setInterval(() => {
    seq++;
    const isCorrupt = Math.random() < 0.08; // 8% malformed frames for Chaos testing

    const payload = isCorrupt ? {
      seq,
      timestamp: "INVALID_TS",
      device_id: `sensor_f1_${Math.floor(Math.random()*5)}`,
      metrics: { temperature: "NaN" }
    } : {
      seq,
      timestamp: Date.now(),
      device_id: `sensor_f1_${Math.floor(Math.random()*5)}`,
      metrics: { temperature: Number((Math.random() * 30 + 50).toFixed(2)) }
    };

    ws.send(JSON.stringify(payload));
  }, 2);

  ws.on('close', () => clearInterval(interval));
});