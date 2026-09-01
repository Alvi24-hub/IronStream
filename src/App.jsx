import { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const channelRef = useRef(null);
  const isInitialized = useRef(false);

  const [alertMuted, setAlertMuted] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [faultCount, setFaultCount] = useState(0);
  const [totalEvents, setTotalEvents] = useState(0);
  const [eventsPerSec, setEventsPerSec] = useState(0);
  const [faultRate, setFaultRate] = useState(0);
  const [uptime, setUptime] = useState('0s');
  const [sensorData, setSensorData] = useState({});
  const [latestTemp, setLatestTemp] = useState(null);
  const [latestVib, setLatestVib] = useState(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [faultLog, setFaultLog] = useState([]);

  const WS_URL = 'ws://172.16.44.68:8000/ws/ingest';
  const REPLAY_URL = 'http://172.16.44.68:8000/api/replay';
  const startTime = Date.now();

  const eventCountRef = useRef(0);
  const faultCountRef = useRef(0);
  const lastRateCalc = useRef(Date.now());

  const sensorIds = Array.from({ length: 16 }, (_, i) => `sensor_f1_${String(i + 1).padStart(2, '0')}`);

  useEffect(() => {
    const channel = new BroadcastChannel('crdt_state_sync');
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'TOGGLE_ALERT') {
        setAlertMuted(event.data.payload);
      }
    };

    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./telemetry.worker.js', import.meta.url), {
        type: 'module'
      });

      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'TELEMETRY_DATA') {
          const data = e.data.payload;
          const deviceId = data.device_id || data.device || 'unknown';
          let temp = data?.payload?.metrics?.temperature ?? data?.metrics?.temperature ?? data?.temperature;
          let vib = data?.payload?.metrics?.vibration ?? data?.metrics?.vibration ?? data?.vibration;

          if (temp !== undefined && !isNaN(temp) && typeof temp === 'number') {
            setLatestTemp(temp);
            if (vib !== undefined && !isNaN(vib)) setLatestVib(vib);

            setTotalEvents(prev => prev + 1);
            eventCountRef.current += 1;

            const now = Date.now();
            setSensorData(prev => ({
              ...prev,
              [deviceId]: {
                temp: temp,
                vibration: vib,
                status: 'normal',
                lastUpdate: now
              }
            }));
          }
        }

        if (e.data.type === 'FAULT_EVENT') {
          const fault = e.data.payload;
          setFaultCount(prev => prev + 1);
          faultCountRef.current += 1;

          setFaultLog(prev => {
            const newEntry = {
              time: fault.ts ? new Date(fault.ts).toLocaleTimeString() : new Date().toLocaleTimeString(),
              device: fault.device_id || 'unknown',
              type: fault.flags ? fault.flags.join(', ') : 'MALFORMED',
              raw: fault.raw || ''
            };
            return [newEntry, ...prev].slice(0, 50);
          });

          const deviceId = fault.device_id || 'unknown';
          setSensorData(prev => ({
            ...prev,
            [deviceId]: {
              ...prev[deviceId],
              status: 'fault',
              lastUpdate: Date.now()
            }
          }));
        }

        if (e.data.type === 'WS_CONNECTED') {
          console.log('✅ WebSocket connected');
          setIsWsConnected(true);
        }
      };
    }

    if (canvasRef.current && !isInitialized.current) {
      try {
        const offscreen = canvasRef.current.transferControlToOffscreen();
        workerRef.current.postMessage({ type: 'INIT', payload: { canvas: offscreen } }, [offscreen]);
        isInitialized.current = true;
        const rect = canvasRef.current.parentElement?.getBoundingClientRect();
        if (rect) {
          workerRef.current.postMessage({
            type: 'RESIZE',
            payload: {
              width: Math.floor(rect.width * window.devicePixelRatio),
              height: Math.floor(280 * window.devicePixelRatio)
            }
          });
        }
      } catch (err) {
        console.warn("Canvas init error:", err);
      }
    }

    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'CONNECT_WS', payload: { url: WS_URL } });
    }

    const statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastRateCalc.current) / 1000;
      if (elapsed >= 1) {
        const total = eventCountRef.current;
        const faults = faultCountRef.current;
        const rate = total > 0 ? Math.round((faults / total) * 100) : 0;
        setEventsPerSec(total);
        setFaultRate(rate);
        eventCountRef.current = 0;
        faultCountRef.current = 0;
        lastRateCalc.current = now;
      }

      const diff = Date.now() - startTime;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const remainMin = minutes % 60;
      const remainSec = seconds % 60;
      let uptimeStr = '';
      if (hours > 0) uptimeStr += hours + 'h ';
      if (remainMin > 0) uptimeStr += remainMin + 'm ';
      uptimeStr += remainSec + 's';
      setUptime(uptimeStr);
    }, 1000);

    return () => {
      clearInterval(statsInterval);
      if (channelRef.current) channelRef.current.close();
    };
  }, []);

  const handleAlertToggle = () => {
    const newState = !alertMuted;
    setAlertMuted(newState);
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'TOGGLE_ALERT',
        payload: newState,
        timestamp: Date.now()
      });
    }
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

  const now = Date.now();
  let activeCount = 0;
  const sensorStatus = {};
  sensorIds.forEach(id => {
    const data = sensorData[id];
    const isActive = data && (data.status === 'normal' || data.status === 'fault') && (now - (data.lastUpdate || 0) < 5000);
    if (isActive) activeCount++;
    sensorStatus[id] = isActive ? 'active' : 'inactive';
  });

  return (
    <div style={{
      padding: '12px 20px',
      background: '#020617',
      color: '#f8fafc',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      boxSizing: 'border-box',
      fontFamily: 'monospace',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #1e293b',
        paddingBottom: '6px',
        flexShrink: 0
      }}>
        <h1 style={{ fontSize: '1rem', color: '#38bdf8', margin: 0 }}>
          IOT-01: FUSION DASHBOARD // FAULT-RESILIENT PIPELINE
        </h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isWsConnected ? '#22c55e' : '#ef4444' }}></span>
              <span style={{ fontSize: '0.55rem', color: '#94a3b8' }}>WS</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }}></span>
              <span style={{ fontSize: '0.55rem', color: '#94a3b8' }}>Backend</span>
            </span>
          </div>
          <span style={{
            fontSize: '0.55rem',
            background: faultCount > 0 && !alertMuted ? '#7f1d1d' : '#1e293b',
            color: faultCount > 0 && !alertMuted ? '#fca5a5' : '#475569',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 'bold'
          }}>
            ⚡ {faultCount} faults
          </span>
          <button onClick={handleReplayToggle} style={{
            background: isReplaying ? '#eab308' : '#3b82f6',
            color: '#000',
            border: 'none',
            padding: '3px 10px',
            borderRadius: '4px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '0.65rem'
          }}>
            {isReplaying ? '⏩ REPLAYING' : '⏪ REPLAY LAST 60S'}
          </button>
          <button onClick={handleAlertToggle} style={{
            background: alertMuted ? '#475569' : '#22c55e',
            color: alertMuted ? '#94a3b8' : '#fff',
            border: 'none',
            padding: '3px 10px',
            borderRadius: '4px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '0.65rem'
          }}>
            {alertMuted ? '🔇 MUTED' : '🔊 ACTIVE'}
          </button>
        </div>
      </div>

      {/* Stats Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', flexShrink: 0 }}>
        <div style={{ background: '#0f172a', padding: '4px 10px', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.5rem', color: '#64748b' }}>Events/sec</div>
          <div style={{ fontSize: '1rem', color: '#38bdf8', fontWeight: 'bold' }}>{eventsPerSec}</div>
        </div>
        <div style={{ background: '#0f172a', padding: '4px 10px', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.5rem', color: '#64748b' }}>Fault Rate</div>
          <div style={{ fontSize: '1rem', color: '#eab308', fontWeight: 'bold' }}>{faultRate}%</div>
        </div>
        <div style={{ background: '#0f172a', padding: '4px 10px', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.5rem', color: '#64748b' }}>Active Sensors</div>
          <div style={{ fontSize: '1rem', color: '#22c55e', fontWeight: 'bold' }}>{activeCount}/{sensorIds.length}</div>
        </div>
        <div style={{ background: '#0f172a', padding: '4px 10px', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.5rem', color: '#64748b' }}>Uptime</div>
          <div style={{ fontSize: '1rem', color: '#94a3b8', fontWeight: 'bold' }}>{uptime}</div>
        </div>
      </div>

      {/* Main Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minHeight: 0 }}>
        {/* Left: Canvas */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexShrink: 0 }}>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>LIVE TELEMETRY</span>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '0.5rem', color: '#64748b' }}>Temp</span>
                <span style={{ fontSize: '0.85rem', color: '#38bdf8', fontWeight: 'bold', marginLeft: '4px' }}>
                  {latestTemp !== null ? latestTemp.toFixed(1) + '°C' : '--'}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '0.5rem', color: '#64748b' }}>Vibration</span>
                <span style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 'bold', marginLeft: '4px' }}>
                  {latestVib !== null ? latestVib.toFixed(2) + ' Hz' : '--'}
                </span>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <canvas ref={canvasRef} style={{
              border: `2px solid ${alertMuted ? '#1e293b' : '#22c55e'}`,
              borderRadius: '6px',
              width: '100%',
              height: '100%',
              display: 'block',
              background: '#0f172a'
            }} />
          </div>
        </div>

        {/* Right: Sensor Grid + Fault Log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
          {/* Sensor Grid - Smaller Boxes */}
          <div style={{
            background: '#0a0f1a',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '6px',
            flex: '0 0 auto'
          }}>
            <div style={{ fontSize: '0.55rem', color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold' }}>
              SENSOR GRID
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
              {sensorIds.map(id => {
                const data = sensorData[id];
                const temp = data?.temp;
                const status = sensorStatus[id] || 'inactive';
                const isFault = data?.status === 'fault';
                const isActive = status === 'active';
                const borderColor = isActive ? '#22c55e' : (isFault ? '#ef4444' : '#1e293b');
                const valueStr = temp !== undefined && !isNaN(temp) ? temp.toFixed(1) + '°C' : '--';
                return (
                  <div key={id} style={{
                    border: `1px solid ${borderColor}`,
                    borderRadius: '3px',
                    padding: '2px 4px',
                    textAlign: 'center',
                    background: isFault ? 'rgba(239,68,68,0.08)' : 'transparent',
                    opacity: alertMuted && isFault ? 0.5 : 1
                  }}>
                    <div style={{ fontSize: '0.4rem', color: '#94a3b8' }}>{id.replace('sensor_', '')}</div>
                    <div style={{ fontSize: '0.6rem', color: '#f8fafc', fontWeight: 'bold' }}>{valueStr}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fault Log - Fixed Table */}
          <div style={{
            background: '#0a0f1a',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '6px',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              fontSize: '0.55rem',
              color: alertMuted ? '#475569' : '#ef4444',
              fontWeight: 'bold',
              marginBottom: '4px',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              <span>FAULT LOG</span>
              <span style={{ fontSize: '0.5rem', color: '#475569' }}>{faultLog.length} events</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.5rem', fontFamily: 'monospace' }}>
              {faultLog.length === 0 ? (
                <div style={{ color: '#475569', padding: '10px 0', textAlign: 'center' }}>No faults detected</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '28%' }} />
                    <col style={{ width: '50%' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: '#64748b', borderBottom: '1px solid #1e293b' }}>
                      <th style={{ textAlign: 'left', padding: '2px' }}>Time</th>
                      <th style={{ textAlign: 'left', padding: '2px' }}>Device</th>
                      <th style={{ textAlign: 'left', padding: '2px' }}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faultLog.slice(0, 10).map((fault, idx) => (
                      <tr key={idx} style={{
                        borderBottom: '1px solid rgba(30,41,59,0.3)',
                        opacity: alertMuted ? 0.4 : 1,
                      }}>
                        <td style={{ padding: '2px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fault.time}</td>
                        <td style={{ padding: '2px', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fault.device}</td>
                        <td style={{ padding: '2px', color: alertMuted ? '#94a3b8' : '#fca5a5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fault.type}>
                          {fault.type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}