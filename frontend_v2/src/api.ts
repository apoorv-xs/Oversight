import { state } from './state';
import { trackFlow, prependToStream, showAnomalyToast, showSystemToast, addToNotificationHistory, clearDashboardUi, updatePanelDots } from './ui';
import { addGlobeArc } from './globe';
import { audio } from './audio';
import { formatTimestampToTimeStr } from './utils';
import { io, Socket } from 'socket.io-client';
import type { AnomalyData, NormalFlowData } from './types';

export function handleStartCapture(clearUi = true): void {
  state.isCapturing = true;
  const btnToggle = document.getElementById('btnToggleCapture');
  if (btnToggle) {
    btnToggle.textContent = 'Stop Engine';
    btnToggle.classList.add('is-active');
  }
  if (clearUi) clearDashboardUi();
  initSocketEvents();
  audio.startHum();

  if (!state.radarSweepInterval) {
    audio.playRadarSweep();
    state.radarSweepInterval = setInterval(() => {
      if (state.isCapturing && document.visibilityState === 'visible') audio.playRadarSweep();
    }, 4000);
  }
}

export function handleStopCapture(errorMsg: string | null = null): void {
  state.isCapturing = false;
  const btnToggle = document.getElementById('btnToggleCapture');
  if (btnToggle) {
    btnToggle.textContent = 'Start Engine';
    btnToggle.classList.remove('is-active');
  }
  audio.stopHum();
  if (state.radarSweepInterval) {
    clearInterval(state.radarSweepInterval);
    state.radarSweepInterval = null;
  }
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  clearDashboardUi();
  if (errorMsg) showSystemToast('CAPTURE ENGINE FAILURE', errorMsg, true);
}

export function toggleAiCapture(): void {
  const btnToggle = document.getElementById('btnToggleCapture');
  if (!btnToggle) return;

  if (state.isCapturing) {
    fetch('/api/stop-capture', { method: 'POST' })
      .then(res => res.json())
      .then(data => { if (data.status === 'success') handleStopCapture(); });
  } else {
    btnToggle.textContent = 'Connecting...';
    fetch('/api/start-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' || (data.message && data.message.includes('already running'))) {
          handleStartCapture(true);
          if (data.warning) showSystemToast('PRIVILEGE WARNING', data.warning, false);
        } else {
          setRetryState(btnToggle);
          showSystemToast('CAPTURE ENGINE FAILURE', data.message || 'Failed to start threat capture engine.', true);
        }
      })
      .catch(() => {
        setRetryState(btnToggle);
        showSystemToast('CAPTURE CONNECTION ERROR', 'Unable to reach backend security server.', true);
      });
  }
}

function setRetryState(btnToggle: HTMLElement): void {
  btnToggle.textContent = 'Retry';
  setTimeout(() => { if (!state.isCapturing) btnToggle.textContent = 'Start Engine'; }, 3000);
}

import { heartbeatViz } from './heartbeat';
import { confidenceViz } from './confidence';

export function initSocketEvents(): void {
  if (state.socket) return;

  state.socket = io({ transports: ['websocket', 'polling'] });

  state.socket.on('connect', () => console.log('Socket connected for real-time AI'));

  state.socket.on('packet', (data: any) => {
    if (state.lockedOnIp && data.src !== state.lockedOnIp && data.dst !== state.lockedOnIp) return;
    trackFlow(data, false);
    addGlobeArc(data, false);
    if (heartbeatViz) heartbeatViz.pulse(0.5, false);
    if (confidenceViz) confidenceViz.addPacket(data.reconstruction_error, state.adaptive ? state.adaptive.model_threshold : 0.03, false);
  });

  state.socket.on('anomaly', (data: any) => {
    if (state.lockedOnIp && data.src !== state.lockedOnIp && data.dst !== state.lockedOnIp) return;
    prependToStream(data, true);
    trackFlow(data, true);
    addGlobeArc(data, true);
    showAnomalyToast(data);
    addToNotificationHistory(data);
    audio.playAlarm();
    if (heartbeatViz) heartbeatViz.pulse(1, true);
    if (confidenceViz) confidenceViz.addPacket(data.reconstruction_error, state.adaptive ? state.adaptive.model_threshold : 0.03, true);
  });

  state.socket.on('normal_flow', (data: any) => {
    if (state.lockedOnIp && data.src !== state.lockedOnIp && data.dst !== state.lockedOnIp) return;
    prependToStream(data, false);
    trackFlow(data, false);
    addGlobeArc(data, false);
    if (heartbeatViz) heartbeatViz.pulse(1, false);
    if (confidenceViz) confidenceViz.addPacket(data.reconstruction_error, state.adaptive ? state.adaptive.model_threshold : 0.03, false);
  });
}

export async function updateBackgroundStats(): Promise<void> {
  if (document.hidden) return;
  try {
    const res = await fetch(`/api/capture-status?_=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();

    if (data.status === 'success' && data.data) {
      const stats = data.data.stats;
      const isCapturing = data.data.capturing;
      const captureErr = data.data.error;

      if (isCapturing !== state.isCapturing) {
        if (isCapturing) handleStartCapture(true);
        else handleStopCapture(captureErr);
      }

      const barPackets = document.getElementById('barPackets');
      const barAnomalies = document.getElementById('barAnomalies');
      const barBlocklist = document.getElementById('barBlocklist');
      const barEngine = document.getElementById('barEngineStatus');

      if (barPackets) barPackets.innerText = (isCapturing && stats) ? (stats.total_packets || 0).toLocaleString() : '0';
      if (barAnomalies) barAnomalies.innerText = (isCapturing && stats) ? (stats.anomaly_count || 0) : '0';
      if (barBlocklist) barBlocklist.innerText = (isCapturing && stats) ? (stats.blocklist_hits || 0) : '0';
      if (barEngine) {
        barEngine.innerText = isCapturing ? 'ACTIVE' : 'IDLE';
        barEngine.style.color = isCapturing ? 'var(--text-primary)' : 'var(--text-tertiary)';
        barEngine.classList.toggle('engine-active', isCapturing);
      }

      if (isCapturing && stats && stats.recent_anomalies && stats.recent_anomalies.length > 0) {
        let updated = false;
        if (!state.streamEvents) state.streamEvents = [];
        for (const anomaly of stats.recent_anomalies) {
          const exists = state.streamEvents.some(e => e.src === anomaly.src && e.dst === anomaly.dst && e.dport === anomaly.dport && e.timestamp === anomaly.timestamp);
          if (!exists) {
            state.streamEvents.push({
              id: `stream-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              src: anomaly.src, src_host: anomaly.src_host, dst: anomaly.dst, dst_host: anomaly.dst_host,
              dport: anomaly.dport, isAnomaly: true, isSafe: false,
              time: formatTimestampToTimeStr(anomaly.timestamp), timestamp: anomaly.timestamp,
              reconstruction_error: anomaly.reconstruction_error || null, raw_features: anomaly.raw_features || null,
            });
            updated = true;
          }
        }
        if (updated) {
          state.streamEvents.sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime());
          if (state.streamEvents.length > 100) state.streamEvents = state.streamEvents.slice(0, 100);
          import('./ui').then(m => m.renderStreamList());
        }
      }
    }
  } catch (e) {
    console.error("Error fetching capture-status:", e);
    const barPackets = document.getElementById('barPackets');
    if (barPackets) barPackets.innerText = 'ERR';
  }

  try {
    const res2 = await fetch(`/api/adaptive-stats?_=${Date.now()}`);
    if (!res2.ok) throw new Error(`HTTP error! status: ${res2.status}`);
    const data2 = await res2.json();

    if (data2.status === 'success' && data2.data) {
      state.adaptive = data2.data;
      const barThreshold = document.getElementById('barThreshold');
      const barBaseline = document.getElementById('barBaseline');
      const barPct = document.getElementById('barAdaptivePct');
      const barFill = document.getElementById('barProgressFill');

      if (barThreshold) barThreshold.innerText = state.adaptive.model_threshold ? Number(state.adaptive.model_threshold).toFixed(4) : '--';
      if (barBaseline) barBaseline.innerText = state.adaptive.total_baseline ? state.adaptive.total_baseline.toLocaleString() : '--';
      const pct = state.adaptive.retrain_threshold > 0
        ? Math.min((state.adaptive.new_since_retrain / state.adaptive.retrain_threshold) * 100, 100) : 0;
      if (barPct) barPct.innerText = `${Math.round(pct)}%`;
      if (barFill) barFill.style.width = `${pct}%`;
    }
  } catch (e) {
    console.error("Error fetching adaptive-stats:", e);
    const barBaseline = document.getElementById('barBaseline');
    if (barBaseline) barBaseline.innerText = 'ERR';
  }
  updatePanelDots();
}

export function updateFlowTimeout(seconds: number): void {
  fetch('/api/update-timeout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: seconds }),
  })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        state.flowTimeout = seconds;
        console.log(`Flow aggregation timeout updated: ${seconds}s`);
      } else {
        showSystemToast('TIMEOUT SYNC ERROR', data.message || 'Failed to sync timeout with server.', true);
      }
    })
    .catch(() => showSystemToast('TIMEOUT SYNC FAILURE', 'Connection error while saving timeout value.', true));
}
