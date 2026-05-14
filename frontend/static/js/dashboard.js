/**
 * Combined Aegis UI/UX Showcase with AI Anomaly Detection
 * Bento Box Interaction Logic
 */

let systemScanResults = null;
let notificationHistory = [];
let unreadCount = 0;

// AI Traffic Globals
let isCapturing = false;
let socket = null;
let trafficChartInstance = null;
let chartData = {
    labels: Array.from({ length: 60 }, (_, i) => '-' + (60 - i) + 's'),
    datasets: [{
        label: 'Packets/sec',
        data: Array(60).fill(0),
        borderColor: 'rgba(255, 255, 255, 0.9)',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 0,
        pointHitRadius: 10
    }]
};
let currentSecondPackets = 0;

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

function initDashboard() {
    setupInteractions();

    // Set initial skeleton state
    document.querySelectorAll('.module-status').forEach(el => el.classList.add('is-loading'));
    setTimeout(() => {
        document.querySelectorAll('.module-status').forEach(el => el.classList.remove('is-loading'));
    }, 1500); // Simulate initial loading sequence for UX feedback

    // Start canvas animation
    initNetworkCanvas();

    // Init Chart
    initTrafficChart();

    // Start background pollers
    setInterval(updateBackgroundStats, 5000);
    setInterval(updateAdaptiveProgress, 8000);
    updateAdaptiveProgress();
}

function setupInteractions() {
    // Primary Audit Action
    const btnAudit = document.getElementById('btnAudit');
    if (btnAudit) {
        btnAudit.addEventListener('click', runTotalAudit);
    }

    // AI Stream Filters
    const btnFilterAll = document.getElementById('btnFilterAll');
    const btnFilterAnomalies = document.getElementById('btnFilterAnomalies');
    const btnFilterResolved = document.getElementById('btnFilterResolved');
    const streamList = document.getElementById('aiStreamList');

    function setActiveFilter(activeBtn) {
        [btnFilterAll, btnFilterAnomalies, btnFilterResolved].forEach(b => b?.classList.remove('active'));
        activeBtn.classList.add('active');
    }

    if (btnFilterAll && btnFilterAnomalies && btnFilterResolved && streamList) {
        btnFilterAll.addEventListener('click', () => {
            setActiveFilter(btnFilterAll);
            streamList.classList.remove('filter-anomalies', 'filter-resolved');
        });

        btnFilterAnomalies.addEventListener('click', () => {
            setActiveFilter(btnFilterAnomalies);
            streamList.classList.remove('filter-resolved');
            streamList.classList.add('filter-anomalies');
        });

        btnFilterResolved.addEventListener('click', () => {
            setActiveFilter(btnFilterResolved);
            streamList.classList.remove('filter-anomalies');
            streamList.classList.add('filter-resolved');
        });
    }

    // Top Bar Actions
    document.getElementById('btnSync')?.addEventListener('click', () => {
        fetchSystemMetadata();
        updateBackgroundStats();
    });
    document.getElementById('btnExport')?.addEventListener('click', downloadExport);

    // Module Clicks -> Run isolated scans
    document.querySelectorAll('.mini-module').forEach(tile => {
        tile.addEventListener('click', () => {
            const target = tile.dataset.target;
            if (target !== 'integrity') {
                runScanModule(target, tile);
            }
        });
    });

    // AI Hero Tile: Toggle Real-time Capture
    const heroAiTile = document.querySelector('.tile-ai-hero');
    if (heroAiTile) {
        heroAiTile.addEventListener('click', () => {
            toggleAiCapture();
        });
    }

    // Modal Control
    document.getElementById('btnClose')?.addEventListener('click', closeReportModal);
    document.getElementById('overlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('overlay')) closeReportModal();
    });
}

function initTrafficChart() {
    const ctx = document.getElementById('trafficChart');
    if (!ctx) return;

    trafficChartInstance = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { theme: 'dark', mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 6 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'rgba(255,255,255,0.5)', precision: 0 }
                }
            }
        }
    });

    // Start tick interval to push data to chart
    setInterval(() => {
        if (!trafficChartInstance || !isCapturing) return;

        chartData.datasets[0].data.push(currentSecondPackets);
        chartData.datasets[0].data.shift(); // remove oldest point

        currentSecondPackets = 0; // reset for the new second

        trafficChartInstance.update();
    }, 1000);
}

// ---------------------------------------------
// Real-time AI Integrations
// ---------------------------------------------

function toggleAiCapture() {
    const statusEl = document.getElementById('statAI');
    const subtitleEl = document.getElementById('aiHeroSubtitle');
    if (isCapturing) {
        // Stop Capture
        fetch('/api/stop-capture', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    isCapturing = false;
                    statusEl.innerHTML = 'Paused';
                    if (subtitleEl) subtitleEl.textContent = 'Capture paused. Click to resume.';
                    if (socket) {
                        socket.disconnect();
                        socket = null;
                    }
                }
            });
    } else {
        // Start Capture
        statusEl.innerHTML = 'Starting...';
        statusEl.classList.add('is-loading');
        if (subtitleEl) subtitleEl.textContent = 'Connecting...';

        fetch('/api/start-capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })
            .then(res => res.json())
            .then(data => {
                statusEl.classList.remove('is-loading');
                if (data.status === 'success') {
                    isCapturing = true;
                    statusEl.innerHTML = `
                    <div class="capture-indicator">
                        <div class="capture-dot"></div> Live
                    </div>`;
                    if (subtitleEl) subtitleEl.textContent = 'Packets captured. Monitoring in real-time.';
                    initSocketEvents();
                } else {
                    statusEl.innerHTML = 'Capture Failed';
                    statusEl.style.color = 'var(--status-danger)';
                    if (subtitleEl) subtitleEl.textContent = 'Failed to start. Run as Administrator.';
                }
            }).catch(err => {
                statusEl.classList.remove('is-loading');
                statusEl.innerHTML = 'Failed';
                if (subtitleEl) subtitleEl.textContent = 'Connection error. Try again.';
            });
    }
}

function initSocketEvents() {
    if (!socket) {
        socket = io({ transports: ['websocket', 'polling'] });

        socket.on('connect', () => {
            console.log('Socket connected for real-time AI');
        });

        socket.on('packet', (data) => {
            // Update Packets counter
            const packetEl = document.getElementById('aiPackets');
            if (packetEl) packetEl.innerText = parseInt(packetEl.innerText) + 1;

            // Increment global packets-per-second chart
            currentSecondPackets++;
        });

        socket.on('anomaly', (data) => {
            const isThreatIntel = data.alert_type === 'Threat Intelligence Blocklist';

            // Synchronize specific threat counters in the Hero section
            if (isThreatIntel) {
                const threatEl = document.getElementById('aiThreatHits');
                if (threatEl) {
                    threatEl.innerText = parseInt(threatEl.innerText) + 1;
                }
            } else {
                const anomalyEl = document.getElementById('aiAnomalies');
                if (anomalyEl) anomalyEl.innerText = parseInt(anomalyEl.innerText) + 1;
            }

            // Also log it to the terminal stream
            prependAnomalyToStream(data);

            // Toast popup + notification history
            showAnomalyToast(data);
            addToNotificationHistory(data);
        });

        socket.on('normal_flow', (data) => {
            prependNormalFlow(data);
        });
    }
}

function prependAnomalyToStream(data) {
    const list = document.getElementById('aiStreamList');
    if (!list) return;

    if (list.children.length === 1 && list.children[0].innerText.includes('Awaiting')) {
        list.innerHTML = '';
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lossStr = data.reconstruction_error ? ` | Loss: ${parseFloat(data.reconstruction_error).toFixed(4)}` : '';

    const srcDisplay = (data.src_host && data.src_host !== data.src) ? data.src_host : data.src;
    const dstDisplay = (data.dst_host && data.dst_host !== data.dst) ? data.dst_host : data.dst;

    const dataStr = JSON.stringify(data).replace(/"/g, '&quot;');

    const html = `
        <div class="terminal-line log-anomaly" data-src="${data.src}" data-dst="${data.dst}" style="color: var(--status-danger);">
            <span style="color: #666;">[${timeStr}]</span> 
            <span class="anomaly-badge" style="font-weight: bold;">[ALERT]</span> 
            ${srcDisplay} &rarr; ${dstDisplay}:${data.dport}${lossStr}
            <span class="mark-normal-btn" style="cursor:pointer; color:var(--text-secondary); margin-left:10px; font-size:0.7rem; text-decoration:underline;" onclick="markAsNormal(this, '${dataStr}')">[Mark Normal]</span>
        </div>
    `;
    list.insertAdjacentHTML('afterbegin', html);
}

async function markAsNormal(btn, dataStr) {
    try {
        const data = JSON.parse(dataStr);

        // Call backend API
        await fetch('/api/mark-normal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        // Find all matching anomalies in the stream
        const list = document.getElementById('aiStreamList');
        const logs = list.querySelectorAll('.log-anomaly');

        logs.forEach(log => {
            if (log.dataset.src === data.src && log.dataset.dst === data.dst) {
                // Update log style to reflect 'Resolved' state
                log.style.color = 'var(--status-safe)';
                log.classList.remove('log-anomaly');
                log.classList.add('log-resolved');

                // Change badge
                const badge = log.querySelector('.anomaly-badge');
                if (badge) badge.innerText = '[RESOLVED]';

                // Remove button
                const btnEl = log.querySelector('.mark-normal-btn');
                if (btnEl) btnEl.remove();
            }
        });

        // Update resolved counter in hero tile
        const resolvedEl = document.getElementById('aiResolved');
        if (resolvedEl) {
            const resolvedCount = document.querySelectorAll('#aiStreamList .log-resolved').length;
            resolvedEl.innerText = resolvedCount;
        }

        // Sync anomaly counter with actual unresolved count in the stream
        const anomalyEl = document.getElementById('aiAnomalies');
        if (anomalyEl) {
            const activeAnomalies = document.querySelectorAll('#aiStreamList .log-anomaly').length;
            anomalyEl.innerText = activeAnomalies;
        }
    } catch (e) {
        console.error("Error marking normal:", e);
    }
}

function prependNormalFlow(data) {
    const list = document.getElementById('aiStreamList');
    if (!list) return;

    // Remove placeholder if present
    if (list.children.length === 1 && list.children[0].innerText.includes('Awaiting')) {
        list.innerHTML = '';
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const srcDisplay = (data.src_host && data.src_host !== data.src) ? data.src_host : data.src;
    const dstDisplay = (data.dst_host && data.dst_host !== data.dst) ? data.dst_host : data.dst;

    const html = `
        <div class="terminal-line log-normal">
            <span style="color: #666;">[${timeStr}]</span> 
            <span style="color: var(--accent-blue);">[OK]</span> 
            ${srcDisplay} &rarr; ${dstDisplay}:${data.dport} | Loss: ${parseFloat(data.error).toFixed(4)}
        </div>
    `;
    list.insertAdjacentHTML('afterbegin', html);

    const normalLogs = list.getElementsByClassName('log-normal');
    if (normalLogs.length > 20) {
        normalLogs[normalLogs.length - 1].remove();
    }
}

async function updateBackgroundStats() {
    try {
        const res = await fetch('/api/capture-status');
        const data = await res.json();

        if (data.status === 'success') {
            const stats = data.data.stats;
            document.getElementById('aiFlows').innerText = stats.active_flows || 0;

            // Update Traffic Hotspots
            if (stats.top_talkers && stats.top_talkers.length > 0) {
                renderHotspots(stats.top_talkers);
            }

            // Update Top Services
            if (stats.top_services && stats.top_services.length > 0) {
                renderServices(stats.top_services);
            }

            // Update Longest Flows
            if (stats.longest_flows && stats.longest_flows.length > 0) {
                renderLongestFlows(stats.longest_flows);
            }

            // If capture was running in background but UI wasn't aware, sync up
            if (!isCapturing && data.data.capturing) {
                isCapturing = true;
                const statusEl = document.getElementById('statAI');
                const subtitleEl = document.getElementById('aiHeroSubtitle');
                statusEl.innerHTML = `
                    <div class="capture-indicator">
                        <div class="capture-dot"></div> Live
                    </div>`;
                if (subtitleEl) subtitleEl.textContent = 'Packets captured. Monitoring in real-time.';
                initSocketEvents();
            }
        }
    } catch (e) { }
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

function renderHotspots(topTalkers) {
    const list = document.getElementById('hotspotsList');
    if (!list) return;

    const maxBytes = topTalkers[0]?.bytes || 1;

    let html = '';
    topTalkers.forEach((entry, idx) => {
        const pct = Math.max(5, (entry.bytes / maxBytes) * 100);
        const hostDisplay = (entry.host && entry.host !== entry.ip) ? entry.host : entry.ip;
        html += `
            <div class="hotspot-item">
                <div class="hotspot-row">
                    <span class="hotspot-rank">#${idx + 1}</span>
                    <span class="hotspot-ip">${hostDisplay}</span>
                    <span class="hotspot-bytes">${formatBytes(entry.bytes)}</span>
                </div>
                <div class="hotspot-bar-track">
                    <div class="hotspot-bar-fill" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
}

function resolveService(port) {
    const services = {
        80: 'HTTP', 443: 'HTTPS', 22: 'SSH', 21: 'FTP', 53: 'DNS',
        3389: 'RDP', 445: 'SMB', 1433: 'MSSQL', 3306: 'MySQL'
    };
    return services[port] || `Port ${port}`;
}

function renderServices(topServices) {
    const list = document.getElementById('servicesList');
    if (!list) return;

    const maxBytes = topServices[0]?.bytes || 1;

    let html = '';
    topServices.forEach((entry, idx) => {
        const pct = Math.max(5, (entry.bytes / maxBytes) * 100);
        html += `
            <div class="hotspot-item">
                <div class="hotspot-row">
                    <span class="hotspot-rank">#${idx + 1}</span>
                    <span class="hotspot-ip">${resolveService(entry.port)}</span>
                    <span class="hotspot-bytes">${formatBytes(entry.bytes)}</span>
                </div>
                <div class="hotspot-bar-track">
                    <div class="hotspot-bar-fill" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
}

function renderLongestFlows(longestFlows) {
    const list = document.getElementById('longestFlowsList');
    if (!list) return;

    let html = '';
    longestFlows.forEach((entry, idx) => {
        const dur = Math.round(entry.duration);
        let timeStr = dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s`;

        const hostDisplay = (entry.src_host && entry.src_host !== entry.src) ? entry.src_host : entry.src;

        html += `
            <div class="hotspot-item">
                <div class="hotspot-row">
                    <span class="hotspot-rank">#${idx + 1}</span>
                    <span class="hotspot-ip" style="font-size: 0.8rem;">${hostDisplay} &rarr; :${entry.port}</span>
                    <span class="hotspot-bytes" style="color: var(--status-crit);">${timeStr}</span>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
}


// ---------------------------------------------
// Core System Interactions
// ---------------------------------------------

async function fetchSystemMetadata() {
    const btnSync = document.getElementById('btnSync');
    if (btnSync) btnSync.style.opacity = '0.5';
    try {
        const healthRes = await fetch('/api/health');
        const healthData = await healthRes.json();
        if (healthData.status === 'healthy' && !healthData.ai_model_loaded) {
            document.getElementById('adaptiveStatus').textContent = 'Model not loaded';
        }
    } catch (err) {
        console.error('Metadata fetch failed', err);
    } finally {
        if (btnSync) setTimeout(() => { btnSync.style.opacity = '1'; }, 300);
    }
}

async function updateAdaptiveProgress() {
    try {
        const res = await fetch('/api/adaptive-stats');
        const data = await res.json();
        if (data.status !== 'success') return;

        const s = data.data;
        const threshold = s.retrain_threshold || 100;
        const count = s.new_since_retrain || 0;
        const pct = Math.min(100, (count / threshold) * 100);

        document.getElementById('adaptivePct').textContent = `${pct.toFixed(1)}%`;
        document.getElementById('adaptiveBarFill').style.width = pct + '%';

        // Update new stats
        if (s.model_threshold) {
            document.getElementById('modelThreshold').textContent = parseFloat(s.model_threshold).toFixed(4);
        }
        if (s.total_baseline !== undefined) {
            document.getElementById('baselineTotal').textContent = s.total_baseline.toLocaleString();
        }

        if (s.is_retraining) {
            document.getElementById('adaptiveStatus').textContent = 'Retraining model...';
            document.getElementById('adaptiveBarFill').style.background = 'var(--status-warn)';
        } else if (count === 0) {
            document.getElementById('adaptiveStatus').textContent = 'Collecting baseline flows...';
        } else {
            document.getElementById('adaptiveStatus').textContent = `${count.toLocaleString()} / ${threshold.toLocaleString()} flows`;
            document.getElementById('adaptiveBarFill').style.background = '';
        }
    } catch (e) { }
}

async function runTotalAudit() {
    const btn = document.getElementById('btnAudit');
    const originalText = btn.innerHTML;

    // UI Loading State
    btn.innerHTML = 'Analyzing Vectors...';
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.8';

    // Hero loading state
    document.getElementById('globalScore').classList.add('is-loading');
    document.getElementById('globalStatus').textContent = 'Performing deep system analysis...';
    document.getElementById('scanTimeBadge').textContent = 'In Progress';
    document.getElementById('scanTimeBadge').style.borderColor = 'var(--accent-blue)';
    document.getElementById('scanTimeBadge').style.color = 'var(--accent-blue)';

    // Module loading state for everything except AI
    document.querySelectorAll('.tile-module, .mini-module').forEach(tile => {
        const target = tile.getAttribute('data-target');
        if (target !== 'ai-traffic' && target !== 'anomalies') {
            const el = tile.querySelector('.module-status, .mini-status');
            if (el) {
                el.textContent = 'Scanning...';
                el.className = 'module-status is-loading';
            }
        }
    });

    try {
        const res = await fetch('/api/full-scan', { method: 'POST' });
        const result = await res.json();

        if (result.status === 'success') {
            systemScanResults = result.data;
            updateHeroDashboard(result.data.risk);
            updateAllModules(result.data);
            showReportModal(result.data.recommendations);
        } else {
            throw new Error('Audit API Error');
        }
    } catch (err) {
        document.getElementById('globalStatus').innerHTML = '<span class="status-color-danger">Analysis Failed</span>';
        document.getElementById('globalScore').textContent = 'ERR';
    } finally {
        btn.innerHTML = originalText;
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
        document.getElementById('globalScore').classList.remove('is-loading');
        document.querySelectorAll('.module-status').forEach(el => el.classList.remove('is-loading'));
    }
}

async function runScanModule(target, tileElement) {
    if (target === 'anomalies') return; // Don't scan anomalies

    const statusEl = tileElement.querySelector('.module-status, .mini-status');
    statusEl.textContent = 'Scanning...';
    statusEl.classList.add('is-loading');

    const endpoints = {
        'wifi': '/api/wifi-security',
        'ports': '/api/port-scan',
        'vulnerabilities': '/api/vulnerability-scan',
        'endpoint': '/api/endpoint-scan'
    };

    try {
        const res = await fetch(endpoints[target]);
        const result = await res.json();
        if (result.status === 'success') {
            updateModuleData(target, result.data, statusEl);
            buildModuleReport(target, result.data);
        }
    } catch (err) {
        statusEl.textContent = 'Failed';
        statusEl.style.color = 'var(--status-danger)';
    } finally {
        statusEl.classList.remove('is-loading');
    }
}

function updateHeroDashboard(riskData) {
    const scoreEl = document.getElementById('globalScore');
    const statusEl = document.getElementById('globalStatus');
    const badgeEl = document.getElementById('scanTimeBadge');

    // Format timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Remove old classes
    scoreEl.className = 'score-display';

    scoreEl.textContent = riskData.score;
    badgeEl.textContent = `Updated ${timeStr}`;

    // Apply strict UX coloring
    if (riskData.risk_color === 'green') {
        scoreEl.style.color = 'var(--status-safe)';
        statusEl.innerHTML = `System integrity is <span class="status-color-safe">Optimal</span>.`;
        badgeEl.style.borderColor = 'var(--border-color)';
        badgeEl.style.color = 'var(--text-secondary)';
    } else if (riskData.risk_color === 'yellow') {
        scoreEl.style.color = 'var(--status-warn)';
        statusEl.innerHTML = `System integrity is <span class="status-color-warn">Degraded</span>.`;
        badgeEl.style.borderColor = 'var(--status-warn)';
        badgeEl.style.color = 'var(--status-warn)';
    } else {
        scoreEl.style.color = 'var(--status-danger)';
        statusEl.innerHTML = `System integrity is <span class="status-color-danger">Critical</span>.`;
        badgeEl.style.borderColor = 'var(--status-danger)';
        badgeEl.style.color = 'var(--status-danger)';
    }
}

function updateAllModules(data) {
    if (data.wifi) updateModuleData('wifi', data.wifi, document.getElementById('statWifi'));
    if (data.ports) updateModuleData('ports', data.ports, document.getElementById('statPorts'));
    if (data.vulnerabilities) updateModuleData('vulnerabilities', data.vulnerabilities, document.getElementById('statVuln'));
    if (data.endpoint) updateModuleData('endpoint', data.endpoint, document.getElementById('statEndpoint'));
}

function updateModuleData(target, data, element) {
    if (!element) return;
    element.style.color = 'var(--text-secondary)'; // reset

    if (target === 'wifi') {
        element.textContent = data.connected ? data.risk_level : 'Disconnected';
        if (data.risk_color === 'green') element.style.color = 'var(--status-safe)';
        if (data.risk_color === 'red') element.style.color = 'var(--status-danger)';
    } else if (target === 'ports') {
        element.textContent = `${data.open_ports_count} Open`;
        if (data.high_risk > 0) element.style.color = 'var(--status-danger)';
    } else if (target === 'vulnerabilities') {
        element.textContent = data.status.replace('_', ' ');
        if (data.critical_count > 0) element.style.color = 'var(--status-danger)';
    } else if (target === 'endpoint') {
        element.textContent = data.status;
        if (data.status !== 'Active') element.style.color = 'var(--status-danger)';
    }
}

// Modal / Slide-over UI
function showReportModal(recommendations) {
    document.querySelector('.panel-header h2').textContent = 'Security Audit Report';
    const list = document.getElementById('reportContent');
    list.innerHTML = '';

    if (recommendations && recommendations.length > 0) {
        recommendations.forEach(rec => {
            const isDanger = rec.priority === 'critical' || rec.priority === 'high';

            const html = `
                <div class="audit-item">
                    <div class="audit-icon ${isDanger ? 'danger' : 'warn'}">
                        ${isDanger ? '!' : 'ℹ'}
                    </div>
                    <div class="audit-meta">
                        <h4 style="color: ${isDanger ? 'var(--text-primary)' : 'var(--text-secondary)'}">${rec.title}</h4>
                        <p>${rec.description}</p>
                        <span class="fix">Fix: ${rec.action}</span>
                    </div>
                </div>
            `;
            list.insertAdjacentHTML('beforeend', html);
        });
    } else {
        list.innerHTML = `<div class="audit-item"><div class="audit-meta"><p>No critical actions required. System is fully optimized.</p></div></div>`;
    }

    const overlay = document.getElementById('overlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // prevent background scrolling
}

function buildModuleReport(target, data) {
    const list = document.getElementById('reportContent');
    list.innerHTML = '';
    let title = 'Subsystem Report';

    if (target === 'wifi') {
        title = 'Wireless Integrity Report';
        list.innerHTML = `
            <div class="audit-item">
                <div class="audit-icon ${data.risk_color === 'green' ? 'safe' : 'warn'}">ℹ</div>
                <div class="audit-meta">
                    <h4 style="color: var(--text-primary)">Connection Status: ${data.connected ? 'Connected' : 'Disconnected'}</h4>
                    <p>Analysis complete. Evaluating wireless vector integrity.</p>
                    <span class="fix">Security Level: ${data.risk_level || 'N/A'}</span>
                </div>
            </div>`;
    } else if (target === 'ports') {
        title = 'Perimeter Exposure Analysis';
        if (data.ports && data.ports.length > 0) {
            data.ports.forEach(port => {
                const portState = port.state || 'open'; // Default if missing
                list.insertAdjacentHTML('beforeend', `
                    <div class="audit-item">
                        <div class="audit-icon ${portState === 'open' ? 'danger' : 'warn'}">${portState === 'open' ? '!' : 'ℹ'}</div>
                        <div class="audit-meta">
                            <h4 style="color: var(--text-primary)">Port ${port.port || 'Unknown'}/tcp</h4>
                            <p>Service: ${port.service || 'Unknown'}</p>
                            <span class="fix">State: ${portState} | Risk: ${port.risk_level || 'Unknown'}</span>
                        </div>
                    </div>
                `);
            });
        } else {
            list.innerHTML = `<div class="audit-item"><div class="audit-meta"><p>No open ports detected. Perimeter secure.</p></div></div>`;
        }
    } else if (target === 'vulnerabilities') {
        title = 'Vulnerability Assessment Engine';
        if (data.vulnerabilities && data.vulnerabilities.length > 0) {
            data.vulnerabilities.forEach(vuln => {
                const isCritical = vuln.severity && vuln.severity.toLowerCase() === 'critical';
                list.insertAdjacentHTML('beforeend', `
                    <div class="audit-item">
                        <div class="audit-icon ${isCritical ? 'danger' : 'warn'}">${isCritical ? '!' : 'ℹ'}</div>
                        <div class="audit-meta">
                            <h4 style="color: ${isCritical ? 'var(--status-danger)' : 'var(--text-primary)'}">${vuln.name || vuln.cve_id || 'Vulnerability Detected'}</h4>
                            <p>${vuln.description || 'No description available for this vector.'}</p>
                            <span class="fix">Severity: ${vuln.severity || 'Unknown'} | Link: ${vuln.component || 'System'}</span>
                        </div>
                    </div>
                `);
            });
        } else {
            list.innerHTML = `<div class="audit-item"><div class="audit-meta"><p>No documented vulnerabilities found in the current configuration.</p></div></div>`;
        }
    } else if (target === 'endpoint') {
        title = 'Endpoint Protection Engine';
        const isSafe = data.status === 'Active';
        list.innerHTML = `
            <div class="audit-item">
                <div class="audit-icon ${isSafe ? 'safe' : 'danger'}">${isSafe ? 'ℹ' : '!'}</div>
                <div class="audit-meta">
                    <h4 style="color: ${isSafe ? 'var(--text-primary)' : 'var(--status-danger)'}">EDR/Antivirus Status: ${data.status}</h4>
                    <p>Analysis of local endpoint telemetry and active protection services.</p>
                    <span class="fix">Protection Level: ${data.protection_level || 'Unknown'}</span>
                </div>
            </div>`;
    }

    document.querySelector('.panel-header h2').textContent = title;
    const overlay = document.getElementById('overlay');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeReportModal() {
    const overlay = document.getElementById('overlay');
    overlay.classList.remove('active');
    setTimeout(() => { document.body.style.overflow = ''; }, 300);
}

async function downloadExport() {
    const btn = document.getElementById('btnExport');
    const origText = btn.innerHTML;

    try {
        if (btn) btn.innerHTML = '<span style="opacity: 0.7">Exporting...</span>';

        // Fetch raw HTML string
        const response = await fetch('/api/report/download');
        const htmlText = await response.text();

        // Synthesize local blob to completely bypass network-layer filename strippers
        const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `OVERSIGHT-Audit-Report-${ts}.html`;

        document.body.appendChild(a);
        a.click();

        // Wipe from browser memory
        setTimeout(() => {
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        }, 100);

    } catch (err) {
        console.error("Blob Export Error:", err);
    } finally {
        if (btn) btn.innerHTML = origText;
    }
}

// --------------------------------------------------------------------
// Animated Network Graph Background
// --------------------------------------------------------------------
function initNetworkCanvas() {
    const canvas = document.getElementById('networkGraph');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    function resize() {
        width = canvas.parentElement.offsetWidth;
        height = canvas.parentElement.offsetHeight;
        canvas.width = width;
        canvas.height = height;
    }
    window.addEventListener('resize', resize);
    resize();

    // Particle system
    const particles = [];
    const maxParticles = 60;
    const connectionDistance = 120;

    function initParticles() {
        particles.length = 0;
        for (let i = 0; i < maxParticles; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                radius: Math.random() * 2 + 1
            });
        }
    }
    initParticles();

    // Setup resize reset
    window.addEventListener('resize', () => {
        resize();
        initParticles();
    });

    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Update and draw particles
        ctx.fillStyle = 'rgba(255, 68, 68, 0.8)';

        for (let i = 0; i < maxParticles; i++) {
            const p = particles[i];

            // Move
            p.x += p.vx;
            p.y += p.vy;

            // Bounce off walls
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            // Draw Node
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw Connecting Lines
        ctx.lineWidth = 1;
        for (let i = 0; i < maxParticles; i++) {
            for (let j = i + 1; j < maxParticles; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < connectionDistance) {
                    // Opacity decays with distance
                    const opacity = 1 - (distance / connectionDistance);
                    ctx.strokeStyle = `rgba(255, 68, 68, ${opacity * 0.4})`;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(animate);
    }

    // Start loop
    animate();
}

// ====================================================================
// TOAST NOTIFICATION SYSTEM
// ====================================================================

function showAnomalyToast(data) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const isThreatIntel = data.alert_type === 'Threat Intelligence Blocklist';
    const typeLabel = isThreatIntel ? 'Threat Intel Hit' : 'AI Anomaly';
    const typeColor = isThreatIntel ? 'var(--ai-accent)' : 'var(--status-warn)';
    const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const toast = document.createElement('div');
    toast.className = 'toast-alert';
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-type" style="color: ${typeColor};">${typeLabel}</span>
            <span class="toast-time">${timeStr}</span>
        </div>
        <div class="toast-body">
            <strong>${data.src}:${data.sport}</strong> &rarr; <strong>${data.dst}:${data.dport}</strong><br>
            ${data.bytes}B | ${parseFloat(data.duration).toFixed(2)}s | Err: ${parseFloat(data.reconstruction_error).toFixed(2)}
        </div>
        <div class="toast-progress"><div class="toast-progress-bar" style="width: 100%;"></div></div>
    `;

    // Click toast to open anomaly detail modal
    const dataStr = JSON.stringify(data);
    toast.addEventListener('click', () => {
        try {
            const parsed = JSON.parse(dataStr);
            const isTI = parsed.alert_type === 'Threat Intelligence Blocklist';
            let report = [{
                priority: 'critical',
                title: isTI ? 'Known Malicious IP Detected' : 'AI Behavioral Anomaly Detected',
                description: `Source: ${parsed.src}:${parsed.sport} \u2192 Destination: ${parsed.dst}:${parsed.dport}`,
                action: isTI
                    ? `Traffic involved IP known to be on public threat blocklists. Recommend immediate firewall block of ${parsed.src}.`
                    : `Flow of ${parsed.packets} packets (${Math.round(parsed.bytes / 1024)} KB) over ${parseFloat(parsed.duration).toFixed(2)}s exhibited unusual patterns (Err: ${parseFloat(parsed.reconstruction_error).toFixed(2)}).`
            }];
            showReportModal(report);
        } catch (e) { }
        dismissToast(toast);
    });

    container.appendChild(toast);

    // Auto-dismiss logic with hover-pause
    const TOAST_DURATION = 5000;
    const TICK_MS = 50;
    let remaining = TOAST_DURATION;
    let isPaused = false;

    const progressBar = toast.querySelector('.toast-progress-bar');

    toast.addEventListener('mouseenter', () => { isPaused = true; });
    toast.addEventListener('mouseleave', () => { isPaused = false; });

    const interval = setInterval(() => {
        if (!isPaused) {
            remaining -= TICK_MS;
            const pct = Math.max(0, (remaining / TOAST_DURATION) * 100);
            if (progressBar) progressBar.style.width = pct + '%';

            if (remaining <= 0) {
                clearInterval(interval);
                dismissToast(toast);
            }
        }
    }, TICK_MS);
}

function dismissToast(toast) {
    toast.classList.add('toast-exit');
    setTimeout(() => { toast.remove(); }, 350);
}

// ====================================================================
// NOTIFICATION HISTORY OVERLAY
// ====================================================================

function addToNotificationHistory(data) {
    notificationHistory.unshift(data);
    if (notificationHistory.length > 50) notificationHistory.pop();

    // Update badge
    unreadCount++;
    const badge = document.getElementById('notifBadge');
    if (badge) {
        badge.style.display = 'flex';
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    }
}

function toggleNotificationOverlay() {
    const overlay = document.getElementById('notifOverlay');
    if (!overlay) return;

    const isActive = overlay.classList.contains('active');

    if (isActive) {
        overlay.classList.remove('active');
    } else {
        renderNotificationList();
        overlay.classList.add('active');
        // Mark as read
        unreadCount = 0;
        const badge = document.getElementById('notifBadge');
        if (badge) badge.style.display = 'none';
    }
}

function renderNotificationList() {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (notificationHistory.length === 0) {
        list.innerHTML = '<div class="notif-empty">No alerts recorded yet.</div>';
        return;
    }

    let html = '';
    notificationHistory.forEach((data, idx) => {
        const isThreatIntel = data.alert_type === 'Threat Intelligence Blocklist';
        const typeLabel = isThreatIntel ? 'Threat Intel' : 'AI Anomaly';
        const typeColor = isThreatIntel ? 'var(--ai-accent)' : 'var(--status-warn)';
        const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        html += `
            <div class="notif-item" onclick="showNotifDetail(${idx})">
                <div class="notif-item-header">
                    <span class="notif-item-type" style="color: ${typeColor};">${typeLabel}</span>
                    <span class="notif-item-time">${timeStr}</span>
                </div>
                <div class="notif-item-body">
                    <strong>${data.src}:${data.sport}</strong> &rarr; <strong>${data.dst}:${data.dport}</strong> | ${data.bytes}B | Err: ${parseFloat(data.reconstruction_error).toFixed(2)}
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}

function showNotifDetail(idx) {
    const data = notificationHistory[idx];
    if (!data) return;

    // Close overlay first
    toggleNotificationOverlay();

    // Open the audit modal
    const isTI = data.alert_type === 'Threat Intelligence Blocklist';
    let report = [{
        priority: 'critical',
        title: isTI ? 'Known Malicious IP Detected' : 'AI Behavioral Anomaly Detected',
        description: `Source: ${data.src}:${data.sport} \u2192 Destination: ${data.dst}:${data.dport}`,
        action: isTI
            ? `Traffic involved IP known to be on public threat blocklists. Recommend immediate firewall block of ${data.src}.`
            : `Flow of ${data.packets} packets (${Math.round(data.bytes / 1024)} KB) over ${parseFloat(data.duration).toFixed(2)}s exhibited unusual patterns (Err: ${parseFloat(data.reconstruction_error).toFixed(2)}).`
    }];
    showReportModal(report);
}

function clearNotifications() {
    notificationHistory = [];
    unreadCount = 0;
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
    renderNotificationList();
}
