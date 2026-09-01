import { useEffect, useRef } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);

  useEffect(() => {
    // 1. Instantiate worker module
    workerRef.current = new Worker(
      new URL('./telemetry.worker.js', import.meta.url),
      { type: 'module' }
    );

    // 2. Transfer Canvas control off main thread
    const offscreen = canvasRef.current.transferControlToOffscreen();
    workerRef.current.postMessage(
      { type: 'INIT', payload: { canvas: offscreen } },
      [offscreen]
    );

    // 3. Connect browser native WebSocket to mock stream
    const ws = new WebSocket('ws://localhost:8080');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Directly pipe stream into worker memory
      workerRef.current.postMessage({ type: 'TELEMETRY_DATA', payload: data });
    };

    return () => {
      ws.close();
      workerRef.current.terminate();
    };
  }, []);

  return (
    <div style={{ padding: '24px', background: '#020617', color: '#f8fafc', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#38bdf8' }}>
        IOT-01: Fusion Dashboard (500 Hz OffscreenCanvas Worker)
      </h1>
      <canvas
        ref={canvasRef}
        width={900}
        height={400}
        style={{ border: '1px solid #1e293b', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.5)' }}
      />
    </div>
  );
}