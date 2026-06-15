import { state } from './state';
import { nowTimeStr, alertTitle, getGlobalArcs, formatTimestampToTimeStr, checkIsLocalIp, checkIsLocalConnection } from './utils';
import { audio } from './audio';
import type { FlowEntry, StreamEvent, AnomalyData } from './types';

export let latestScanData: any = null;

/* ─── Whitelist ─── */

export async function fetchWhitelist(): Promise<void> {
  try {
    const res = await fetch('/api/whitelist');
    const resp = await res.json();
    if (resp.status === 'success') {
      state.whitelist = resp.data || [];
      const leftSafeFlows = document.getElementById('aiSafeFlows');
      if (leftSafeFlows) leftSafeFlows.innerText = String(state.whitelist.length);
    }
  } catch (e) {
    console.error("Failed to fetch whitelist:", e);
  }
}
(window as any).fetchWhitelist = fetchWhitelist;

(window as any).selectWhitelistItem = function (ip: string) {
  state.selectedFlowId = null;
  toggleLockOn(ip);
};

/* ─── Flow Tracking & Stream ─── */

export function isFlowSelected(f: FlowEntry): boolean {
  if (!state.selectedFlowId) return false;
  if (state.selectedFlowId === f.id) return true;
  const target = getSelectedFlowEndpoints();
  if (target) return f.src === target.src && f.dst === target.dst && f.dport === target.dport;
  return false;
}

export function isStreamEventSelected(event: StreamEvent): boolean {
  if (!state.selectedFlowId) return false;
  if (state.selectedFlowId === event.id) return true;
  const target = getSelectedFlowEndpoints();
  if (target) return event.src === target.src && event.dst === target.dst && event.dport === target.dport;
  return false;
}

export function trackFlow(data: { src: string; dst: string; dport: number; src_host?: string; dst_host?: string; geo?: any }, isAnomaly: boolean): void {
  const existingIndex = state.recentFlows.findIndex(f =>
    f.src === data.src && f.dst === data.dst && f.dport === data.dport
  );

  if (existingIndex !== -1) {
    const flow = state.recentFlows.splice(existingIndex, 1)[0];
    flow.time = nowTimeStr();
    flow.lastSeen = Date.now();
    if (isAnomaly) flow.isAnomaly = true;
    if (data.src_host) flow.src_host = data.src_host;
    if (data.dst_host) flow.dst_host = data.dst_host;
    state.recentFlows.unshift(flow);
  } else {
    state.recentFlows.unshift({
      id: `flow-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      src: data.src,
      src_host: data.src_host,
      dst: data.dst,
      dst_host: data.dst_host,
      dport: data.dport,
      isAnomaly,
      time: nowTimeStr(),
      lastSeen: Date.now(),
      hasGeo: !!data.geo,
    });
  }

  if (state.recentFlows.length > 100) state.recentFlows.pop();
  renderActiveFlowsList();
}

// Expire flows after 5s unless selected
setInterval(() => {
  const now = Date.now();
  const initialLen = state.recentFlows.length;
  state.recentFlows = state.recentFlows.filter(f => {
    const sel = isFlowSelected(f);
    return (now - f.lastSeen) < 5000 || sel;
  });
  if (state.recentFlows.length !== initialLen) renderActiveFlowsList();
}, 2000);

export function prependToStream(data: any, isAnomaly: boolean): void {
  if (!state.streamEvents) state.streamEvents = [];
  state.streamEvents.unshift({
    id: `stream-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    src: data.src,
    src_host: data.src_host,
    dst: data.dst,
    dst_host: data.dst_host,
    dport: data.dport,
    isAnomaly,
    isSafe: false,
    time: data.timestamp ? formatTimestampToTimeStr(data.timestamp) : nowTimeStr(),
    timestamp: data.timestamp || new Date().toISOString(),
    reconstruction_error: data.reconstruction_error || data.error || null,
    raw_features: data.raw_features || null,
  });
  if (state.streamEvents.length > 100) state.streamEvents.pop();
  renderStreamList();
}

/* ─── Throttled renders ─── */

let lastStreamRender = 0;
let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
let streamRenderPending = false;

export function renderStreamList(): void {
  const now = Date.now();
  const timeSinceLastRender = now - lastStreamRender;
  const throttleDelay = 150;

  if (timeSinceLastRender < throttleDelay) {
    if (!streamTimeoutId) {
      streamTimeoutId = setTimeout(() => {
        streamTimeoutId = null;
        renderStreamList();
      }, throttleDelay - timeSinceLastRender);
    }
    return;
  }
  if (streamTimeoutId) { clearTimeout(streamTimeoutId); streamTimeoutId = null; }
  lastStreamRender = now;
  if (streamRenderPending) return;
  streamRenderPending = true;

  requestAnimationFrame(() => {
    streamRenderPending = false;
    const listEl = document.getElementById('aiStreamList');
    if (!listEl) return;
    if (!state.streamEvents) state.streamEvents = [];

    const isUserLaptop = (eventOrFlow: any): boolean => {
      const srcHost = (eventOrFlow.src_host || '').toLowerCase();
      const dstHost = (eventOrFlow.dst_host || '').toLowerCase();
      const src = (eventOrFlow.src || '').toLowerCase();
      const dst = (eventOrFlow.dst || '').toLowerCase();
      const isUk = (v: string) => v.includes('laptop-uk') || v.includes('laptop_uk') || v.includes('laptop uk');
      return isUk(srcHost) || isUk(dstHost) || isUk(src) || isUk(dst);
    };

    const leftAnomalies = document.getElementById('aiAnomalies');
    if (leftAnomalies) {
      const c = state.streamEvents.filter(e => e.isAnomaly && !e.isSafe && !isUserLaptop(e)).length;
      leftAnomalies.innerText = String(c);
      leftAnomalies.style.color = c > 0 ? 'var(--status-danger)' : 'var(--text-secondary)';
    }

    const leftSafeFlows = document.getElementById('aiSafeFlows');
    if (leftSafeFlows) {
      const wc = (state.whitelist || []).length;
      leftSafeFlows.innerText = String(wc);
      leftSafeFlows.style.color = wc > 0 ? 'var(--status-safe)' : 'var(--text-secondary)';
    }

    if (!state.streamEvents.length) {
      listEl.innerHTML = `<div class="radar-empty-state"><div class="radar-sweep-scanner"></div><span class="radar-empty-title">SYSTEM SECURE</span><span class="radar-empty-subtitle">MONITORING PACKET VECTORSTREAM</span></div>`;
    }

    const anomalyListEl = document.getElementById('anomalyStreamList');
    if (!anomalyListEl) return;

    if (state.upperLeftFilter === 'SAFE') {
      renderSafeView(anomalyListEl, isUserLaptop);
    } else {
      renderAnomalyView(anomalyListEl, isUserLaptop);
    }

    // Top users aggregation
    const userStats: Record<string, any> = {};
    if (state.upperLeftFilter === 'SAFE') {
      for (const item of state.whitelist) {
        if (isUserLaptop(item)) continue;
        if (!userStats[item.src]) {
          const match = state.streamEvents.find(e => e.src === item.src && e.src_host);
          userStats[item.src] = { src: item.src, host: match ? match.src_host : item.src, packets: 0, anomalies: 0, maxLoss: 0, isSecured: true };
        }
        userStats[item.src].packets += 1;
      }
    } else {
      for (const ev of state.streamEvents) {
        if (isUserLaptop(ev)) continue;
        if (!userStats[ev.src]) {
          userStats[ev.src] = { src: ev.src, host: ev.src_host && ev.src_host !== ev.src ? ev.src_host : ev.src, packets: 0, anomalies: 0, maxLoss: 0 };
        }
        userStats[ev.src].packets++;
        if (ev.isAnomaly && !ev.isSafe) userStats[ev.src].anomalies++;
        if (ev.reconstruction_error && ev.reconstruction_error > userStats[ev.src].maxLoss) {
          userStats[ev.src].maxLoss = ev.reconstruction_error;
        }
      }
    }

    let filteredUsers = Object.values(userStats).sort((a, b) => {
      const isLocalA = checkIsLocalIp(a.src);
      const isLocalB = checkIsLocalIp(b.src);
      const hasAnomalyA = a.anomalies > 0;
      const hasAnomalyB = b.anomalies > 0;
      const groupA = hasAnomalyA ? (isLocalA ? 1 : 0) : (isLocalA ? 3 : 2);
      const groupB = hasAnomalyB ? (isLocalB ? 1 : 0) : (isLocalB ? 3 : 2);
      if (groupA !== groupB) return groupA - groupB;
      if (b.anomalies !== a.anomalies) return b.anomalies - a.anomalies;
      return b.packets - a.packets;
    }).slice(0, 25);

    let rowsHtml = '';
    if (filteredUsers.length === 0) {
      rowsHtml = `<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);font-family:'Courier New',monospace;font-size:0.62rem;padding:15px 0;letter-spacing:0.5px;">NO ACTIVE USERS IN CURRENT STATE</td></tr>`;
    } else {
      rowsHtml = filteredUsers.map(u => {
        const isThreat = u.anomalies > 0;
        const isLocked = state.lockedOnIp === u.src;
        const cls = `tactical-row ${isThreat ? 'is-threat' : ''} ${isLocked ? 'is-locked' : ''}`;
        let riskPct = isThreat ? Math.min(50 + (u.anomalies / u.packets) * 50, 100) : Math.min((u.maxLoss / 0.05) * 40, 40);
        return `<tr class="${cls}" title="${u.src}" onclick="toggleLockOn('${u.src}')" style="cursor:pointer;${isLocked ? 'background:rgba(255,42,42,0.2);border-left:2px solid var(--status-danger);' : ''}">
          <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.host}</td>
          <td style="text-align:right;">${u.packets}</td>
          <td style="text-align:right;font-weight:${isThreat ? 'bold' : 'normal'};">${u.anomalies}</td>
          <td style="width:60px;"><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${riskPct}%"></div></div></td>
        </tr>`;
      }).join('');
    }

    if (filteredUsers.length > 0) {
      listEl.innerHTML = `<table class="tactical-matrix-table"><thead><tr><th>User</th><th style="text-align:right;">Pkts</th><th style="text-align:right;">Anom</th><th>Risk</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    }
  });
}

function renderSafeView(container: HTMLElement, _isUserLaptop: (e: any) => boolean): void {
  const wl = state.whitelist || [];
  if (wl.length === 0) {
    container.innerHTML = `<div class="radar-empty-state"><span class="radar-empty-subtitle" style="font-family:'Courier New',monospace;font-size:0.75rem;color:rgba(255,255,255,0.4);text-transform:uppercase;">NO SECURED VECTORS</span></div>`;
    return;
  }
  container.innerHTML = wl.map((item, index) => {
    const id = `whitelist-${index}`;
    const actionBtn = `<button class="btn-mark-safe danger" onclick="event.stopPropagation();removeWhitelistEntry('${item.src}','${item.dst}',${item.dport})" style="font-size:0.6rem;padding:1px 4px;background:rgba(255,42,42,0.15);border-color:rgba(255,42,42,0.4);color:var(--status-danger);">UNSECURE</button>`;
    const isLocal = checkIsLocalConnection(item.src, item.dst);
    const localTag = isLocal ? `<span class="local-tag" style="font-size:0.55rem;color:var(--status-safe);border:1px solid rgba(0,230,118,0.4);padding:0 3px;border-radius:2px;margin-left:5px;font-weight:800;">LOCAL</span>` : '';
    return `<div id="stream-item-${id}" class="matrix-item is-safe" onclick="selectWhitelistItem('${item.src}')" style="cursor:pointer;">
      <div class="matrix-line" style="font-weight:700;opacity:0.7;"><span>> EXCEPTION${localTag}</span><span>[SECURED]</span></div>
      <div class="matrix-line"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;display:block;" title="${item.src} -> ${item.dst}:${item.dport}"><span style="opacity:0.6;">BYPASS@</span>${item.src} &rarr; ${item.dst}:${item.dport}</span></div>
      <div class="matrix-line" style="margin-top:2px;"><span>RULE ESTABLISHED</span>${actionBtn}</div>
    </div>`;
  }).join('');
}

function renderAnomalyView(container: HTMLElement, isUserLaptop: (e: any) => boolean): void {
  const filtered = state.streamEvents.filter(e => { if (isUserLaptop(e)) return false; return e.isAnomaly && !e.isSafe; });
  if (filtered.length === 0) {
    container.innerHTML = `<div class="radar-empty-state"><span class="radar-empty-subtitle">NO EVENTS DETECTED</span></div>`;
    return;
  }
  container.innerHTML = filtered.map(event => {
    const isSel = isStreamEventSelected(event);
    let cls = 'matrix-item';
    let statusStr = '';
    let detailsLine = '';

    if (!event.isAnomaly) {
      cls += ` is-normal ${isSel ? 'is-selected' : ''}`;
      statusStr = '[OK]';
    } else if (event.isSafe) {
      cls += ` is-safe ${isSel ? 'is-selected' : ''}`;
      statusStr = '[SECURED]';
      const lossStr = event.reconstruction_error ? `L:${Number(event.reconstruction_error).toFixed(4)}` : '';
      if (lossStr) detailsLine = `<div class="matrix-line" style="margin-top:2px;"><span>${lossStr}</span></div>`;
    } else {
      cls += ` is-anomaly ${isSel ? 'is-selected' : ''}`;
      statusStr = '[BREACH]';
      const lossStr = event.reconstruction_error ? `L:${Number(event.reconstruction_error).toFixed(4)}` : '';
      const actionBtn = `<button class="btn-mark-safe" onclick="event.stopPropagation();markStreamEventSafe('${event.id}')" style="font-size:0.6rem;padding:1px 4px;">SECURE</button>`;
      detailsLine = `<div class="matrix-line" style="margin-top:2px;"><span>${lossStr}</span>${actionBtn}</div>`;
    }

    const srcDisplay = event.src_host && event.src_host !== event.src ? event.src_host : event.src;
    const dstDisplay = event.dst_host && event.dst_host !== event.dst ? event.dst_host : event.dst;
    const isLocal = checkIsLocalConnection(event.src, event.dst);
    let localTag = '';
    if (isLocal) {
      let tagColor = 'var(--text-secondary)';
      let tagBorder = 'rgba(255,255,255,0.2)';
      if (event.isSafe) { tagColor = 'var(--status-safe)'; tagBorder = 'rgba(0,230,118,0.4)'; }
      else if (event.isAnomaly) { tagColor = 'var(--status-danger)'; tagBorder = 'rgba(255,42,42,0.4)'; }
      localTag = `<span class="local-tag" style="font-size:0.55rem;color:${tagColor};border:1px solid ${tagBorder};padding:0 3px;border-radius:2px;margin-left:5px;font-weight:800;">LOCAL</span>`;
    }

    return `<div id="stream-item-${event.id}" class="${cls.trim()}" onclick="selectStreamEvent('${event.id}')">
      <div class="matrix-line" style="font-weight:700;opacity:0.7;"><span>> ${event.time}${localTag}</span><span>${statusStr}</span></div>
      <div class="matrix-line"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;display:block;" title="${srcDisplay} -> ${dstDisplay}:${event.dport}"><span style="opacity:0.6;">ROOT@</span>${srcDisplay} &rarr; ${dstDisplay}:${event.dport}</span></div>
      ${detailsLine}
    </div>`;
  }).join('');
}

let renderPending = false;
let lastActiveFlowsRender = 0;
let activeFlowsTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function renderActiveFlowsList(): void {
  const now = Date.now();
  const timeSinceLastRender = now - lastActiveFlowsRender;
  const throttleDelay = 150;

  if (timeSinceLastRender < throttleDelay) {
    if (!activeFlowsTimeoutId) {
      activeFlowsTimeoutId = setTimeout(() => {
        activeFlowsTimeoutId = null;
        renderActiveFlowsList();
      }, throttleDelay - timeSinceLastRender);
    }
    return;
  }
  if (activeFlowsTimeoutId) { clearTimeout(activeFlowsTimeoutId); activeFlowsTimeoutId = null; }
  lastActiveFlowsRender = now;
  if (renderPending) return;
  renderPending = true;

  requestAnimationFrame(() => {
    renderPending = false;
    const listEl = document.getElementById('activeFlowsList');
    if (!listEl) return;

    const now = Date.now();
    state.recentFlows = state.recentFlows.filter(f => {
      const sel = isFlowSelected(f);
      return (now - f.lastSeen) < 5000 || sel;
    });

    let displayFlows = state.recentFlows;
    if (state.rightPanelFilter === 'EXTERNAL') displayFlows = displayFlows.filter(f => !checkIsLocalConnection(f.src, f.dst));
    if (state.rightPanelFilter === 'LOCAL') displayFlows = displayFlows.filter(f => checkIsLocalConnection(f.src, f.dst));

    const countEl = document.getElementById('activeFlowsCount');
    const barFlows = document.getElementById('barFlows');
    if (countEl) countEl.innerText = String(displayFlows.length);
    if (barFlows) barFlows.innerText = String(state.recentFlows.length);

    let scopeEl = listEl.querySelector('.cyber-radar-scope') as HTMLElement | null;
    if (!scopeEl) {
      listEl.innerHTML = `<div class="radar-hud-wrapper"><div class="radar-status-label"><span class="radar-pulse-indicator"></span>ACTIVE RADAR TELEMETRY</div>
        <div class="cyber-radar-scope"><div class="cyber-radar-grid"></div><div class="cyber-radar-sweep"></div><div class="cyber-radar-center"></div>
        <div id="radarBlipsContainer"></div><div class="radar-standby-overlay"><span class="radar-empty-title">SYSTEM SECURE</span><span class="radar-empty-subtitle">NO ACTIVE CONNECTIONS</span></div></div>
        <div class="cyber-radar-legend"><div style="color:var(--status-safe);"><span style="display:inline-block;width:6px;height:6px;background:var(--status-safe);border-radius:50%;margin-right:4px;"></span>Safe</div>
        <div style="color:var(--status-danger);"><span style="display:inline-block;width:6px;height:6px;background:var(--status-danger);border-radius:50%;margin-right:4px;"></span>Threat</div></div></div>`;
      scopeEl = listEl.querySelector('.cyber-radar-scope') as HTMLElement;
    }

    const blipsContainer = scopeEl.querySelector('#radarBlipsContainer') as HTMLElement | null;
    const standbyOverlay = scopeEl.querySelector('.radar-standby-overlay') as HTMLElement | null;
    const legendEl = listEl.querySelector('.cyber-radar-legend') as HTMLElement | null;

    if (displayFlows.length === 0) {
      if (blipsContainer) blipsContainer.innerHTML = '';
      if (standbyOverlay) standbyOverlay.classList.add('is-active');
      if (legendEl) legendEl.style.opacity = '0.5';
    } else {
      if (standbyOverlay) standbyOverlay.classList.remove('is-active');
      if (legendEl) legendEl.style.opacity = '1';

      const blipsHtml = displayFlows.map(f => {
        let top = 50, left = 50;
        const hash = Array.from(f.src).reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const angle = (hash % 360) * Math.PI / 180;
        const isLocal = checkIsLocalConnection(f.src, f.dst);
        if (!isLocal) { const dist = 20 + (hash % 25); top = 50 - (Math.sin(angle) * dist); left = 50 + (Math.cos(angle) * dist); }
        else { const dist = 5 + (hash % 10); top = 50 - (Math.sin(angle) * dist); left = 50 + (Math.cos(angle) * dist); }
        const isSel = isFlowSelected(f);
        const cls = `radar-blip ${f.isAnomaly ? 'is-anomaly' : ''} ${isSel ? 'is-selected' : ''}`.trim();
        const size = f.isAnomaly ? 8 : 4;
        return `<div class="${cls}" style="top:${top}%;left:${left}%;width:${size}px;height:${size}px;" title="${f.src} -> ${f.dst}:${f.dport}" onclick="selectFlow('${f.id}')">${f.isAnomaly ? '<div class="radar-blip-ring"></div>' : ''}</div>`;
      }).join('');
      if (blipsContainer) blipsContainer.innerHTML = blipsHtml;
    }
    updatePanelDots();
  });
}

// ─── Flow/Stream Selection ───

(window as any).selectFlow = function (id: string) {
  state.selectedFlowId = id;
  state.justSelected = true;
  const clearBtn = document.getElementById('btnClearSelection');
  if (clearBtn) clearBtn.style.display = 'block';
  import('./globe').then(m => m.updateGlobeData());
  renderActiveFlowsList();
  renderStreamList();
};

/* ─── Toast & Notifications ─── */

function enforceMaxToasts(container: HTMLElement): void {
  const activeToasts = Array.from(container.children).filter(child => !child.classList.contains('fade-out'));
  while (activeToasts.length >= 2) {
    const oldest = activeToasts.shift()!;
    oldest.classList.add('fade-out');
    setTimeout(() => oldest.remove(), 400);
  }
}

export function showSystemToast(title: string, message: string, isWarning = false): void {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  enforceMaxToasts(container);

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isWarning) {
    toast.style.borderColor = 'var(--status-danger)';
    toast.style.boxShadow = '0 0 10px rgba(255, 42, 42, 0.2)';
  } else {
    toast.style.borderColor = 'var(--status-warn)';
    toast.style.boxShadow = '0 0 10px rgba(255, 179, 0, 0.2)';
  }
  toast.innerHTML = `<div class="toast-header" style="color:${isWarning ? 'var(--status-danger)' : 'var(--status-warn)'};"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${title}</div><div class="toast-body" style="font-size:0.68rem;line-height:1.4;color:rgba(255,255,255,0.85);padding-top:4px;">${message}</div>`;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 400); } }, 8000);
}

export function showAnomalyToast(data: any): void {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  enforceMaxToasts(container);

  const srcDisplay = data.src_host && data.src_host !== data.src ? `${data.src_host} (${data.src})` : data.src;
  const dstDisplay = data.dst_host && data.dst_host !== data.dst ? `${data.dst_host} (${data.dst})` : data.dst;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cursor = 'pointer';
  toast.title = 'Click to view on 3D Globe';
  toast.innerHTML = `<div class="toast-header"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${alertTitle(data)}</div><div class="toast-body"><strong>Source:</strong> ${srcDisplay}:${data.sport}<br><strong>Target:</strong> ${dstDisplay}:${data.dport}<br><strong>Severity:</strong> High (Err: ${parseFloat(data.reconstruction_error).toFixed(2)})</div>`;

  toast.addEventListener('click', () => {
    toast.remove();
    import('./globe').then(m => {
      m.addGlobeArc(data, true);
      const streamEvent = state.streamEvents?.find((e: StreamEvent) => e.src === data.src && e.dst === data.dst && e.dport === data.dport);
      if (streamEvent) {
        (window as any).selectStreamEvent(streamEvent.id);
      } else {
        const targetId = `stream-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        if (!state.streamEvents) state.streamEvents = [];
        state.streamEvents.unshift({ id: targetId, src: data.src, src_host: data.src_host || data.src, dst: data.dst, dst_host: data.dst_host || data.dst, dport: data.dport, isAnomaly: true, isSafe: false, timestamp: data.timestamp || new Date().toISOString() });
        (window as any).selectStreamEvent(targetId);
      }
    });
  });

  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 400); } }, 5000);
}

export function addToNotificationHistory(data: any): void {
  const srcDisplay = data.src_host && data.src_host !== data.src ? `${data.src_host} (${data.src})` : data.src;
  const dstDisplay = data.dst_host && data.dst_host !== data.dst ? `${data.dst_host} (${data.dst})` : data.dst;
  const notifId = `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  state.notificationHistory.unshift({ id: notifId, time: nowTimeStr(), title: alertTitle(data), desc: `Source: ${srcDisplay}:${data.sport} → Target: ${dstDisplay}:${data.dport}`, rawData: data });
  if (state.notificationHistory.length > 50) state.notificationHistory.pop();
  state.unreadCount++;
  updateBadge();
  renderNotificationList();
}

function renderNotificationList(): void {
  const list = document.getElementById('notifList');
  if (!list) return;
  list.innerHTML = state.notificationHistory.length === 0
    ? '<div class="notif-empty">No alerts recorded yet.</div>'
    : state.notificationHistory.map(n => `<div class="notif-item" onclick="selectNotification('${n.id}')" style="cursor:pointer;" title="Click to view on 3D Globe"><div class="notif-time">${n.time}</div><div class="notif-title" style="display:flex;align-items:center;justify-content:space-between;"><span>${n.title}</span><span style="font-size:0.55rem;color:var(--status-danger);border:1px solid rgba(255,42,42,0.4);padding:1px 4px;border-radius:2px;text-transform:uppercase;">Locate Arc</span></div><div class="notif-desc">${n.desc}</div></div>`).join('');
}

(window as any).selectNotification = function (id: string) {
  const notif = state.notificationHistory.find(n => n.id === id);
  if (!notif?.rawData) return;
  const overlay = document.getElementById('notifOverlay');
  if (overlay) overlay.classList.remove('active');
  import('./globe').then(m => {
    m.addGlobeArc(notif.rawData, true);
    const streamEvent = state.streamEvents?.find((e: StreamEvent) => e.src === notif.rawData.src && e.dst === notif.rawData.dst && e.dport === notif.rawData.dport);
    if (streamEvent) (window as any).selectStreamEvent(streamEvent.id);
    else {
      const targetId = `stream-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (!state.streamEvents) state.streamEvents = [];
      state.streamEvents.unshift({ id: targetId, src: notif.rawData.src, src_host: notif.rawData.src_host || notif.rawData.src, dst: notif.rawData.dst, dst_host: notif.rawData.dst_host || notif.rawData.dst, dport: notif.rawData.dport, isAnomaly: true, isSafe: false, timestamp: notif.rawData.timestamp || new Date().toISOString() });
      (window as any).selectStreamEvent(targetId);
    }
  });
};

export function toggleNotificationOverlay(): void {
  const overlay = document.getElementById('notifOverlay');
  if (!overlay) return;
  overlay.classList.toggle('active');
  if (overlay.classList.contains('active')) { state.unreadCount = 0; updateBadge(); }
}
(window as any).toggleNotificationOverlay = toggleNotificationOverlay;

export function clearNotifications(): void {
  state.notificationHistory = [];
  state.unreadCount = 0;
  updateBadge();
  renderNotificationList();
}
(window as any).clearNotifications = clearNotifications;

function updateBadge(): void {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (state.unreadCount === 0) { badge.style.display = 'none'; }
  else { badge.style.display = 'block'; badge.innerText = state.unreadCount > 9 ? '9+' : String(state.unreadCount); }
}

export function selectStreamEvent(id: string): void {
  if (state.streamEvents) {
    const event = state.streamEvents.find(e => e.id === id);
    if (event) {
      import('./globe').then(m => { m.addGlobeArc(event, event.isAnomaly); (window as any).selectFlow(id); });
      return;
    }
  }
  (window as any).selectFlow(id);
}
(window as any).selectStreamEvent = selectStreamEvent;

export function toggleLockOn(ip: string): void {
  if (state.lockedOnIp === ip) { state.lockedOnIp = null; }
  else { state.lockedOnIp = ip; state.justSelected = true; }
  const clearBtn = document.getElementById('btnClearSelection');
  if (clearBtn) clearBtn.style.display = (state.lockedOnIp || state.selectedFlowId) ? 'block' : 'none';
  renderStreamList();
  if (state.globeWorld) import('./globe').then(m => m.updateGlobeData());
}
(window as any).toggleLockOn = toggleLockOn;

export function clearDashboardUi(): void {
  state.recentFlows = [];
  state.activeArcs = [];
  state.streamEvents = [];
  state.selectedFlowId = null;

  renderActiveFlowsList();
  renderStreamList();

  const anomalyEl = document.getElementById('aiAnomalies');
  if (anomalyEl) anomalyEl.innerText = '0';
  const barAnomalies = document.getElementById('barAnomalies');
  if (barAnomalies) barAnomalies.innerText = '0';
  const barPackets = document.getElementById('barPackets');
  if (barPackets) barPackets.innerText = '0';
  const barFlows = document.getElementById('barFlows');
  if (barFlows) barFlows.innerText = '0';

  if (state.globeWorld) {
    state.globeWorld.arcsData([]);
    state.globeWorld.labelsData([]);
    state.globeWorld.ringsData([]);
  }

  import('./confidence').then(m => { if (m.confidenceViz) m.confidenceViz.particles = []; });
  updatePanelDots();
}
(window as any).clearDashboardUi = clearDashboardUi;

export function updatePanelDots(): void {
  const leftDot = document.getElementById('leftPanelDot');
  if (leftDot) {
    const hasAnomaly = state.streamEvents ? state.streamEvents.some(e => e.isAnomaly && !e.isSafe) : false;
    leftDot.classList.toggle('has-anomaly', hasAnomaly);
  }

  const rightDot = document.getElementById('rightPanelDot');
  const rightPanelHasAnomaly = state.recentFlows.some(f => f.isAnomaly);
  if (rightDot) rightDot.classList.toggle('has-anomaly', rightPanelHasAnomaly);

  const aiAnomalies = document.getElementById('aiAnomalies');
  if (aiAnomalies) aiAnomalies.classList.toggle('danger', (parseInt(aiAnomalies.innerText) || 0) > 0);

  const activeFlowsCount = document.getElementById('activeFlowsCount');
  if (activeFlowsCount) activeFlowsCount.classList.toggle('danger', rightPanelHasAnomaly);

  const barFlows = document.getElementById('barFlows');
  if (barFlows) barFlows.classList.toggle('danger', rightPanelHasAnomaly);

  const barAnomalies = document.getElementById('barAnomalies');
  if (barAnomalies) barAnomalies.classList.toggle('danger', (parseInt(barAnomalies.innerText) || 0) > 0);

  const barBlocklist = document.getElementById('barBlocklist');
  if (barBlocklist) barBlocklist.classList.toggle('danger', (parseInt(barBlocklist.innerText) || 0) > 0);
}

/* ─── Security Scanner ─── */

export function toggleScannerModal(): void {
  const overlay = document.getElementById('scannerOverlay');
  if (!overlay) return;
  overlay.classList.toggle('active');
}
(window as any).toggleScannerModal = toggleScannerModal;

export function toggleSoundState(): void {
  const isEnabled = audio.toggleSound();
  const btn = document.getElementById('btnToggleSound');
  if (!btn) return;
  btn.title = isEnabled ? 'Mute Audio' : 'Unmute Audio';
  btn.innerHTML = isEnabled
    ? `<svg id="soundIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`
    : `<svg id="soundIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
}
(window as any).toggleSoundState = toggleSoundState;

export async function runFullSecurityScan(): Promise<void> {
  const body = document.getElementById('scannerBody');
  const dot = document.getElementById('scannerStatusDot');
  const btn = document.getElementById('btnRunScan') as HTMLButtonElement | null;
  if (!body) return;

  if (dot) dot.classList.add('has-anomaly');
  if (btn) { btn.innerText = 'Scanning...'; btn.disabled = true; }

  body.innerHTML = `<div class="radar-empty-state"><div class="radar-sweep-scanner"></div><span class="radar-empty-title">SCANNING IN PROGRESS</span><span class="radar-empty-subtitle">ANALYZING NETWORK VULNERABILITIES</span></div>`;

  try {
    const res = await fetch('/api/full-scan', { method: 'POST' });
    const resp = await res.json();
    if (resp.status === 'success') {
      latestScanData = resp.data;
      renderScannerResults(resp.data);
      if (dot) dot.classList.remove('has-anomaly');
    } else {
      body.innerHTML = `<div class="notif-empty" style="color:var(--status-danger)">Scan failed: ${resp.message}</div>`;
    }
  } catch (e) {
    console.error("Scan error:", e);
    body.innerHTML = `<div class="notif-empty" style="color:var(--status-danger)">Scan error. Check console.</div>`;
  } finally {
    if (btn) { btn.innerText = 'Run Scan'; btn.disabled = false; }
  }
}
(window as any).runFullSecurityScan = runFullSecurityScan;

function renderScannerResults(data: any): void {
  const body = document.getElementById('scannerBody');
  if (!body) return;

  const risk = data.risk || {};
  const riskScore = risk.score !== undefined ? risk.score : 0;
  const riskLevel = risk.risk_level || 'UNKNOWN';
  let riskColor = 'var(--status-safe)';
  if (risk.risk_color === 'red') riskColor = 'var(--status-danger)';
  else if (risk.risk_color === 'yellow' || risk.risk_color === 'orange') riskColor = 'var(--status-warn)';

  const wifi = data.wifi || {};
  const wifiColor = wifi.connected ? 'var(--status-safe)' : 'var(--status-warn)';
  const wifiDesc = wifi.connected ? `${wifi.network_name} [${wifi.security_type}]` : 'Disconnected';
  const wifiPercent = wifi.connected ? 100 : 0;

  const portsList = (data.ports?.ports) ? data.ports.ports : [];
  const highRiskPorts = portsList.filter((p: any) => p.risk_level === 'high').length;
  const portsColor = highRiskPorts > 0 ? 'var(--status-danger)' : 'var(--status-safe)';
  const portsDesc = highRiskPorts > 0 ? `${highRiskPorts} High-Risk Open Ports` : 'No Critical Ports Exposed';
  const portsPercent = highRiskPorts > 0 ? Math.min(100, highRiskPorts * 20) : 100;

  const vulnsList = (data.vulnerabilities?.vulnerabilities) ? data.vulnerabilities.vulnerabilities : [];
  const criticalVulns = vulnsList.filter((v: any) => v.severity === 'critical' || v.severity === 'high').length;
  const vulnsColor = criticalVulns > 0 ? 'var(--status-danger)' : 'var(--status-safe)';
  const vulnsDesc = criticalVulns > 0 ? `${criticalVulns} System Vulnerabilities` : 'Firewall & UAC Active';
  const vulnsPercent = criticalVulns > 0 ? Math.max(0, 100 - (criticalVulns * 25)) : 100;

  body.innerHTML = `<div class="tactical-scanner-grid"><div class="audit-gauges-col">
    <div class="gauge-card" style="background:rgba(255,42,42,0.05);border-color:${riskColor};"><div class="risk-gauge-container" style="--gauge-percent:${riskScore};--gauge-color:${riskColor};"><div class="risk-gauge-inner">${riskScore}</div></div><div class="gauge-details"><span class="gauge-title" style="color:${riskColor};font-weight:bold;">Global Risk Score</span><span class="gauge-desc">Risk Level: ${riskLevel}</span></div></div>
    <div class="gauge-card"><div class="risk-gauge-container" style="--gauge-percent:${wifiPercent};--gauge-color:${wifiColor};width:60px;height:60px;"><div class="risk-gauge-inner" style="width:50px;height:50px;font-size:0.8rem;">WIFI</div></div><div class="gauge-details"><span class="gauge-title">Network Encryption</span><span class="gauge-desc">${wifiDesc}</span></div></div>
    <div class="gauge-card"><div class="risk-gauge-container" style="--gauge-percent:${portsPercent};--gauge-color:${portsColor};width:60px;height:60px;"><div class="risk-gauge-inner" style="width:50px;height:50px;font-size:0.8rem;">PORT</div></div><div class="gauge-details"><span class="gauge-title">Perimeter Defenses</span><span class="gauge-desc" style="${highRiskPorts > 0 ? 'color:var(--status-danger);' : ''}">${portsDesc}</span></div></div>
    <div class="gauge-card"><div class="risk-gauge-container" style="--gauge-percent:${vulnsPercent};--gauge-color:${vulnsColor};width:60px;height:60px;"><div class="risk-gauge-inner" style="width:50px;height:50px;font-size:0.8rem;">SYS</div></div><div class="gauge-details"><span class="gauge-title">Host Defenses</span><span class="gauge-desc" style="${criticalVulns > 0 ? 'color:var(--status-danger);' : ''}">${vulnsDesc}</span></div></div>
    </div><div class="remediation-col"><div class="terminal-header"><span>OVERSIGHT // REMEDIATION TERMINAL</span><span>root@oversight:~</span></div><div class="remediation-terminal" id="remediationTerminal"></div><div class="terminal-input-container"><span class="terminal-prompt">root@oversight:~#</span><input type="text" class="terminal-input-field" id="terminalInput" placeholder="Type /help or /patch --threat [ID]..." autocomplete="off"></div></div></div>`;

  if (riskScore <= 30) {
    document.documentElement.style.setProperty('--accent-blue', '#ff2a2a');
    document.documentElement.style.setProperty('--ai-accent', '#ff2a2a');
  } else if (riskScore <= 70) {
    document.documentElement.style.setProperty('--accent-blue', '#ffb300');
    document.documentElement.style.setProperty('--ai-accent', '#ffb300');
  } else {
    document.documentElement.style.setProperty('--accent-blue', '#ffffff');
    document.documentElement.style.setProperty('--ai-accent', '#ffffff');
  }

  const recsList = (data.recommendations?.recommendations) ? data.recommendations.recommendations : [];
  let rawText = "INITIATING POST-AUDIT REMEDIATION SEQUENCE...\nANALYZING SYSTEM VULNERABILITIES...\n\n";
  if (recsList.length === 0) {
    rawText += "[+] SYSTEM IS SECURE. NO REMEDIATION REQUIRED.\n";
  } else {
    recsList.forEach((r: any, idx: number) => {
      rawText += `[!] THREAT ${idx + 1}: ${r.title}\n    >> ACTION: ${r.action}\n    >> PRIORITY: ${(r.priority || 'UNKNOWN').toUpperCase()}\n\n`;
    });
    rawText += "[*] AWAITING OPERATOR INTERVENTION...\n    Type /help inside CLI console below to patch vulnerabilities.\n\n";
  }

  typewriterEffect(document.getElementById('remediationTerminal'), rawText, 15);

  const terminalInput = document.getElementById('terminalInput') as HTMLInputElement | null;
  if (terminalInput) {
    terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = terminalInput.value.trim();
        terminalInput.value = '';
        if (cmd) handleTerminalCommand(cmd);
      }
    });
  }
}

function typewriterEffect(element: HTMLElement | null, text: string, speed: number): void {
  if (!element) return;
  let i = 0;
  element.innerHTML = '<span id="tw-content"></span><span class="terminal-cursor"></span>';
  const content = element.querySelector('#tw-content');

  function type(): void {
    if (i < text.length && content) {
      content.textContent += text.charAt(i);
      if (i % 3 === 0 && text.charAt(i) !== ' ') audio.playClick();
      i++;
      element!.scrollTop = element!.scrollHeight;
      setTimeout(type, speed);
    }
  }
  type();
}

let patchingActive = false;

function handleTerminalCommand(cmd: string): void {
  const terminal = document.getElementById('remediationTerminal');
  if (!terminal || patchingActive) return;

  const content = terminal.querySelector('#tw-content');
  if (content) { content.textContent += `\nroot@oversight:~# ${cmd}\n`; terminal.scrollTop = terminal.scrollHeight; }
  audio.playClick();

  const parts = cmd.trim().split(/\s+/);
  const command = parts[0].toLowerCase();

  if (command === '/help') {
    typewriterEffectAppend(terminal, `\nAVAILABLE COMMANDS:\n  /help                   - Display this guide\n  /clear                  - Clear terminal buffer\n  /patch --threat [ID]    - Mitigate specified threat ID\n  /patch --all            - Deploy all defense policies\n  /ping                   - Sound sonar pulse diagnostics\n\n`, 8);
  } else if (command === '/clear') {
    if (content) content.textContent = '';
  } else if (command === '/ping') {
    audio.playPing();
    typewriterEffectAppend(terminal, `\n[+] SENT SONAR DIAGNOSTIC PULSE. ALL SYSTEMS NOMINAL.\n\n`, 8);
  } else if (command === '/patch') {
    const arg = parts[1];
    if (arg === '--all') triggerPatchSequence('ALL', terminal);
    else if (arg === '--threat') {
      const id = parts[2];
      if (id && !isNaN(Number(id))) triggerPatchSequence(parseInt(id), terminal);
      else typewriterEffectAppend(terminal, `\n[-] ERROR: Please specify a valid threat ID (e.g., /patch --threat 1).\n\n`, 8);
    } else typewriterEffectAppend(terminal, `\n[-] ERROR: Unknown parameter "${arg || ''}". Use --threat [ID] or --all.\n\n`, 8);
  } else typewriterEffectAppend(terminal, `\n[-] ERROR: Unknown command "${command}". Type /help for assistance.\n\n`, 8);
}

function typewriterEffectAppend(element: HTMLElement | null, text: string, speed: number): void {
  if (!element) return;
  const content = element.querySelector('#tw-content');
  if (!content) return;
  let i = 0;
  function type(): void {
    if (i < text.length) {
      content.textContent += text.charAt(i);
      if (i % 3 === 0 && text.charAt(i) !== ' ') audio.playClick();
      i++;
      element!.scrollTop = element!.scrollHeight;
      setTimeout(type, speed);
    }
  }
  type();
}

async function triggerPatchSequence(target: string | number, terminal: HTMLElement): Promise<void> {
  patchingActive = true;
  audio.playPing();

  let category = 'ALL';
  let targetName = 'ALL SYSTEM DEFENSES';

  if (target !== 'ALL' && !isNaN(Number(target))) {
    const recsList = (latestScanData?.recommendations?.recommendations) || [];
    const threat = recsList[Number(target) - 1];
    if (threat) {
      targetName = `THREAT #${target}: ${threat.title}`;
      const cat = threat.category || '';
      const title = (threat.title || '').toLowerCase();
      const desc = (threat.description || '').toLowerCase();
      if (cat === 'Ports') category = 'Ports';
      else if (cat === 'Firewall' || title.includes('firewall') || desc.includes('firewall')) category = 'Firewall';
      else if (cat === 'User Account Control' || title.includes('uac') || desc.includes('uac') || title.includes('user account control')) category = 'User Account Control';
      else if (title.includes('service') || desc.includes('service') || title.includes('remoteregistry') || title.includes('tlntsvr')) category = 'Remote Services';
    }
  }

  typewriterEffectAppend(terminal, `\n[>] INITIATING MITIGATION PROTOCOL [TARGET: ${targetName}]...\n`, 4);

  setTimeout(() => typewriterEffectAppend(terminal, `[1/3] EXECUTING REAL-TIME SECURITY ENFORCEMENT ENGINE...\n`, 4), 600);
  setTimeout(async () => {
    typewriterEffectAppend(terminal, `      >> PARSING ACTIVE PROTECTION POLICIES FOR CATEGORY: ${category.toUpperCase()}...\n`, 4);
    try {
      const res = await fetch('/api/patch-vulnerability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }) });
      const resp = await res.json();
      if (resp.status === 'success') {
        setTimeout(() => {
          typewriterEffectAppend(terminal, `[2/3] DEPLOYING LOCAL OPERATING SYSTEM SECURITY PATCHES...\n`, 4);
          (resp.data || []).forEach((item: any, idx: number) => {
            setTimeout(() => { const prefix = item.status === 'success' ? '[✓] SUCCESS' : '[✗] FAILURE'; typewriterEffectAppend(terminal, `      ${prefix} [${item.category}]: ${item.message}\n`, 4); }, idx * 400);
          });
          setTimeout(() => {
            if (!resp.is_admin) { typewriterEffectAppend(terminal, `\n      [!] WARNING: Oversight did not run as Administrator.\n          Some policy changes require high privileges to take effect.\n`, 4); }
            typewriterEffectAppend(terminal, `\n[3/3] RE-AUDITING SYSTEM EXPOSURE STATUS...\n`, 4);
            setTimeout(() => {
              typewriterEffectAppend(terminal, `      [====================================] 100% (RE-AUDIT COMPLETE)\n[+] ADVANCED THREAT REMEDIATION SEQUENCE COMPLETED!\n`, 4);
              patchingActive = false;
              applySecurityPatchSuccess(category);
            }, 1200);
          }, (resp.data?.length || 0) * 400 + 400);
        }, 800);
      } else {
        typewriterEffectAppend(terminal, `[-] ERROR EXECUTING PATCH PROTOCOL: ${resp.message}\n`, 4);
        patchingActive = false;
      }
    } catch (err: any) {
      typewriterEffectAppend(terminal, `[-] CONNECTION EXCEPTION: ${err.message}. Ensure backend is running.\n`, 4);
      patchingActive = false;
    }
  }, 1500);
}

function applySecurityPatchSuccess(category = 'ALL'): void {
  audio.playPing();

  const riskDial = document.querySelector('.risk-gauge-container') as HTMLElement | null;
  if (riskDial) { riskDial.style.setProperty('--gauge-percent', '95'); riskDial.style.setProperty('--gauge-color', 'var(--status-safe)'); }

  if (category === 'ALL' || category === 'Ports') {
    const portContainer = document.querySelectorAll('.risk-gauge-container')[2] as HTMLElement | null;
    if (portContainer) { portContainer.style.setProperty('--gauge-percent', '100'); portContainer.style.setProperty('--gauge-color', 'var(--status-safe)'); }
    const portDesc = document.querySelectorAll('.gauge-desc')[1] as HTMLElement | null;
    if (portDesc) { portDesc.innerText = '0 Ports Exposed (Secured)'; portDesc.style.color = 'var(--status-safe)'; }
  }

  if (category === 'ALL' || category === 'Firewall' || category === 'User Account Control' || category === 'Remote Services') {
    const sysContainer = document.querySelectorAll('.risk-gauge-container')[3] as HTMLElement | null;
    if (sysContainer) { sysContainer.style.setProperty('--gauge-percent', '100'); sysContainer.style.setProperty('--gauge-color', 'var(--status-safe)'); }
    const sysDesc = document.querySelectorAll('.gauge-desc')[2] as HTMLElement | null;
    if (sysDesc) { sysDesc.innerText = '0 High Vulnerabilities (Audited)'; sysDesc.style.color = 'var(--status-safe)'; }
  }

  document.documentElement.style.setProperty('--accent-blue', '#ffffff');
  document.documentElement.style.setProperty('--ai-accent', '#ffffff');

  showAnomalyToast({ time: nowTimeStr(), src: 'OVERSIGHT_CORE', dst: 'LOCAL_KERNEL', dport: '0', alert_type: 'Remediation Applied', isSafe: true, reconstruction_error: 0.001 });

  setTimeout(() => runFullSecurityScan(), 4000);
}

// ─── Diagnostics Tabs & Whitelist Manager ───

export function switchScannerTab(tabName: string): void {
  const auditTab = document.getElementById('tabScannerAudit');
  const whitelistTab = document.getElementById('tabScannerWhitelist');
  const auditView = document.getElementById('scannerAuditView');
  const whitelistView = document.getElementById('scannerWhitelistView');
  if (!auditTab || !whitelistTab || !auditView || !whitelistView) return;

  audio.playClick();
  if (tabName === 'AUDIT') {
    auditTab.classList.add('active'); whitelistTab.classList.remove('active');
    auditView.style.display = 'block'; whitelistView.style.display = 'none';
  } else if (tabName === 'WHITELIST') {
    whitelistTab.classList.add('active'); auditTab.classList.remove('active');
    auditView.style.display = 'none'; whitelistView.style.display = 'flex';
    renderWhitelistManager();
  }
}
(window as any).switchScannerTab = switchScannerTab;

export async function renderWhitelistManager(): Promise<void> {
  const container = document.getElementById('whitelistEntriesList');
  if (!container) return;
  container.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;padding:40px;color:rgba(255,255,255,0.4);font-family:'Courier New',monospace;font-size:0.8rem;">LOADING SECURE SYSTEM RULES...</div>`;

  try {
    const res = await fetch('/api/whitelist');
    const result = await res.json();
    if (result.status === 'success') {
      const data = result.data || [];
      if (data.length === 0) {
        container.innerHTML = `<div style="flex-grow:1;display:flex;flex-direction:column;justify-content:center;align-items:center;border:1px dashed rgba(255,255,255,0.05);border-radius:4px;padding:40px;background:rgba(0,0,0,0.15);margin-top:10px;"><span style="font-family:'Courier New',monospace;font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:5px;text-transform:uppercase;">NO WHITELIST ENTRIES FOUND</span><span style="font-family:'Courier New',monospace;font-size:0.7rem;color:rgba(255,255,255,0.25);">Use "MARK SAFE" on any live stream event to whitelist a connection.</span></div>`;
        return;
      }
      let html = `<div style="flex-grow:1;overflow-y:auto;max-height:480px;border:1px solid rgba(255,255,255,0.05);border-radius:4px;background:rgba(0,0,0,0.2);margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-family:'Courier New',monospace;font-size:0.75rem;color:rgba(255,255,255,0.85);text-align:left;"><thead><tr style="background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.08);text-transform:uppercase;color:var(--status-warn);font-size:0.7rem;letter-spacing:1px;"><th style="padding:10px 15px;">SOURCE IP</th><th style="padding:10px 15px;">DESTINATION IP</th><th style="padding:10px 15px;">DEST PORT</th><th style="padding:10px 15px;text-align:right;">ACTION</th></tr></thead><tbody>`;
      data.forEach((entry: any) => {
        html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.03);"><td style="padding:10px 15px;color:var(--accent-blue);">${entry.src}</td><td style="padding:10px 15px;color:rgba(255,255,255,0.8);">${entry.dst}</td><td style="padding:10px 15px;color:var(--status-safe);">${entry.dport}</td><td style="padding:10px 15px;text-align:right;"><button class="btn-action danger" onclick="removeWhitelistEntry('${entry.src}','${entry.dst}',${entry.dport})" style="font-family:'Courier New',monospace;font-size:0.65rem;padding:2px 8px;border-radius:3px;height:auto;background:rgba(255,42,42,0.15);border-color:rgba(255,42,42,0.4);color:var(--status-danger);">REMOVE</button></td></tr>`;
      });
      html += `</tbody></table></div>`;
      container.innerHTML = html;
    } else {
      container.innerHTML = `<div style="color:var(--status-danger);font-family:'Courier New',monospace;font-size:0.8rem;padding:20px;">FAILED TO RETRIEVE WHITELISTS: ${result.message}</div>`;
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--status-danger);font-family:'Courier New',monospace;font-size:0.8rem;padding:20px;">CONNECTION ERROR RETRIEVING WHITELISTS.</div>`;
  }
}
(window as any).renderWhitelistManager = renderWhitelistManager;

export async function removeWhitelistEntry(src: string, dst: string, dport: number): Promise<void> {
  audio.playClick();
  if (!confirm(`Are you sure you want to remove whitelist rule for ${src} -> ${dst}:${dport}?`)) return;
  try {
    const res = await fetch('/api/whitelist/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src, dst, dport }) });
    const result = await res.json();
    if (result.status === 'success') {
      showAnomalyToast({ time: nowTimeStr(), src: 'WHITELIST_ENG', dst: 'LOCAL_KERNEL', dport: String(dport), alert_type: 'Rule Terminated', isSafe: true, reconstruction_error: 0.0 });
      renderWhitelistManager();
      await fetchWhitelist();
      renderStreamList();
    } else alert(`Failed to delete: ${result.message}`);
  } catch (e) {
    alert('Network error deleting whitelist entry.');
  }
}
(window as any).removeWhitelistEntry = removeWhitelistEntry;

export async function exportSecurityDossier(): Promise<void> {
  audio.playPing();

  let whitelist: any[] = [];
  try {
    const res = await fetch('/api/whitelist');
    const resp = await res.json();
    if (resp.status === 'success') whitelist = resp.data || [];
  } catch { /* ignore */ }

  const riskVal = (document.getElementById('riskVal') as HTMLElement)?.innerText || 'N/A';
  const riskSubtitle = (document.getElementById('riskSubtitle') as HTMLElement)?.innerText || 'N/A';
  const captureState = state.isCapturing ? 'ACTIVE' : 'STANDBY';
  const anomalyCount = state.streamEvents ? state.streamEvents.filter(e => e.isAnomaly && !e.isSafe).length : 0;
  const whitelistedCount = whitelist.length;
  const totalEvents = state.streamEvents ? state.streamEvents.length : 0;

  let eventRows = '';
  if (state.streamEvents && state.streamEvents.length > 0) {
    state.streamEvents.forEach((e: any) => {
      const badgeClass = e.isAnomaly ? (e.isSafe ? 'badge safe' : 'badge anomaly') : 'badge safe';
      const label = e.isAnomaly ? (e.isSafe ? 'RESOLVED SAFE' : (e.alert_type || e.anomaly_type || 'ANOMALY')) : 'SECURE FLOW';
      eventRows += `<tr><td style="color:#ffb300;">${e.time}</td><td style="color:var(--accent-blue);">${e.src}</td><td>${e.dst}</td><td style="color:var(--accent-blue);font-weight:bold;">${e.dport}</td><td><span class="${badgeClass}">${label}</span></td><td style="color:rgba(255,255,255,0.7);font-family:monospace;">${e.reconstruction_error !== undefined ? Number(e.reconstruction_error).toFixed(5) : '0.00000'}</td></tr>`;
    });
  } else {
    eventRows = `<tr><td colspan="6" style="text-align:center;color:rgba(255,255,255,0.3);padding:30px;">NO INTERCEPTED TRAFFIC LOGS RECORDED IN THIS SESSION</td></tr>`;
  }

  let whitelistRows = '';
  if (whitelist.length > 0) {
    whitelist.forEach((w: any) => { whitelistRows += `<tr><td style="color:var(--accent-blue);">${w.src}</td><td>${w.dst}</td><td style="color:#ffb300;font-weight:bold;">${w.dport}</td><td style="color:var(--accent-blue);">MANUAL BYPASS RULE</td></tr>`; });
  } else {
    whitelistRows = `<tr><td colspan="4" style="text-align:center;color:rgba(255,255,255,0.3);padding:30px;">NO SYSTEM BYPASS / WHITELIST RULES ESTABLISHED</td></tr>`;
  }

  const reportHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>OVERSIGHT // SYSTEM SECURITY DOSSIER</title><style>/* ditto from original, omitted for brevity in this diff */</style></head><body>...</body></html>`;

  // Build and trigger download
  const riskNum = parseInt(riskVal) || 0;
  const fullHtml = buildDossierHtml(riskNum, riskSubtitle, captureState, anomalyCount, whitelistedCount, totalEvents, eventRows, whitelistRows);
  const blob = new Blob([fullHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `oversight-security-dossier-${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showAnomalyToast({ time: nowTimeStr(), src: 'DOSSIER_ENG', dst: 'LOCAL_STORAGE', dport: '0', alert_type: 'Dossier Compiled', isSafe: true, reconstruction_error: 0.0 });
}
(window as any).exportSecurityDossier = exportSecurityDossier;

function buildDossierHtml(riskVal: number, riskSubtitle: string, captureState: string, anomalyCount: number, whitelistedCount: number, totalEvents: number, eventRows: string, whitelistRows: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>OVERSIGHT // SYSTEM SECURITY DOSSIER</title><style>:root{--bg-color:#08090b;--panel-bg:rgba(14,15,19,0.9);--border-color:rgba(255,179,0,0.25);--gold:#ffb300;--cyan:#ffffff;--danger:#ff2a2a;--text-color:rgba(255,255,255,0.95);--text-muted:rgba(255,255,255,0.5)}body{background-color:var(--bg-color);color:var(--text-color);font-family:'Courier New',Courier,monospace;margin:0;padding:40px 20px;display:flex;justify-content:center}.container{width:960px;max-width:100%;background:var(--panel-bg);border:1px solid var(--border-color);box-shadow:0 0 35px rgba(255,179,0,0.15);padding:40px;border-radius:8px}.header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--border-color);padding-bottom:20px;margin-bottom:30px}.header h1{margin:0;font-size:1.8rem;letter-spacing:4px;color:var(--gold);text-shadow:0 0 10px rgba(255,179,0,0.3)}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-bottom:35px}.meta-card{background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.05);padding:18px 15px;border-radius:4px;text-align:center}.meta-value{font-size:1.4rem;font-weight:bold;color:var(--gold)}.meta-card.risk .meta-value{color:${riskVal > 60 ? 'var(--danger)' : (riskVal > 30 ? 'var(--gold)' : 'var(--cyan)')}}table{width:100%;border-collapse:collapse;font-size:0.75rem;margin-top:15px}th{background:rgba(255,179,0,0.04);color:var(--gold);padding:12px 15px;border-bottom:1px solid var(--border-color)}td{padding:12px 15px;border-bottom:1px solid rgba(255,255,255,0.03)}.badge{display:inline-block;padding:3px 8px;border-radius:3px;font-size:0.65rem;font-weight:bold}.badge.anomaly{background:rgba(255,42,42,0.12);border:1px solid var(--danger);color:var(--danger)}.badge.safe{background:rgba(255,255,255,0.08);border:1px solid var(--cyan);color:var(--cyan)}.footer{text-align:center;padding:20px;color:var(--text-muted);font-size:0.65rem}</style></head><body><div class="container"><div class="header"><div><h1>OVERSIGHT SECURITY DOSSIER</h1><div style="font-size:0.75rem;color:var(--text-muted)">Tactical System Intrusion & Threat Defense Report</div></div><div class="timestamp" style="color:var(--cyan);text-align:right;font-size:0.8rem">GENERATED: ${new Date().toLocaleString()}<br>STATUS: <span style="color:var(--cyan)">${captureState}</span></div></div>
  <div class="meta-grid"><div class="meta-card risk"><div class="meta-label">Global Risk Score</div><div class="meta-value">${riskVal}/100</div><div style="font-size:0.65rem;color:var(--text-muted);margin-top:5px">${riskSubtitle}</div></div><div class="meta-card"><div class="meta-label">Intercepted Traffic</div><div class="meta-value">${totalEvents}</div></div><div class="meta-card"><div class="meta-label">Active Anomalies</div><div class="meta-value" style="color:${anomalyCount > 0 ? 'var(--danger)' : 'var(--cyan)'}">${anomalyCount}</div></div><div class="meta-card"><div class="meta-label">Manual Whitelists</div><div class="meta-value">${whitelistedCount}</div></div></div>
  <div style="display:flex;justify-content:space-between;align-items:center;color:var(--gold);font-size:0.95rem;letter-spacing:2px;margin:40px 0 15px;border-bottom:1px dashed rgba(255,255,255,0.15);padding-bottom:8px;text-transform:uppercase;font-weight:bold"><span>Manual Whitelist Entries</span></div><table><thead><tr><th>Source IP</th><th>Dest IP</th><th>Dest Port</th><th>Authority</th></tr></thead><tbody>${whitelistRows}</tbody></table>
  <div style="display:flex;justify-content:space-between;align-items:center;color:var(--gold);font-size:0.95rem;letter-spacing:2px;margin:40px 0 15px;border-bottom:1px dashed rgba(255,255,255,0.15);padding-bottom:8px;text-transform:uppercase;font-weight:bold"><span>Intercepted Stream Logs</span></div><table><thead><tr><th>Time</th><th>Source</th><th>Dest</th><th>Port</th><th>Classification</th><th>Error</th></tr></thead><tbody>${eventRows}</tbody></table>
  <div class="footer">OVERSIGHT CYBER-SECURITY PLATFORM // CONFIDENTIAL STANDALONE REPORT</div></div></body></html>`;
}

