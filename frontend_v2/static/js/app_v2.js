import { state } from './state_v2.js';
import { toggleAiCapture, initSocketEvents, updateBackgroundStats, handleStartCapture } from './api_v2.js';
import { initGlobeViz, resizeGlobe } from './globe_v2.js';
import { initHeartbeat } from './heartbeat_v2.js';
import { initConfidenceCurve } from './confidence_v2.js';

// Expose togglePanel to window for inline onclick in index.html
window.togglePanel = function (btn) {
    const overlay = btn.closest('aside');
    overlay.classList.toggle('collapsed');
    const svg = btn.querySelector('svg');
    if (overlay.classList.contains('collapsed')) {
        svg.style.transform = 'rotate(180deg)';
    } else {
        svg.style.transform = 'rotate(0deg)';
    }
};

function setupInteractions() {
    const btnToggle = document.getElementById('btnToggleCapture');
    if (btnToggle) btnToggle.addEventListener('click', toggleAiCapture);

    // Interactive stream stats toggles (upper left section)
    const statBoxAnomalies = document.getElementById('statBoxAnomalies');
    const statBoxSafe = document.getElementById('statBoxSafe');

    if (statBoxAnomalies && statBoxSafe) {
        const toggleWaterfallFilter = (mode) => {
            state.upperLeftFilter = mode;
            if (mode === 'ANOMALIES') {
                statBoxAnomalies.classList.add('active');
                statBoxSafe.classList.remove('active');
            } else {
                statBoxAnomalies.classList.remove('active');
                statBoxSafe.classList.add('active');
            }
            import('./ui_v2.js').then(module => {
                if (mode === 'SAFE') {
                    module.fetchWhitelist().then(() => module.renderStreamList());
                } else {
                    module.renderStreamList();
                }
            });
        };

        statBoxAnomalies.addEventListener('click', () => toggleWaterfallFilter('ANOMALIES'));
        statBoxSafe.addEventListener('click', () => toggleWaterfallFilter('SAFE'));
    }



    // Flow Timeout Slider
    const inputTimeout = document.getElementById('inputFlowTimeout');
    const labelTimeout = document.getElementById('labelFlowTimeout');
    if (inputTimeout && labelTimeout) {
        inputTimeout.addEventListener('input', (e) => {
            const val = e.target.value;
            labelTimeout.textContent = `${val}s`;
        });
        inputTimeout.addEventListener('change', async (e) => {
            const val = e.target.value;
            const apiMod = await import('./api_v2.js');
            apiMod.updateFlowTimeout(parseInt(val, 10));
        });
    }

    // Right Panel Filters
    const rightAll = document.getElementById('btnFilterRightAll');
    const rightExt = document.getElementById('btnFilterRightExternal');
    const rightLoc = document.getElementById('btnFilterRightLocal');

    if (rightAll && rightExt && rightLoc) {
        const updateRightFilter = (mode, btn) => {
            state.rightPanelFilter = mode;
            [rightAll, rightExt, rightLoc].forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            import('./ui_v2.js').then(module => module.renderActiveFlowsList());
            import('./globe_v2.js').then(module => module.updateGlobeData());
        };

        rightAll.addEventListener('click', () => updateRightFilter('ALL', rightAll));
        rightExt.addEventListener('click', () => updateRightFilter('EXTERNAL', rightExt));
        rightLoc.addEventListener('click', () => updateRightFilter('LOCAL', rightLoc));
    }

    // Wire up "Clear Selection" (btnClearSelection)
    const clearSelectionBtn = document.getElementById('btnClearSelection');
    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', () => {
            state.selectedFlowId = null;
            state.lockedOnIp = null; // Also clear IP lock-on when clearing selection!
            clearSelectionBtn.style.display = 'none';
            // Panning back is handled automatically inside globe_v2.js updateGlobeData() to avoid visual glitches/jumping
            import('./globe_v2.js').then(m => m.updateGlobeData());
            import('./ui_v2.js').then(m => {
                m.renderActiveFlowsList();
                m.renderStreamList();
            });
        });
    }

    // Global click listener to deselect selected flow or lock-on IP when clicking anywhere outside of panels/UI controls
    document.addEventListener('click', (e) => {
        if (!state.selectedFlowId && !state.lockedOnIp) return;

        // If the flow/IP was just selected in this click event bubble-up, skip deselecting
        if (state.justSelected) {
            state.justSelected = false;
            return;
        }

        // Bypass clicks on control HUD elements, overlays, sliders, buttons, inputs, links, matrix items, etc.
        // Also bypass the 3D WebGL globe container (#globeViz) as it handles its own drag-checked click listener
        const isInteractive = e.target.closest('button') ||
                              e.target.closest('input') ||
                              e.target.closest('a') ||
                              e.target.closest('.matrix-item') ||
                              e.target.closest('.radar-blip') ||
                              e.target.closest('.stat-box') ||
                              e.target.closest('.toast') ||
                              e.target.closest('.notif-panel') ||
                              e.target.closest('.scanner-modal') ||
                              e.target.closest('.keyboard-shortcuts-content') ||
                              e.target.closest('.panel-header') ||
                              e.target.closest('aside') ||
                              e.target.closest('header') ||
                              e.target.closest('footer') ||
                              e.target.closest('.notif-overlay') ||
                              e.target.closest('#globeViz');

        if (!isInteractive) {
            if (clearSelectionBtn && clearSelectionBtn.style.display !== 'none') {
                clearSelectionBtn.click();
            }
        }
    });
}

function startHeaderClock() {
    const clockEl = document.getElementById('headerClock');
    if (!clockEl) return;

    function updateClock() {
        const now = new Date();
        const hrs = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const secs = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        clockEl.textContent = `${hrs}:${mins}:${secs}.${ms}`;
        requestAnimationFrame(updateClock);
    }
    requestAnimationFrame(updateClock);
}

function setupKeyboardShortcuts() {
    window.toggleKeyboardShortcutsModal = function () {
        const overlay = document.getElementById('keyboardShortcutsOverlay');
        if (!overlay) return;
        import('./audio_v2.js').then(module => module.audio.playClick());
        overlay.classList.toggle('active');
    };

    window.addEventListener('keydown', (e) => {
        // Suppress keybinds if typing in an input or textarea
        const activeTag = document.activeElement ? document.activeElement.tagName.toUpperCase() : '';
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
            return;
        }

        const key = e.key;

        // Space key: Toggle packet capture
        if (key === ' ' || key === 'Spacebar') {
            e.preventDefault(); // Prevent standard page scrolling on space
            const btnToggle = document.getElementById('btnToggleCapture');
            if (btnToggle) {
                btnToggle.click();
            }
        }
        // C/c key: Clear selection
        else if (key === 'c' || key === 'C') {
            const clearSelectionBtn = document.getElementById('btnClearSelection');
            if (clearSelectionBtn) {
                clearSelectionBtn.click();
            }
        }
        // A/a key: Filter live stream to ANOMALIES only
        else if (key === 'a' || key === 'A') {
            const btn = document.getElementById('statBoxAnomalies');
            if (btn) btn.click();
        }
        // S/s key: Filter live stream to SAFE vectors only
        else if (key === 's' || key === 'S') {
            const btn = document.getElementById('statBoxSafe');
            if (btn) btn.click();
        }
        // D/d key: Toggle diagnostics
        else if (key === 'd' || key === 'D') {
            import('./ui_v2.js').then(module => module.toggleScannerModal());
        }
        // H/h or ? key: Toggle shortcuts overlay
        else if (key === 'h' || key === 'H' || key === '?') {
            window.toggleKeyboardShortcutsModal();
        }
        // Escape key: Close any active overlays
        else if (key === 'Escape') {
            const scannerOverlay = document.getElementById('scannerOverlay');
            if (scannerOverlay && scannerOverlay.classList.contains('active')) {
                import('./ui_v2.js').then(module => module.toggleScannerModal());
            }
            const shortcutsOverlay = document.getElementById('keyboardShortcutsOverlay');
            if (shortcutsOverlay && shortcutsOverlay.classList.contains('active')) {
                window.toggleKeyboardShortcutsModal();
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Toggle page-hidden class on HTML element when visibility state changes to automatically pause all CSS animations page-wide
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            document.documentElement.classList.add('page-hidden');
        } else {
            document.documentElement.classList.remove('page-hidden');
        }
    });

    // Start live military ticking clock
    startHeaderClock();

    // Wire up UI and render globe on first load
    try {
        setupInteractions();
    } catch (e) {
        console.error('Error setting up UI interactions:', e);
    }

    try {
        setupKeyboardShortcuts();
    } catch (e) {
        console.error('Error setting up keyboard shortcuts:', e);
    }

    // Sync capture state with the backend (handles browser refresh while capture is running)
    fetch(`/api/capture-status?_=${Date.now()}`)
        .then(res => res.json())
        .then(resp => {
            if (resp.data && resp.data.capturing) {
                handleStartCapture(false); // Sync state, hum, socket, and radar sweep without wiping current UI
            }
        })
        .catch((err) => {
            console.error('Error syncing capture status:', err);
        });

    try {
        initGlobeViz();
    } catch (e) {
        console.error('Error initializing 3D globe visualization:', e);
    }
    
    try {
        initHeartbeat();
    } catch (e) {
        console.error('Error initializing heartbeat visualization:', e);
    }
    
    try {
        initConfidenceCurve();
    } catch (e) {
        console.error('Error initializing confidence curve visualization:', e);
    }

    // Poll backend every 5 seconds for stats
    try {
        updateBackgroundStats(); // Run immediately on load
        setInterval(updateBackgroundStats, 5000);
    } catch (e) {
        console.error('Error starting telemetry polling loop:', e);
    }

    // Bootstrap persistent whitelist cache
    try {
        import('./ui_v2.js').then(module => module.fetchWhitelist());
    } catch (e) {
        console.error('Error fetching initial whitelist:', e);
    }

    // Auto-detect user location to center the globe and set local traffic origin
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            state.userLat = position.coords.latitude;
            state.userLng = position.coords.longitude;

            // Re-center globe on user's actual location instantly to avoid tile flashing/loading glitches
            if (state.globeWorld) {
                state.globeWorld.pointOfView({ lat: state.userLat, lng: state.userLng, altitude: 1.8 });
            }
        }, (error) => {
            console.warn('Geolocation denied or failed. Using default fallback coordinates.', error);
        });
    }

    // Set up ResizeObserver to dynamically monitor left and right panel widths and auto-center the globe and compass
    try {
        const leftPanel = document.querySelector('.left-overlay');
        const rightPanel = document.querySelector('.right-overlay');
        
        const updatePanelWidths = () => {
            const leftWidth = leftPanel && !leftPanel.classList.contains('collapsed') ? leftPanel.offsetWidth : 0;
            const rightWidth = rightPanel && !rightPanel.classList.contains('collapsed') ? rightPanel.offsetWidth : 0;
            
            document.documentElement.style.setProperty('--left-panel-width', `${leftWidth}px`);
            document.documentElement.style.setProperty('--right-panel-width', `${rightWidth}px`);
            
            // Re-scale the ThreeJS globe
            resizeGlobe();
        };

        if (leftPanel && rightPanel) {
            const panelObserver = new ResizeObserver(() => {
                updatePanelWidths();
            });
            panelObserver.observe(leftPanel);
            panelObserver.observe(rightPanel);
            
            // Initial call on DOMContentLoaded
            updatePanelWidths();

            // Fallback initial call on complete window load to ensure all stylesheets are processed
            window.addEventListener('load', updatePanelWidths);
        }
    } catch (e) {
        console.error('Error setting up HUD Panel ResizeObserver:', e);
    }
});
