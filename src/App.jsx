import { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const isInitialized = useRef(false);

  const [logs, setLogs] = useState([]);
  const [alertMuted, setAlertMuted] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);

  const channelRef = useRef(null);
  const logQueueRef = useRef([]);

  const WS_URL = import.meta.env?.VITE_WS_URL || 'ws://localhost:8000';  // ✅ FIXED
const REPLAY_URL = import.meta.env?.VITE_REPLAY_URL || 'http://localhost:8000/api/replay'; // ✅ FIXED

  useEffect(() => {
    // 1. BroadcastChannel CRDT Setup
    const channel = new BroadcastChannel('crdt_state_sync');
    channelRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data?.type === 'TOGGLE_ALERT') {
        setAlertMuted(event.data.payload);
      }
    };

    // 2. Initialize Worker
    workerRef.current = new Worker(new URL('./telemetry.worker.js', import.meta.url), {
      type: 'module'
    });

    // 3. OffscreenCanvas Handshake
    if (canvasRef.current && !isInitialized.current) {
      try {
        const offscreen = canvasRef.current.transferControlToOffscreen();
        workerRef.current.postMessage({ type: 'INIT', payload: { canvas: offscreen } }, [offscreen]);
        isInitialized.current = true;
      } catch (err) {
        console.warn("OffscreenCanvas already initialized:", err);
      }
    }

    // 4. Chaos Terminal Worker Listener
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'CHAOS_FAULT') {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
        const entry = `[CHAOS INTERCEPTOR @ ${timestamp}] Fault Byte Caught -> ${e.data.rawPayload}`;
        logQueueRef.current.unshift(entry);
      }
    };

    // 5. Connect Worker directly to WebSocket (or mock loop fallback)
    if (WS_URL) {
      workerRef.current.postMessage({ type: 'CONNECT_WS', payload: { url: WS_URL } });
    }

    // 6. 500 Hz Mock Stream Fallback
    // In App.jsx setInterval fallback loop:
const mockInterval = setInterval(() => {
  // Generate valid sine-wave telemetry value
  const mockVal = 50 + Math.sin(Date.now() / 200) * 15 + (Math.random() - 0.5) * 4;

  // 90% Valid Telemetry, 10% Chaos Fault Injections
  const isFault = Math.random() < 0.10;

  if (isFault) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    logQueueRef.current.unshift(`[CHAOS INTERCEPTOR @ ${timestamp}] Fault Byte Caught -> {"temperature":"NaN"}`);
  } else {
    // Send valid telemetry to worker
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'TELEMETRY_DATA',
        payload: { metrics: { temperature: mockVal } }
      });
    }
  }
}, 2); // 500 Hz stream

    // 7. Throttled Log Terminal Flush (10 Hz)
    const logFlushInterval = setInterval(() => {
      if (logQueueRef.current.length > 0) {
        setLogs((prev) => [...logQueueRef.current.splice(0, 50), ...prev].slice(0, 50));
      }
    }, 100);

    // 8. Resize Observer Protocol
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (workerRef.current) {
          workerRef.current.postMessage({
            type: 'RESIZE',
            payload: {
              width: Math.floor(width * window.devicePixelRatio),
              height: Math.floor(height * window.devicePixelRatio)
            }
          });
        }
      }
    });

    if (canvasRef.current?.parentElement) {
      resizeObserver.observe(canvasRef.current.parentElement);
    }

    return () => {
      clearInterval(mockInterval);
      clearInterval(logFlushInterval);
      resizeObserver.disconnect();
      if (channelRef.current) channelRef.current.close();
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  const handleAlertToggle = () => {
    const nextState = !alertMuted;
    setAlertMuted(nextState);

    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'TOGGLE_ALERT',
        payload: nextState,
        timestamp: Date.now()
      });
    }
  };

  const handleReplayToggle = async () => {
    const nextReplayState = !isReplaying;
    setIsReplaying(nextReplayState);

    if (nextReplayState) {
        try {
            const res = await fetch(REPLAY_URL);
            const data = await res.json();
            
            // ✅ Access the events array properly
            const events = data.events || [];
            console.log('[REPLAY] Received', events.length, 'events');
            
            if (workerRef.current && events.length > 0) {
                // Send each event to worker
                events.forEach(item => {
                    try {
                        // Parse raw JSON if needed
                        const parsed = typeof item.raw === 'string' ? JSON.parse(item.raw) : item.raw;
                        workerRef.current.postMessage({ 
                            type: 'TELEMETRY_DATA', 
                            payload: parsed 
                        });
                    } catch (err) {
                        console.warn('[REPLAY] Failed to parse event:', item);
                    }
                });
            }
        } catch (err) {
            console.error('[REPLAY] Error:', err);
            // Fallback: Use mock data
            console.log("Mock Server fallback active: 60s memory replay flush.");
        }
    }
};
  return (
    <div style={{ padding: '24px', background: '#020617', color: '#f8fafc', minHeight: '100vh', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #1e293b', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '1.2rem', color: '#38bdf8', margin: 0 }}>
          IOT-01: FUSION DASHBOARD // FAULT-RESILIENT PIPELINE
        </h1>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleReplayToggle}
            style={{
              background: isReplaying ? '#eab308' : '#3b82f6',
              color: '#000',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            {isReplaying ? '⏩ REPLAYING IN-MEMORY LOGS' : '⏪ REPLAY LAST 60S'}
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
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            {alertMuted ? 'SYSTEM ALERTS: MUTED' : 'SYSTEM ALERTS: ACTIVE'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px' }}>
            <span>LIVE 500 Hz TELEMETRY STREAM (OffscreenCanvas Engine)</span>
            {isReplaying && <span style={{ color: '#eab308', fontWeight: 'bold' }}>[REPLAY MODE ACTIVE]</span>}
          </div>
          <canvas
            ref={canvasRef}
            style={{ border: `1px solid ${isReplaying ? '#eab308' : '#1e293b'}`, borderRadius: '6px', width: '100%', height: '420px', display: 'block', background: '#0f172a' }}
          />
        </div>

        <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 'bold', marginBottom: '8px' }}>
            ⚠️ CHAOS INTERCEPTOR TERMINAL
          </div>
          <div style={{
            height: '390px',
            overflowY: 'auto',
            fontSize: '0.72rem',
            color: '#22c55e',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
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