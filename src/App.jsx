import { useEffect, useRef, useState } from 'react';

export default function App() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const channelRef = useRef(null);
  const isInitialized = useRef(false);
  const sensorBatch = useRef({});
const batchTimer = useRef(null);
const eventBatch = useRef({ count: 0, faults: 0 });

  const [alertMuted, setAlertMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
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
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, ts: '', temp: '', vib: '', device: '', isFault: false });

  const WS_URL = 'wss://ironstream-backend-89io.onrender.com/ws/ingest';
const REPLAY_URL = 'https://ironstream-backend-89io.onrender.com/api/replay';
  const startTime = Date.now();

  const eventCountRef = useRef(0);
  const faultCountRef = useRef(0);
  const lastRateCalc = useRef(Date.now());

  const sensorIds = Array.from({ length: 16 }, (_, i) => `sensor_f1_${String(i + 1).padStart(2, '0')}`);

  useEffect(() => {
    // BroadcastChannel
    const channel = new BroadcastChannel('crdt_state_sync');
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'TOGGLE_ALERT') {
        setAlertMuted(event.data.payload);
      }
    };

    // Create worker
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./telemetry.worker.js', import.meta.url), {
        type: 'module'
      });

      workerRef.current.addEventListener('message', (e) => {
        console.log('[APP] Received message type:', e.data.type);

        if (e.data.type === 'TELEMETRY_DATA') {
  const data = e.data.payload;
  const deviceId = data.device_id || data.device || 'unknown';
  let temp = data?.payload?.metrics?.temperature ?? data?.metrics?.temperature ?? data?.temperature;
  let vib = data?.payload?.metrics?.vibration ?? data?.metrics?.vibration ?? data?.vibration;

  if (temp !== undefined && !isNaN(temp) && typeof temp === 'number') {
    const now = Date.now();
    // Accumulate in batch
    sensorBatch.current[deviceId] = {
      temp: temp,
      vibration: vib,
      status: 'normal',
      lastUpdate: now
    };
    eventBatch.current.count += 1;
    if (data.type === 'fault' || data.is_fault) eventBatch.current.faults += 1;

    // Flush every 100ms
    if (!batchTimer.current) {
      batchTimer.current = setTimeout(() => {
        // Update sensor data
        setSensorData(prev => ({ ...prev, ...sensorBatch.current }));
        sensorBatch.current = {};
        // Update total events
        setTotalEvents(prev => prev + eventBatch.current.count);
        eventCountRef.current += eventBatch.current.count;
        setFaultCount(prev => prev + eventBatch.current.faults);
        faultCountRef.current += eventBatch.current.faults;
        eventBatch.current = { count: 0, faults: 0 };
        batchTimer.current = null;
      }, 100);
    }
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
          console.log('WebSocket connected');
          setIsWsConnected(true);
        }

        if (e.data.type === 'TOOLTIP') {
          setTooltip(e.data.payload);
        }

        if (e.data.type === 'TEST_MESSAGE') {
          console.log('[APP] Test message from worker:', e.data.payload);
        }
      });
    }

    // OffscreenCanvas init
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

    // --- Mouse hover events (no early return) ---
    const canvasContainer = canvasRef.current?.parentElement;
    const mouseMoveHandler = (e) => {
      if (!canvasRef.current || isPaused) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
      const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'HOVER', payload: { x, y } });
      }
    };
    const mouseLeaveHandler = () => {
      setTooltip({ visible: false, x: 0, y: 0, ts: '', temp: '', vib: '', device: '', isFault: false });
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'HOVER', payload: { x: null } });
      }
    };
    if (canvasContainer) {
      canvasContainer.addEventListener('mousemove', mouseMoveHandler);
      canvasContainer.addEventListener('mouseleave', mouseLeaveHandler);
    }

    // --- Stats interval (now it will run because no early return) ---
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastRateCalc.current) / 1000;
      if (elapsed >= 1) {
        const total = eventCountRef.current;
        const faults = faultCountRef.current;
        const rate = total > 0 ? Math.round((faults / total) * 100) : 0;
        setEventsPerSec(total);
        setFaultRate(rate);
        console.log('[STATS] total:', total, 'faults:', faults, 'rate:', rate);
        // Reset counters for next second
        eventCountRef.current = 0;
        faultCountRef.current = 0;
        lastRateCalc.current = now;
      }

      // Update uptime
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

    // --- Cleanup function ---
    return () => {
      clearInterval(statsInterval);
      if (canvasContainer) {
        canvasContainer.removeEventListener('mousemove', mouseMoveHandler);
        canvasContainer.removeEventListener('mouseleave', mouseLeaveHandler);
      }
      if (channelRef.current) channelRef.current.close();
    };
  }, []);

  // Handlers
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

  const handlePauseToggle = () => {
    const newPause = !isPaused;
    setIsPaused(newPause);
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'PAUSE', payload: { paused: newPause } });
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

  // Active sensors
  const now = Date.now();
  let activeCount = 0;
  const sensorStatus = {};
  sensorIds.forEach(id => {
    const data = sensorData[id];
    const isActive = data && (data.status === 'normal' || data.status === 'fault') && (now - (data.lastUpdate || 0) < 5000);
    if (isActive) activeCount++;
    sensorStatus[id] = isActive ? 'active' : 'inactive';
  });

  // Glassmorphism constants
  const glassBg = 'rgba(20, 24, 32, 0.65)';
  const glassBorder = 'rgba(42, 49, 60, 0.35)';
  const accent = '#F59E0B';
  const success = '#10B981';
  const danger = '#EF4444';
  const textPrimary = '#F1F5F9';
  const textSecondary = '#94A3B8';
  const chartLine = '#14B8A6';

  return (
    <div style={{
      padding: '12px 20px',
      background: '#0B0E14',
      color: textPrimary,
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      boxSizing: 'border-box',
      fontFamily: 'monospace',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      position: 'relative'
    }}>
      {/* Background glows */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        right: '-10%',
        width: '40%',
        height: '40%',
        background: 'radial-gradient(circle, rgba(245,158,11,0.06) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-20%',
        left: '-10%',
        width: '40%',
        height: '40%',
        background: 'radial-gradient(circle, rgba(20,184,166,0.05) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        background: glassBg,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '12px',
        border: `1px solid ${glassBorder}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        flexShrink: 0,
        position: 'relative',
        zIndex: 1
      }}>
        <h1 style={{ fontSize: '1rem', color: accent, margin: 0, letterSpacing: '0.5px', textShadow: '0 0 20px rgba(245,158,11,0.15)' }}>
          IRONSTREAM
        </h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isWsConnected ? success : danger, boxShadow: `0 0 8px ${isWsConnected ? success : danger}` }} />
              <span style={{ fontSize: '0.55rem', color: textSecondary }}>WS</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: success, boxShadow: `0 0 8px ${success}` }} />
              <span style={{ fontSize: '0.55rem', color: textSecondary }}>Backend</span>
            </span>
          </div>
          <span style={{
            fontSize: '0.55rem',
            background: faultCount > 0 && !alertMuted ? danger : 'rgba(42,49,60,0.4)',
            color: faultCount > 0 && !alertMuted ? '#F1F5F9' : textSecondary,
            padding: '2px 10px',
            borderRadius: '20px',
            fontWeight: 'bold',
            border: `1px solid ${faultCount > 0 && !alertMuted ? danger : 'transparent'}`
          }}>
            ⚡ {faultCount} faults
          </span>
          <button onClick={handlePauseToggle} style={{
            background: isPaused ? accent : 'rgba(42,49,60,0.3)',
            color: isPaused ? '#000' : textPrimary,
            border: `1px solid ${isPaused ? accent : glassBorder}`,
            padding: '3px 12px',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '0.65rem',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s'
          }}>
            {isPaused ? 'RESUME' : 'PAUSE'}
          </button>
          <button onClick={handleReplayToggle} style={{
            background: isReplaying ? accent : 'rgba(42,49,60,0.3)',
            color: isReplaying ? '#000' : textPrimary,
            border: `1px solid ${isReplaying ? accent : glassBorder}`,
            padding: '3px 12px',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '0.65rem',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s'
          }}>
            {isReplaying ? 'REPLAYING' : 'REPLAY LAST 60S'}
          </button>
          <button onClick={handleAlertToggle} style={{
            background: alertMuted ? 'rgba(42,49,60,0.4)' : success,
            color: alertMuted ? textSecondary : '#000',
            border: `1px solid ${alertMuted ? glassBorder : success}`,
            padding: '3px 12px',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '0.65rem',
            backdropFilter: 'blur(4px)',
            transition: 'all 0.2s'
          }}>
            {alertMuted ? 'ALERTS INACTIVE' : 'ALERTS ACTIVE'}
          </button>
        </div>
      </div>

      {/* Stats Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', flexShrink: 0, position: 'relative', zIndex: 1 }}>
        {[
          { label: 'Events/sec', value: eventsPerSec, color: accent },
          { label: 'Fault Rate', value: faultRate + '%', color: accent },
          { label: 'Active Sensors', value: `${activeCount}/${sensorIds.length}`, color: success },
          { label: 'Uptime', value: uptime, color: textPrimary }
        ].map((stat, idx) => (
          <div key={idx} style={{
            background: glassBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '10px',
            padding: '6px 12px',
            border: `1px solid ${glassBorder}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '0.5rem', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</div>
            <div style={{ fontSize: '1rem', color: stat.color, fontWeight: 'bold', textShadow: `0 0 20px ${stat.color}15` }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Main Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minHeight: 0, position: 'relative', zIndex: 1 }}>
        {/* Left: Canvas */}
        <div style={{
          background: glassBg,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: '12px',
          border: `1px solid ${glassBorder}`,
          padding: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexShrink: 0 }}>
            <span style={{ fontSize: '0.65rem', color: textSecondary, letterSpacing: '0.5px' }}>LIVE TELEMETRY</span>
            <div style={{ display: 'flex', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '0.5rem', color: textSecondary }}>Temp</span>
                <span style={{ fontSize: '0.85rem', color: chartLine, fontWeight: 'bold', marginLeft: '4px', textShadow: `0 0 20px ${chartLine}20` }}>
                  {latestTemp !== null ? latestTemp.toFixed(1) + '°C' : '--'}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '0.5rem', color: textSecondary }}>Vibration</span>
                <span style={{ fontSize: '0.85rem', color: accent, fontWeight: 'bold', marginLeft: '4px', textShadow: `0 0 20px ${accent}20` }}>
                  {latestVib !== null ? latestVib.toFixed(2) + ' Hz' : '--'}
                </span>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: '6px', overflow: 'hidden' }}>
            <canvas ref={canvasRef} style={{
              border: `1px solid ${alertMuted ? glassBorder : accent}`,
              borderRadius: '6px',
              width: '100%',
              height: '100%',
              display: 'block',
              background: '#0B0E14'
            }} />
            {isPaused && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(8px)',
                padding: '10px 20px',
                borderRadius: '8px',
                fontSize: '1rem',
                color: accent,
                fontWeight: 'bold',
                border: `1px solid ${accent}40`,
                pointerEvents: 'none'
              }}>
                ⏸ PAUSED
              </div>
            )}
            {tooltip.visible && (
              <div style={{
                position: 'absolute',
                left: Math.min(tooltip.x + 10, (canvasRef.current?.width || 0) - 220),
                top: tooltip.y - 10,
                background: 'rgba(11,14,20,0.9)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(42,49,60,0.5)',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.55rem',
                color: '#F1F5F9',
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                whiteSpace: 'nowrap'
              }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <span>{tooltip.ts}</span>
                  <span style={{ color: '#14B8A6' }}>T: {tooltip.temp}</span>
                  <span style={{ color: '#F59E0B' }}>V: {tooltip.vib}</span>
                  <span style={{ color: '#94A3B8' }}>{tooltip.device}</span>
                  {tooltip.isFault && <span style={{ color: '#EF4444' }}>Fault</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Sensor Grid + Fault Log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          {/* Sensor Grid */}
          <div style={{
            background: glassBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '12px',
            border: `1px solid ${glassBorder}`,
            padding: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            flex: '0 0 auto'
          }}>
            <div style={{ fontSize: '0.55rem', color: textSecondary, marginBottom: '4px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
              SENSOR GRID
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
              {sensorIds.map(id => {
                const data = sensorData[id];
                const temp = data?.temp;
                const status = sensorStatus[id] || 'inactive';
                const isFault = data?.status === 'fault';
                const isActive = status === 'active';
                const borderColor = isActive ? success : (isFault ? danger : glassBorder);
                const valueStr = temp !== undefined && !isNaN(temp) ? temp.toFixed(1) + '°C' : '--';
                return (
                  <div key={id} style={{
                    border: `1px solid ${borderColor}`,
                    borderRadius: '6px',
                    padding: '4px 2px',
                    textAlign: 'center',
                    background: isFault ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                    opacity: alertMuted && isFault ? 0.5 : 1,
                    transition: 'all 0.2s'
                  }}>
                    <div style={{ fontSize: '0.4rem', color: textSecondary }}>{id.replace('sensor_', '')}</div>
                    <div style={{ fontSize: '0.6rem', color: textPrimary, fontWeight: 'bold' }}>{valueStr}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fault Log */}
          <div style={{
            background: glassBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '12px',
            border: `1px solid ${glassBorder}`,
            padding: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              fontSize: '0.55rem',
              color: alertMuted ? textSecondary : danger,
              fontWeight: 'bold',
              marginBottom: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              letterSpacing: '0.5px'
            }}>
              <span>FAULT LOG</span>
              <span style={{ fontSize: '0.5rem', color: textSecondary }}>{faultLog.length} events</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.5rem', fontFamily: 'monospace' }}>
              {faultLog.length === 0 ? (
                <div style={{ color: textSecondary, padding: '10px 0', textAlign: 'center' }}>No faults detected</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '28%' }} />
                    <col style={{ width: '50%' }} />
                  </colgroup>
                  <tbody>
                    {faultLog.slice(0, 10).map((fault, idx) => (
                      <tr key={idx} style={{
                        borderBottom: `1px solid ${glassBorder}`,
                        opacity: alertMuted ? 0.4 : 1,
                      }}>
                        <td style={{ padding: '4px 2px', color: textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fault.time}</td>
                        <td style={{ padding: '4px 2px', color: textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fault.device}</td>
                        <td style={{ padding: '4px 2px', color: alertMuted ? textSecondary : danger, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', wordBreak: 'break-word' }} title={fault.type}>
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