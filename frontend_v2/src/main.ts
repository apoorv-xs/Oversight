/* ─── OVERSIGHT — Entry Point ─── */

import { state } from './state';
import { toggleAiCapture, initSocketEvents, updateBackgroundStats, handleStartCapture } from './api';
import { initGlobeViz, resizeGlobe } from './globe';
import { initHeartbeat } from './heartbeat';
import { initConfidenceCurve } from './confidence';
import { fetchWhitelist, showSystemToast, toggleLockOn } from './ui';
import { audio } from './audio';

// Import all CSS so Vite bundles them
import '../static/css/variables.css';
import '../static/css/base.css';
import '../static/css/layout.css';
import '../static/css/components.css';
import '../static/css/notifications.css';

// Expose togglePanel to window for inline onclick in index.html
(window as any).togglePanel = function (btn: HTMLElement) {
  const overlay = btn.closest('aside');
  if (!overlay) return;
  overlay.classList.toggle('collapsed');
  const svg = btn.querySelector('svg');
  if (svg) svg.style.transform = overlay.classList.contains('collapsed') ? 'rotate(180deg)' : 'rotate(0deg)';
};

function setupInteractions(): void {
  const btnToggle = document.getElementById('btnToggleCapture');
  if (btnToggle) btnToggle.addEventListener('click', toggleAiCapture);

  const statBoxAnomalies = document.getElementById('statBoxAnomalies');
  const statBoxSafe = document.getElementById('statBoxSafe');

  if (statBoxAnomalies && statBoxSafe) {
    const toggleWaterfallFilter = (mode: 'ANOMALIES' | 'SAFE') => {
      state.upperLeftFilter = mode;
      if (mode === 'ANOMALIES') {
        statBoxAnomalies.classList.add('active');
        statBoxSafe.classList.remove('active');
      } else {
        statBoxAnomalies.classList.remove('active');
        statBoxSafe.classList.add('active');
      }
      if (mode === 'SAFE') fetchWhitelist().then(() => import('./ui').then(m => m.renderStreamList()));
      else import('./ui').then(m => m.renderStreamList());
    };
    statBoxAnomalies.addEventListener('click', () => toggleWaterfallFilter('ANOMALIES'));
    statBoxSafe.addEventListener('click', () => toggleWaterfallFilter('SAFE'));
  }

  // Flow Timeout Slider
  const inputTimeout = document.getElementById('inputFlowTimeout') as HTMLInputElement | null;
  const labelTimeout = document.getElementById('labelFlowTimeout');
  if (inputTimeout && labelTimeout) {
    inputTimeout.addEventListener('input', (e) => { labelTimeout.textContent = `${(e.target as HTMLInputElement).value}s`; });
    inputTimeout.addEventListener('change', async (e) => {
      const val = (e.target as HTMLInputElement).value;
      const { updateFlowTimeout } = await import('./api');
      updateFlowTimeout(parseInt(val, 10));
    });
  }

  // Right Panel Filters
  const rightAll = document.getElementById('btnFilterRightAll');
  const rightExt = document.getElementById('btnFilterRightExternal');
  const rightLoc = document.getElementById('btnFilterRightLocal');

  if (rightAll && rightExt && rightLoc) {
    const updateRightFilter = (mode: 'ALL' | 'EXTERNAL' | 'LOCAL', btn: HTMLElement) => {
      state.rightPanelFilter = mode;
      [rightAll, rightExt, rightLoc].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      import('./ui').then(m => { m.renderActiveFlowsList(); });
    };
    rightAll.addEventListener('click', () => updateRightFilter('ALL', rightAll));
    rightExt.addEventListener('click', () => updateRightFilter('EXTERNAL', rightExt));
    rightLoc.addEventListener('click', () => updateRightFilter('LOCAL', rightLoc));
  }

  // Clear Selection
  const clearSelectionBtn = document.getElementById('btnClearSelection');
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      state.selectedFlowId = null;
      state.lockedOnIp = null;
      clearSelectionBtn.style.display = 'none';
      import('./globe').then(m => m.updateGlobeData());
      import('./ui').then(m => { m.renderActiveFlowsList(); m.renderStreamList(); });
    });
  }

  // Global click listener
  document.addEventListener('click', (e) => {
    if (!state.selectedFlowId && !state.lockedOnIp) return;
    if (state.justSelected) { state.justSelected = false; return; }

    const isInteractive = !!(e.target as HTMLElement).closest('button') ||
      !!(e.target as HTMLElement).closest('input') ||
      !!(e.target as HTMLElement).closest('a') ||
      !!(e.target as HTMLElement).closest('.matrix-item') ||
      !!(e.target as HTMLElement).closest('.radar-blip') ||
      !!(e.target as HTMLElement).closest('.stat-box') ||
      !!(e.target as HTMLElement).closest('.toast') ||
      !!(e.target as HTMLElement).closest('.notif-panel') ||
      !!(e.target as HTMLElement).closest('.scanner-modal') ||
      !!(e.target as HTMLElement).closest('.keyboard-shortcuts-content') ||
      !!(e.target as HTMLElement).closest('.panel-header') ||
      !!(e.target as HTMLElement).closest('aside') ||
      !!(e.target as HTMLElement).closest('header') ||
      !!(e.target as HTMLElement).closest('footer') ||
      !!(e.target as HTMLElement).closest('.notif-overlay') ||
      !!(e.target as HTMLElement).closest('#globeViz');

    if (!isInteractive && clearSelectionBtn && clearSelectionBtn.style.display !== 'none') clearSelectionBtn.click();
  });
}

function startHeaderClock(): void {
  const clockEl = document.getElementById('headerClock');
  if (!clockEl) return;
  function update(): void {
    const now = new Date();
    clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function setupKeyboardShortcuts(): void {
  (window as any).toggleKeyboardShortcutsModal = function () {
    const overlay = document.getElementById('keyboardShortcutsOverlay');
    if (!overlay) return;
    audio.playClick();
    overlay.classList.toggle('active');
  };

  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const key = e.key;
    if (key === ' ' || key === 'Spacebar') { e.preventDefault(); document.getElementById('btnToggleCapture')?.click(); }
    else if (key === 'c' || key === 'C') { document.getElementById('btnClearSelection')?.click(); }
    else if (key === 'a' || key === 'A') { document.getElementById('statBoxAnomalies')?.click(); }
    else if (key === 's' || key === 'S') { document.getElementById('statBoxSafe')?.click(); }
    else if (key === 'd' || key === 'D') { import('./ui').then(m => m.toggleScannerModal()); }
    else if (key === 'h' || key === 'H' || key === '?') { (window as any).toggleKeyboardShortcutsModal(); }
    else if (key === 'Escape') {
      const scannerOverlay = document.getElementById('scannerOverlay');
      if (scannerOverlay?.classList.contains('active')) import('./ui').then(m => m.toggleScannerModal());
      const shortcutsOverlay = document.getElementById('keyboardShortcutsOverlay');
      if (shortcutsOverlay?.classList.contains('active')) (window as any).toggleKeyboardShortcutsModal();
    }
  });
}

/* ─── DOM Ready ─── */

document.addEventListener('DOMContentLoaded', () => {
  // Pause CSS animations when hidden
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('page-hidden', document.hidden);
  });

  startHeaderClock();

  try { setupInteractions(); } catch (e) { console.error('Error setting up UI interactions:', e); }
  try { setupKeyboardShortcuts(); } catch (e) { console.error('Error setting up keyboard shortcuts:', e); }

  // Sync capture state
  fetch(`/api/capture-status?_=${Date.now()}`)
    .then(res => res.json())
    .then(resp => { if (resp.data?.capturing) handleStartCapture(false); })
    .catch(err => console.error('Error syncing capture status:', err));

  try { initGlobeViz(); } catch (e) { console.error('Error initializing 3D globe:', e); }
  try { initHeartbeat(); } catch (e) { console.error('Error initializing heartbeat:', e); }
  try { initConfidenceCurve(); } catch (e) { console.error('Error initializing confidence curve:', e); }

  try {
    updateBackgroundStats();
    setInterval(updateBackgroundStats, 5000);
  } catch (e) { console.error('Error starting telemetry polling loop:', e); }

  try { fetchWhitelist(); } catch (e) { console.error('Error fetching initial whitelist:', e); }

  // Geolocation
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.userLat = position.coords.latitude;
        state.userLng = position.coords.longitude;
        if (state.globeWorld) state.globeWorld.pointOfView({ lat: state.userLat, lng: state.userLng, altitude: 1.8 });
      },
      (error) => console.warn('Geolocation denied or failed. Using default fallback coordinates.', error),
    );
  }

  // Panel resize observer
  try {
    const leftPanel = document.querySelector('.left-overlay');
    const rightPanel = document.querySelector('.right-overlay');
    const updatePanelWidths = () => {
      const leftWidth = leftPanel && !leftPanel.classList.contains('collapsed') ? (leftPanel as HTMLElement).offsetWidth : 0;
      const rightWidth = rightPanel && !rightPanel.classList.contains('collapsed') ? (rightPanel as HTMLElement).offsetWidth : 0;
      document.documentElement.style.setProperty('--left-panel-width', `${leftWidth}px`);
      document.documentElement.style.setProperty('--right-panel-width', `${rightWidth}px`);
      resizeGlobe();
    };

    if (leftPanel && rightPanel) {
      const observer = new ResizeObserver(() => updatePanelWidths());
      observer.observe(leftPanel);
      observer.observe(rightPanel);
      updatePanelWidths();
      window.addEventListener('load', updatePanelWidths);
    }
  } catch (e) { console.error('Error setting up panel ResizeObserver:', e); }
});
