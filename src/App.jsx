import { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const [logs, setLogs] = useState([]);
  const [alertMuted, setAlertMuted] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const logQueueRef = useRef([]);
  const isInitialized = useRef(false);

  const WS_URL = 'ws://172.16.44.68:8000/ws/ingest';
  const REPLAY_URL = 'http://172.16.44.68:8000/api/replay';

  useEffect(() => {
    // Create worker
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./telemetry.worker.js', import.meta.url), {
        type: 'module'
      });

      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'CHAOS_FAULT') {
          const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
          const entry = `[CHAOS @ ${timestamp}] ${e.data.rawPayload}`;
          logQueueRef.current.unshift(entry);
          setLogs(prev => [...logQueueRef.current.slice(0, 50)]);
        }
        if (e.data.type === 'WS_CONNECTED') {
          console.log('✅ WebSocket connected via worker');
          setLogs(prev => ['✅ Connected to sensor stream', ...prev].slice(0, 50));
        }
      };
    }

    // Initialize canvas - ONLY ONCE
    if (canvasRef.current && !isInitialized.current) {
      try {
        const offscreen = canvasRef.current.transferControlToOffscreen();
        workerRef.current.postMessage({ type: 'INIT', payload: { canvas: offscreen } }, [offscreen]);
        isInitialized.current = true;
        
        // Set initial size
        const rect = canvasRef.current.parentElement?.getBoundingClientRect();
        if (rect) {
          workerRef.current.postMessage({
            type: 'RESIZE',
            payload: {
              width: Math.floor(rect.width * window.devicePixelRatio),
              height: Math.floor(420 * window.devicePixelRatio)
            }
          });
        }
      } catch (err) {
        console.warn("Canvas init error:", err);
      }
    }

    // Connect to WebSocket
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'CONNECT_WS', payload: { url: WS_URL } });
    }

    // Log flush interval
    const logInterval = setInterval(() => {
      if (logQueueRef.current.length > 0) {
        setLogs(prev => [...logQueueRef.current.slice(0, 50)]);
      }
    }, 500);

    return () => {
      clearInterval(logInterval);
    };
  }, []);

  const handleAlertToggle = () => {
    setAlertMuted(!alertMuted);
  };

  const handleReplayToggle = async () => {
    setIsReplaying(!isReplaying);
    if (!isReplaying) {
      try {
        const res = await fetch(REPLAY_URL);
        const data = await res.json();
        const events = data.events || [];
        console.log('[REPLAY]', events.length, 'events');
        
        events.forEach(item => {
          try {
            const parsed = typeof item.raw === 'string' ? JSON.parse(item.raw) : item.raw;
            if (workerRef.current) {
              workerRef.current.postMessage({ type: 'TELEMETRY_DATA', payload: parsed });
            }
          } catch (err) {
            console.warn('Parse error:', err);
          }
        });
      } catch (err) {
        console.error('Replay error:', err);
      }
    }
  };

  return (
    <div style={{ padding: '24px', background: '#020617', color: '#f8fafc', minHeight: '100vh', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #1e293b', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '1.2rem', color: '#38bdf8', margin: 0 }}>
          IOT-01: FUSION DASHBOARD // FAULT-RESILIENT PIPELINE
        </h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={handleReplayToggle} 
            style={{ 
              background: isReplaying ? '#eab308' : '#3b82f6', 
              color: '#000', 
              border: 'none', 
              padding: '6px 14px', 
              borderRadius: '4px', 
              fontWeight: 'bold', 
              cursor: 'pointer' 
            }}
          >
            {isReplaying ? '⏩ REPLAYING' : '⏪ REPLAY LAST 60S'}
          </button>
          <button 
            onClick={handleAlertToggle} 
            style={{ 
              background: alertMuted ? '#ef4444' : '#22c55e', 
              color: '#fff', 
              border: 'none', 
              padding: '6px 14px', 
              borderRadius: '4px', 
              fontWeight: 'bold', 
              cursor: 'pointer' 
            }}
          >
            {alertMuted ? 'ALERTS: MUTED' : 'ALERTS: ACTIVE'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px' }}>
            LIVE 500 Hz TELEMETRY STREAM
          </div>
          <canvas 
            ref={canvasRef} 
            style={{ 
              border: '1px solid #1e293b', 
              borderRadius: '6px', 
              width: '100%', 
              height: '420px', 
              display: 'block', 
              background: '#0f172a' 
            }} 
          />
        </div>

        <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 'bold', marginBottom: '8px' }}>
            ⚠️ CHAOS INTERCEPTOR
          </div>
          <div style={{ 
            height: '390px', 
            overflowY: 'auto', 
            fontSize: '0.72rem', 
            color: '#22c55e',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            {logs.length === 0 ? (
              <span style={{ color: '#475569' }}>Listening for stream anomalies...</span>
            ) : (
              logs.map((log, index) => (
                <div key={index} style={{ borderBottom: '1px solid #1e293b', paddingBottom: '4px' }}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

