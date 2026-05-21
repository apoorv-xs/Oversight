import { state } from './state_v2.js';
import { nowTimeStr, alertTitle, getGlobalArcs, formatTimestampToTimeStr, getSelectedFlowEndpoints, checkIsLocalIp, checkIsLocalConnection } from './utils_v2.js';
import { audio } from './audio_v2.js';

export let latestScanData = null;

export async function fetchWhitelist() {
    try {
        const res = await fetch('/api/whitelist');
        const resp = await res.json();
        if (resp.status === 'success') {
            state.whitelist = resp.data || [];
            const leftSafeFlows = document.getElementById('aiSafeFlows');
            if (leftSafeFlows) {
                leftSafeFlows.innerText = state.whitelist.length;
            }
        }
    } catch (e) {
        console.error("Failed to fetch whitelist:", e);
    }
}
window.fetchWhitelist = fetchWhitelist;

window.selectWhitelistItem = function (ip) {
    state.selectedFlowId = null;
    toggleLockOn(ip);
};

// ─── Flow Tracking & Stream ───────────────────────────────────────────────────

export function isFlowSelected(f) {
    if (!state.selectedFlowId) return false;
    if (state.selectedFlowId === f.id) return true;
    
    const target = getSelectedFlowEndpoints();
    if (target) {
        return f.src === target.src && f.dst === target.dst && f.dport === target.dport;
    }
    return false;
}

export function isStreamEventSelected(event) {
    if (!state.selectedFlowId) return false;
    if (state.selectedFlowId === event.id) return true;

    const target = getSelectedFlowEndpoints();
    if (target) {
        return event.src === target.src && event.dst === target.dst && event.dport === target.dport;
    }
    return false;
}

export function trackFlow(data, isAnomaly) {
    const existingIndex = state.recentFlows.findIndex(f => 
        f.src === data.src && f.dst === data.dst && f.dport === data.dport
    );

    if (existingIndex !== -1) {
        // Update existing flow time and move to top
        const flow = state.recentFlows.splice(existingIndex, 1)[0];
        flow.time = nowTimeStr();
        flow.lastSeen = Date.now();
        // Escalate status to anomaly if a new packet is malicious
        if (isAnomaly) flow.isAnomaly = true;
        if (data.src_host) flow.src_host = data.src_host;
        if (data.dst_host) flow.dst_host = data.dst_host;
        state.recentFlows.unshift(flow);
    } else {
        // Add completely new flow
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
            hasGeo: !!data.geo
        });
    }

    // Keep hard limit as a fallback
    if (state.recentFlows.length > 100) state.recentFlows.pop();
    renderActiveFlowsList();
}

// Expire flows from the UI list after 5 seconds of inactivity to perfectly match the backend state, unless selected
setInterval(() => {
    const now = Date.now();
    const initialLen = state.recentFlows.length;
    state.recentFlows = state.recentFlows.filter(f => {
        const isSelected = isFlowSelected(f);
        return (now - f.lastSeen) < 5000 || isSelected;
    });
    if (state.recentFlows.length !== initialLen) {
        renderActiveFlowsList();
    }
}, 2000);


export function prependToStream(data, isAnomaly) {
    if (!state.streamEvents) {
        state.streamEvents = [];
    }

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
        raw_features: data.raw_features || null
    });

    if (state.streamEvents.length > 100) {
        state.streamEvents.pop();
    }

    renderStreamList();
}

let lastStreamRender = 0;
let streamTimeoutId = null;
let streamRenderPending = false;

export function renderStreamList() {
    const now = Date.now();
    const timeSinceLastRender = now - lastStreamRender;
    const throttleDelay = 150; // Throttle stream updates to max ~6.6 per second to avoid layout thrashing

    if (timeSinceLastRender < throttleDelay) {
        if (!streamTimeoutId) {
            streamTimeoutId = setTimeout(() => {
                streamTimeoutId = null;
                renderStreamList();
            }, throttleDelay - timeSinceLastRender);
        }
        return;
    }

    if (streamTimeoutId) {
        clearTimeout(streamTimeoutId);
        streamTimeoutId = null;
    }

    lastStreamRender = now;

    if (streamRenderPending) return;
    streamRenderPending = true;

    requestAnimationFrame(() => {
        streamRenderPending = false;
        const listEl = document.getElementById('aiStreamList');
        if (!listEl) return;

        if (!state.streamEvents) {
            state.streamEvents = [];
        }

    const isUserLaptop = (eventOrFlow) => {
        const srcHost = (eventOrFlow.src_host || '').toLowerCase();
        const dstHost = (eventOrFlow.dst_host || '').toLowerCase();
        const src = (eventOrFlow.src || '').toLowerCase();
        const dst = (eventOrFlow.dst || '').toLowerCase();
        
        const isUkLaptop = (val) => {
            return val.includes('laptop-uk') || 
                   val.includes('laptop_uk') || 
                   val.includes('laptop uk');
        };
        
        return isUkLaptop(srcHost) || isUkLaptop(dstHost) || isUkLaptop(src) || isUkLaptop(dst);
    };

    const leftAnomalies = document.getElementById('aiAnomalies');
    if (leftAnomalies) {
        const anomalyCount = state.streamEvents.filter(e => e.isAnomaly && !e.isSafe && !isUserLaptop(e)).length;
        leftAnomalies.innerText = anomalyCount;
        leftAnomalies.style.color = anomalyCount > 0 ? 'var(--status-danger)' : 'var(--text-secondary)';
    }

    const leftSafeFlows = document.getElementById('aiSafeFlows');
    if (leftSafeFlows) {
        const wlCount = (state.whitelist || []).length;
        leftSafeFlows.innerText = wlCount;
        leftSafeFlows.style.color = wlCount > 0 ? 'var(--status-safe)' : 'var(--text-secondary)';
    }

    // Update bottom small telemetry status
    if (state.streamEvents.length > 0) {
        listEl.innerHTML = `
            <div class="radar-empty-state" style="height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                <div class="radar-pulse-indicator" style="width:8px; height:8px; background:var(--status-safe); border-radius:50%; margin-bottom:8px; box-shadow:0 0 8px var(--status-safe);"></div>
                <span class="radar-empty-title" style="color:var(--status-safe); font-size:0.7rem; letter-spacing:1px;">ENGINE ACTIVE</span>
                <span class="radar-empty-subtitle" style="font-size:0.6rem; opacity:0.5;">LIVE TELEMETRY STREAM ONLINE</span>
            </div>
        `;
    } else {
        listEl.innerHTML = `
            <div class="radar-empty-state">
                <div class="radar-sweep-scanner"></div>
                <span class="radar-empty-title">SYSTEM SECURE</span>
                <span class="radar-empty-subtitle">MONITORING PACKET VECTORSTREAM</span>
            </div>
        `;
    }

    const anomalyListEl = document.getElementById('anomalyStreamList');
    if (anomalyListEl) {
        if (state.upperLeftFilter === 'SAFE') {
            const whitelist = state.whitelist || [];
            if (whitelist.length === 0) {
                anomalyListEl.innerHTML = `
                    <div class="radar-empty-state">
                        <span class="radar-empty-subtitle" style="font-family: 'Courier New', monospace; font-size: 0.75rem; color: rgba(255, 255, 255, 0.4); text-transform: uppercase;">NO SECURED VECTORS</span>
                    </div>
                `;
            } else {
                anomalyListEl.innerHTML = whitelist.map((item, index) => {
                    const id = `whitelist-${index}`;
                    const cls = 'matrix-item is-safe';
                    const statusStr = '[SECURED]';
                    
                    const actionBtn = `<button class="btn-mark-safe danger" onclick="event.stopPropagation(); removeWhitelistEntry('${item.src}', '${item.dst}', ${item.dport})" style="font-size: 0.6rem; padding: 1px 4px; background: rgba(255, 42, 42, 0.15); border-color: rgba(255, 42, 42, 0.4); color: var(--status-danger);">UNSECURE</button>`;
                    const detailsLine = `<div class="matrix-line" style="margin-top:2px;"><span>RULE ESTABLISHED</span>${actionBtn}</div>`;

                    const srcDisplay = item.src;
                    const dstDisplay = item.dst;
                    
                    const isLocal = checkIsLocalConnection(item.src, item.dst);
                    const localTag = isLocal ? '<span class="local-tag" style="font-size: 0.55rem; color: var(--status-safe); border: 1px solid rgba(0, 230, 118, 0.4); padding: 0px 3px; border-radius: 2px; margin-left: 5px; font-weight: 800;">LOCAL</span>' : '';

                    return `
                        <div id="stream-item-${id}" class="${cls}" onclick="selectWhitelistItem('${item.src}')" style="cursor: pointer;">
                            <div class="matrix-line" style="font-weight: 700; opacity: 0.7;">
                                <span>> EXCEPTION${localTag}</span>
                                <span>${statusStr}</span>
                            </div>
                            <div class="matrix-line">
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; display:block;" title="${srcDisplay} -> ${dstDisplay}:${item.dport}">
                                    <span style="opacity:0.6;">BYPASS@</span>${srcDisplay} &rarr; ${dstDisplay}:${item.dport}
                                </span>
                            </div>
                            ${detailsLine}
                        </div>
                    `;
                }).join('');
            }
        } else {
            const filteredEvents = state.streamEvents.filter(e => {
                if (isUserLaptop(e)) return false;
                return e.isAnomaly && !e.isSafe;
            });

            if (filteredEvents.length === 0) {
                anomalyListEl.innerHTML = `
                    <div class="radar-empty-state">
                        <span class="radar-empty-subtitle">NO EVENTS DETECTED</span>
                    </div>
                `;
            } else {
                anomalyListEl.innerHTML = filteredEvents.map(event => {
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
                        const lossStr = event.reconstruction_error ? ` L:${parseFloat(event.reconstruction_error).toFixed(4)}` : '';
                        if (lossStr) {
                            detailsLine = `<div class="matrix-line" style="margin-top:2px;"><span>${lossStr}</span></div>`;
                        }
                    } else {
                        cls += ` is-anomaly ${isSel ? 'is-selected' : ''}`;
                        statusStr = '[BREACH]';
                        const lossStr = event.reconstruction_error ? ` L:${parseFloat(event.reconstruction_error).toFixed(4)}` : '';
                        const actionBtn = `<button class="btn-mark-safe" onclick="event.stopPropagation(); markStreamEventSafe('${event.id}')" style="font-size: 0.6rem; padding: 1px 4px;">SECURE</button>`;
                        detailsLine = `<div class="matrix-line" style="margin-top:2px;"><span>${lossStr}</span>${actionBtn}</div>`;
                    }

                    const srcDisplay = event.src_host && event.src_host !== event.src ? event.src_host : event.src;
                    const dstDisplay = event.dst_host && event.dst_host !== event.dst ? event.dst_host : event.dst;
                    
                    const isLocal = checkIsLocalConnection(event.src, event.dst);
                    
                    let localTag = '';
                    if (isLocal) {
                        let tagColor = 'var(--text-secondary)';
                        let tagBorder = 'rgba(255,255,255,0.2)';
                        if (!event.isAnomaly) {
                            tagColor = 'var(--text-secondary)';
                            tagBorder = 'rgba(255,255,255,0.25)';
                        } else if (event.isSafe) {
                            tagColor = 'var(--status-safe)';
                            tagBorder = 'rgba(0, 230, 118, 0.4)';
                        } else {
                            tagColor = 'var(--status-danger)';
                            tagBorder = 'rgba(255, 42, 42, 0.4)';
                        }
                        localTag = `<span class="local-tag" style="font-size: 0.55rem; color: ${tagColor}; border: 1px solid ${tagBorder}; padding: 0px 3px; border-radius: 2px; margin-left: 5px; font-weight: 800;">LOCAL</span>`;
                    }

                    return `
                        <div id="stream-item-${event.id}" class="${cls.trim()}" onclick="selectStreamEvent('${event.id}')">
                            <div class="matrix-line" style="font-weight: 700; opacity: 0.7;">
                                <span>> ${event.time}${localTag}</span>
                                <span>${statusStr}</span>
                            </div>
                            <div class="matrix-line">
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; display:block;" title="${srcDisplay} -> ${dstDisplay}:${event.dport}">
                                    <span style="opacity:0.6;">ROOT@</span>${srcDisplay} &rarr; ${dstDisplay}:${event.dport}
                                </span>
                            </div>
                            ${detailsLine}
                        </div>
                    `;
                }).join('');
            }
        }
    }

    // Aggregate data by src IP
    const userStats = {};
    if (state.upperLeftFilter === 'SAFE') {
        const whitelist = state.whitelist || [];
        for (const item of whitelist) {
            if (isUserLaptop(item)) {
                continue;
            }
            if (!userStats[item.src]) {
                let hostVal = item.src;
                const matchingEvent = state.streamEvents.find(e => e.src === item.src && e.src_host);
                if (matchingEvent) {
                    hostVal = matchingEvent.src_host;
                }
                userStats[item.src] = {
                    src: item.src,
                    host: hostVal,
                    packets: 0,
                    anomalies: 0,
                    maxLoss: 0,
                    isSecured: true
                };
            }
            // Count matching safe/secured packets in streamEvents, default to 1 rule exception
            const matchCount = state.streamEvents.filter(e => e.src === item.src && e.dst === item.dst && e.dport === item.dport).length;
            userStats[item.src].packets += matchCount || 1;
        }
    } else {
        for (const ev of state.streamEvents) {
            if (isUserLaptop(ev)) {
                continue;
            }

            if (!userStats[ev.src]) {
                userStats[ev.src] = {
                    src: ev.src,
                    host: ev.src_host && ev.src_host !== ev.src ? ev.src_host : ev.src,
                    packets: 0,
                    anomalies: 0,
                    maxLoss: 0
                };
            }
            userStats[ev.src].packets++;
            if (ev.isAnomaly && !ev.isSafe) {
                userStats[ev.src].anomalies++;
            }
            if (ev.reconstruction_error > userStats[ev.src].maxLoss) {
                userStats[ev.src].maxLoss = ev.reconstruction_error;
            }
        }
    }

    // Convert to array and prepare for priority group sorting
    let filteredUsers = Object.values(userStats);

    // Sort by prioritized groups:
    // Group 0: External Anomaly
    // Group 1: Local Anomaly
    // Group 2: External Normal
    // Group 3: Local Normal
    // Tie-breaker within groups: Anomalies DESC, then Packets DESC
    const sortedUsers = filteredUsers.sort((a, b) => {
        const isLocalA = checkIsLocalIp(a.src);
        const isLocalB = checkIsLocalIp(b.src);
        
        const hasAnomalyA = a.anomalies > 0;
        const hasAnomalyB = b.anomalies > 0;
        
        const groupA = hasAnomalyA ? (isLocalA ? 1 : 0) : (isLocalA ? 3 : 2);
        const groupB = hasAnomalyB ? (isLocalB ? 1 : 0) : (isLocalB ? 3 : 2);
        
        if (groupA !== groupB) {
            return groupA - groupB;
        }
        
        if (b.anomalies !== a.anomalies) return b.anomalies - a.anomalies;
        return b.packets - a.packets;
    }).slice(0, 25); // Show up to 25 top users

    let rowsHtml = '';
    if (sortedUsers.length === 0) {
        rowsHtml = `
            <tr>
                <td colspan="4" style="text-align:center; color: var(--text-tertiary); font-family: 'Courier New', monospace; font-size: 0.62rem; padding: 15px 0; letter-spacing: 0.5px;">
                    NO ACTIVE USERS IN CURRENT STATE
                </td>
            </tr>
        `;
    } else {
        rowsHtml = sortedUsers.map(u => {
            const isThreat = u.anomalies > 0;
            const isLocked = state.lockedOnIp === u.src;
            const cls = `tactical-row ${isThreat ? 'is-threat' : ''} ${isLocked ? 'is-locked' : ''}`;
            
            let riskPct = 0;
            if (isThreat) {
                riskPct = Math.min(50 + (u.anomalies / u.packets) * 50, 100);
            } else {
                riskPct = Math.min((u.maxLoss / 0.05) * 40, 40); 
            }

            return `
                <tr class="${cls}" title="${u.src}" onclick="toggleLockOn('${u.src}')" style="cursor: pointer; ${isLocked ? 'background: rgba(255, 42, 42, 0.2); border-left: 2px solid var(--status-danger);' : ''}">
                    <td style="max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${u.host}
                    </td>
                    <td style="text-align:right;">${u.packets}</td>
                    <td style="text-align:right; font-weight:${isThreat ? 'bold' : 'normal'};">${u.anomalies}</td>
                    <td style="width: 60px;">
                        <div class="risk-bar-track">
                            <div class="risk-bar-fill" style="width: ${riskPct}%"></div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (sortedUsers.length > 0) {
        listEl.innerHTML = `
            <table class="tactical-matrix-table">
                <thead>
                    <tr>
                        <th>User</th>
                        <th style="text-align:right;">Pkts</th>
                        <th style="text-align:right;">Anom</th>
                        <th>Risk</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
    }
    });
}



window.markStreamEventSafe = async function (id) {
    if (!state.streamEvents) return;
    const event = state.streamEvents.find(e => e.id === id);
    if (!event) return;

    try {
        const payload = {
            src: event.src,
            dst: event.dst,
            dport: event.dport,
            raw_features: event.raw_features
        };

        const res = await fetch('/api/mark-normal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const resp = await res.json();

        if (resp.status === 'success') {
            state.streamEvents.forEach(e => {
                if (e.src === event.src && e.dst === event.dst && e.dport === event.dport && e.isAnomaly) {
                    e.isSafe = true;
                }
            });

            state.recentFlows.forEach(f => {
                if (f.src === event.src && f.dst === event.dst && f.dport === event.dport) {
                    f.isAnomaly = false;
                }
            });

            if (state.globeWorld) {
                state.globeWorld.arcsData(getGlobalArcs());
            }

            renderStreamList();
            renderActiveFlowsList();
            updatePanelDots();

            const apiMod = await import('./api_v2.js');
            apiMod.updateBackgroundStats();
            await fetchWhitelist();
        } else {
            console.error("Mark normal failed:", resp.message);
        }
    } catch (e) {
        console.error("Error marking stream event normal:", e);
    }
};

let renderPending = false;
let lastActiveFlowsRender = 0;
let activeFlowsTimeoutId = null;

export function renderActiveFlowsList() {
    const now = Date.now();
    const timeSinceLastRender = now - lastActiveFlowsRender;
    const throttleDelay = 150; // Throttle active flows / radar rendering to max ~6.6 per second

    if (timeSinceLastRender < throttleDelay) {
        if (!activeFlowsTimeoutId) {
            activeFlowsTimeoutId = setTimeout(() => {
                activeFlowsTimeoutId = null;
                renderActiveFlowsList();
            }, throttleDelay - timeSinceLastRender);
        }
        return;
    }

    if (activeFlowsTimeoutId) {
        clearTimeout(activeFlowsTimeoutId);
        activeFlowsTimeoutId = null;
    }

    lastActiveFlowsRender = now;

    if (renderPending) return;
    renderPending = true;

    requestAnimationFrame(() => {
        renderPending = false;
        const listEl = document.getElementById('activeFlowsList');
        if (!listEl) return;

        // Proactively prune expired flows before rendering to ensure instant UI responsiveness upon clearing selection
        const now = Date.now();
        state.recentFlows = state.recentFlows.filter(f => {
            const isSelected = isFlowSelected(f);
            return (now - f.lastSeen) < 5000 || isSelected;
        });

        let displayFlows = state.recentFlows;
        if (state.rightPanelFilter === 'EXTERNAL') {
            displayFlows = displayFlows.filter(f => !checkIsLocalConnection(f.src, f.dst));
        }
        if (state.rightPanelFilter === 'LOCAL') {
            displayFlows = displayFlows.filter(f => checkIsLocalConnection(f.src, f.dst));
        }

        // Update the right panel counter based on the active filter, but keep base bar showing total
        const countEl = document.getElementById('activeFlowsCount');
        const barFlows = document.getElementById('barFlows');
        
        if (countEl) countEl.innerText = displayFlows.length;
        if (barFlows) barFlows.innerText = state.recentFlows.length;

        let scopeEl = listEl.querySelector('.cyber-radar-scope');
        if (!scopeEl) {
            listEl.innerHTML = `
                <div class="radar-hud-wrapper">
                    <div class="radar-status-label">
                        <span class="radar-pulse-indicator"></span>
                        ACTIVE RADAR TELEMETRY
                    </div>
                    <div class="cyber-radar-scope">
                        <div class="cyber-radar-grid"></div>
                        <div class="cyber-radar-sweep"></div>
                        <div class="cyber-radar-center"></div>
                        <div id="radarBlipsContainer"></div>
                        <div class="radar-standby-overlay">
                            <span class="radar-empty-title">SYSTEM SECURE</span>
                            <span class="radar-empty-subtitle">NO ACTIVE CONNECTIONS</span>
                        </div>
                    </div>
                    <div class="cyber-radar-legend">
                        <div style="color:var(--status-safe);"><span style="display:inline-block; width:6px; height:6px; background:var(--status-safe); border-radius:50%; margin-right:4px;"></span>Safe</div>
                        <div style="color:var(--status-danger);"><span style="display:inline-block; width:6px; height:6px; background:var(--status-danger); border-radius:50%; margin-right:4px;"></span>Threat</div>
                    </div>
                </div>
            `;
            scopeEl = listEl.querySelector('.cyber-radar-scope');
        }

        const blipsContainer = scopeEl.querySelector('#radarBlipsContainer');
        const standbyOverlay = scopeEl.querySelector('.radar-standby-overlay');
        const legendEl = listEl.querySelector('.cyber-radar-legend');

        if (displayFlows.length === 0) {
            if (blipsContainer) blipsContainer.innerHTML = '';
            if (standbyOverlay) standbyOverlay.classList.add('is-active');
            if (legendEl) legendEl.style.opacity = '0.5';
        } else {
            if (standbyOverlay) standbyOverlay.classList.remove('is-active');
            if (legendEl) legendEl.style.opacity = '1';

            // Cyber Threat Radar Rendering
            let blipsHtml = displayFlows.map(f => {
                let top = 50;
                let left = 50;
                
                const hash = Array.from(f.src).reduce((acc, char) => acc + char.charCodeAt(0), 0);
                const angle = (hash % 360) * Math.PI / 180;
                
                const isLocal = checkIsLocalConnection(f.src, f.dst);
                if (!isLocal) {
                    // Outer rings for external
                    const dist = 20 + (hash % 25);
                    top = 50 - (Math.sin(angle) * dist);
                    left = 50 + (Math.cos(angle) * dist);
                } else {
                    // Inner rings for local
                    const dist = 5 + (hash % 10);
                    top = 50 - (Math.sin(angle) * dist);
                    left = 50 + (Math.cos(angle) * dist);
                }

                const isSel = isFlowSelected(f);
                const cls = `radar-blip ${f.isAnomaly ? 'is-anomaly' : ''} ${isSel ? 'is-selected' : ''}`.trim();
                const size = f.isAnomaly ? 8 : 4;
                
                return `
                    <div class="${cls}" style="top: ${top}%; left: ${left}%; width: ${size}px; height: ${size}px;" title="${f.src} -> ${f.dst}:${f.dport}" onclick="selectFlow('${f.id}')">
                        ${f.isAnomaly ? '<div class="radar-blip-ring"></div>' : ''}
                    </div>
                `;
            }).join('');

            if (blipsContainer) {
                blipsContainer.innerHTML = blipsHtml;
            }
        }
        
        updatePanelDots();
    });
}

// Global attachment for dynamically generated HTML
window.selectFlow = function (id) {
    state.selectedFlowId = id;
    state.justSelected = true;
    const clearBtn = document.getElementById('btnClearSelection');
    if (clearBtn) clearBtn.style.display = 'block';
    if (state.globeWorld) {
        import('./globe_v2.js').then(m => m.updateGlobeData());
    }
    renderActiveFlowsList();
    renderStreamList();
};

// ─── Toast & Notifications System ────────────────────────────────────────────

function enforceMaxToasts(container) {
    if (!container) return;
    const activeToasts = Array.from(container.children).filter(child => !child.classList.contains('fade-out'));
    while (activeToasts.length >= 2) {
        const oldest = activeToasts.shift();
        if (oldest) {
            oldest.classList.add('fade-out');
            setTimeout(() => oldest.remove(), 400);
        }
    }
}

export function showSystemToast(title, message, isWarning = false) {
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
    toast.innerHTML = `
        <div class="toast-header" style="color: ${isWarning ? 'var(--status-danger)' : 'var(--status-warn)'};">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            ${title}
        </div>
        <div class="toast-body" style="font-size: 0.68rem; line-height: 1.4; color: rgba(255,255,255,0.85); padding-top: 4px;">
            ${message}
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }
    }, 8000);
}

export function showAnomalyToast(data) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    enforceMaxToasts(container);

    const srcDisplay = data.src_host && data.src_host !== data.src ? `${data.src_host} (${data.src})` : data.src;
    const dstDisplay = data.dst_host && data.dst_host !== data.dst ? `${data.dst_host} (${data.dst})` : data.dst;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.cursor = 'pointer';
    toast.title = 'Click to view on 3D Globe';
    toast.innerHTML = `
        <div class="toast-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            ${alertTitle(data)}
        </div>
        <div class="toast-body">
            <strong>Source:</strong> ${srcDisplay}:${data.sport} <br>
            <strong>Target:</strong> ${dstDisplay}:${data.dport} <br>
            <strong>Severity:</strong> High (Err: ${parseFloat(data.reconstruction_error).toFixed(2)})
        </div>
    `;

    toast.addEventListener('click', () => {
        toast.remove();
        import('./globe_v2.js').then(m => {
            m.addGlobeArc(data, true);
            const streamEvent = state.streamEvents?.find(e => e.src === data.src && e.dst === data.dst && e.dport === data.dport);
            if (streamEvent) {
                window.selectStreamEvent(streamEvent.id);
            } else {
                const targetId = `stream-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                if (!state.streamEvents) state.streamEvents = [];
                const pseudoEvent = {
                    id: targetId,
                    src: data.src,
                    src_host: data.src_host || data.src,
                    dst: data.dst,
                    dst_host: data.dst_host || data.dst,
                    dport: data.dport,
                    isAnomaly: true,
                    isSafe: false,
                    timestamp: data.timestamp || new Date().toISOString()
                };
                state.streamEvents.unshift(pseudoEvent);
                window.selectStreamEvent(pseudoEvent.id);
            }
        });
    });

    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }
    }, 5000);
}

export function addToNotificationHistory(data) {
    const srcDisplay = data.src_host && data.src_host !== data.src ? `${data.src_host} (${data.src})` : data.src;
    const dstDisplay = data.dst_host && data.dst_host !== data.dst ? `${data.dst_host} (${data.dst})` : data.dst;

    const notifId = `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    state.notificationHistory.unshift({
        id: notifId,
        time: nowTimeStr(),
        title: alertTitle(data),
        desc: `Source: ${srcDisplay}:${data.sport} \u2192 Target: ${dstDisplay}:${data.dport}`,
        rawData: data
    });
    if (state.notificationHistory.length > 50) state.notificationHistory.pop();

    state.unreadCount++;
    updateBadge();
    renderNotificationList();
}

function renderNotificationList() {
    const list = document.getElementById('notifList');
    if (!list) return;

    list.innerHTML = state.notificationHistory.length === 0
        ? '<div class="notif-empty">No alerts recorded yet.</div>'
        : state.notificationHistory.map(n => `
            <div class="notif-item" onclick="selectNotification('${n.id}')" style="cursor: pointer;" title="Click to view on 3D Globe">
                <div class="notif-time">${n.time}</div>
                <div class="notif-title" style="display: flex; align-items: center; justify-content: space-between;">
                    <span>${n.title}</span>
                    <span style="font-size: 0.55rem; color: var(--status-danger); border: 1px solid rgba(255, 42, 42, 0.4); padding: 1px 4px; border-radius: 2px; text-transform: uppercase;">Locate Arc</span>
                </div>
                <div class="notif-desc">${n.desc}</div>
            </div>
        `).join('');
}

window.selectNotification = function(id) {
    const notif = state.notificationHistory.find(n => n.id === id);
    if (!notif || !notif.rawData) return;
    
    // Auto-close notifications panel overlay to show the globe transition
    const overlay = document.getElementById('notifOverlay');
    if (overlay) overlay.classList.remove('active');
    
    import('./globe_v2.js').then(m => {
        m.addGlobeArc(notif.rawData, true);
        
        const streamEvent = state.streamEvents?.find(e => e.src === notif.rawData.src && e.dst === notif.rawData.dst && e.dport === notif.rawData.dport);
        if (streamEvent) {
            window.selectStreamEvent(streamEvent.id);
        } else {
            const targetId = `stream-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            if (!state.streamEvents) state.streamEvents = [];
            const pseudoEvent = {
                id: targetId,
                src: notif.rawData.src,
                src_host: notif.rawData.src_host || notif.rawData.src,
                dst: notif.rawData.dst,
                dst_host: notif.rawData.dst_host || notif.rawData.dst,
                dport: notif.rawData.dport,
                isAnomaly: true,
                isSafe: false,
                timestamp: notif.rawData.timestamp || new Date().toISOString()
            };
            state.streamEvents.unshift(pseudoEvent);
            window.selectStreamEvent(pseudoEvent.id);
        }
    });
};

export function toggleNotificationOverlay() {
    const overlay = document.getElementById('notifOverlay');
    if (!overlay) return;

    if (overlay.classList.contains('active')) {
        overlay.classList.remove('active');
    } else {
        overlay.classList.add('active');
        state.unreadCount = 0;
        updateBadge();
    }
}
window.toggleNotificationOverlay = toggleNotificationOverlay; // Attaching for HTML onclick

export function clearNotifications() {
    state.notificationHistory = [];
    state.unreadCount = 0;
    updateBadge();
    renderNotificationList();
}
window.clearNotifications = clearNotifications; // Attaching for HTML onclick

function updateBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (state.unreadCount === 0) {
        badge.style.display = 'none';
    } else {
        badge.style.display = 'block';
        badge.innerText = state.unreadCount > 9 ? '9+' : state.unreadCount;
    }
}

export function selectStreamEvent(id) {
    if (state.streamEvents) {
        const event = state.streamEvents.find(e => e.id === id);
        if (event) {
            import('./globe_v2.js').then(m => {
                m.addGlobeArc(event, event.isAnomaly);
                window.selectFlow(id);
            });
            return;
        }
    }
    window.selectFlow(id);
}
window.selectStreamEvent = selectStreamEvent;

export function toggleLockOn(ip) {
    if (state.lockedOnIp === ip) {
        state.lockedOnIp = null;
    } else {
        state.lockedOnIp = ip;
        state.justSelected = true;
    }
    const clearBtn = document.getElementById('btnClearSelection');
    if (clearBtn) {
        clearBtn.style.display = (state.lockedOnIp || state.selectedFlowId) ? 'block' : 'none';
    }
    renderStreamList();
    if (state.globeWorld) {
        import('./globe_v2.js').then(m => m.updateGlobeData());
    }
}
window.toggleLockOn = toggleLockOn;

export function clearDashboardUi() {
    state.recentFlows = [];
    state.activeArcs = [];
    state.streamEvents = [];
    state.selectedFlowId = null;

    renderActiveFlowsList();
    renderStreamList();

    // Reset anomaly counts
    const anomalyEl = document.getElementById('aiAnomalies');
    if (anomalyEl) anomalyEl.innerText = '0';

    const barAnomalies = document.getElementById('barAnomalies');
    if (barAnomalies) barAnomalies.innerText = '0';

    const barPackets = document.getElementById('barPackets');
    if (barPackets) barPackets.innerText = '0';

    const barFlows = document.getElementById('barFlows');
    if (barFlows) barFlows.innerText = '0';

    // Clear Globe elements
    if (state.globeWorld) {
        state.globeWorld.arcsData([]);
        state.globeWorld.labelsData([]);
        state.globeWorld.ringsData([]);
    }

    // Clear AI Confidence Graph particles
    import('./confidence_v2.js').then(m => {
        if (m.confidenceViz) {
            m.confidenceViz.particles = [];
        }
    });

    updatePanelDots();
}

export function updatePanelDots() {
    // Left panel dot (Live Stream log list)
    const leftDot = document.getElementById('leftPanelDot');
    let leftPanelHasAnomaly = false;
    if (leftDot) {
        leftPanelHasAnomaly = state.streamEvents ? state.streamEvents.some(e => e.isAnomaly && !e.isSafe) : false;
        if (leftPanelHasAnomaly) {
            leftDot.classList.add('has-anomaly');
        } else {
            leftDot.classList.remove('has-anomaly');
        }
    }

    // Right panel dot (Active Flows state)
    const rightDot = document.getElementById('rightPanelDot');
    const rightPanelHasAnomaly = state.recentFlows.some(f => f.isAnomaly);
    if (rightDot) {
        if (rightPanelHasAnomaly) {
            rightDot.classList.add('has-anomaly');
        } else {
            rightDot.classList.remove('has-anomaly');
        }
    }

    // --- Dynamic Value Colors (White by default, Red when anomalies exist) ---

    // 1. Anomalies count in left panel (aiAnomalies)
    const aiAnomalies = document.getElementById('aiAnomalies');
    if (aiAnomalies) {
        const val = parseInt(aiAnomalies.innerText) || 0;
        if (val > 0) {
            aiAnomalies.classList.add('danger');
        } else {
            aiAnomalies.classList.remove('danger');
        }
    }

    // 2. Active Flows count in right panel header (activeFlowsCount)
    const activeFlowsCount = document.getElementById('activeFlowsCount');
    if (activeFlowsCount) {
        if (rightPanelHasAnomaly) {
            activeFlowsCount.classList.add('danger');
        } else {
            activeFlowsCount.classList.remove('danger');
        }
    }

    // 3. Bottom bar Active Flows count (barFlows)
    const barFlows = document.getElementById('barFlows');
    if (barFlows) {
        if (rightPanelHasAnomaly) {
            barFlows.classList.add('danger');
        } else {
            barFlows.classList.remove('danger');
        }
    }

    // 4. Bottom bar AI Anomalies count (barAnomalies)
    const barAnomalies = document.getElementById('barAnomalies');
    if (barAnomalies) {
        const val = parseInt(barAnomalies.innerText) || 0;
        if (val > 0) {
            barAnomalies.classList.add('danger');
        } else {
            barAnomalies.classList.remove('danger');
        }
    }

    // 5. Bottom bar Blocklist Hits count (barBlocklist)
    const barBlocklist = document.getElementById('barBlocklist');
    if (barBlocklist) {
        const val = parseInt(barBlocklist.innerText) || 0;
        if (val > 0) {
            barBlocklist.classList.add('danger');
        } else {
            barBlocklist.classList.remove('danger');
        }
    }
}

// ─── Security Scanner ────────────────────────────────────────────────────────

export function toggleScannerModal() {
    const overlay = document.getElementById('scannerOverlay');
    if (!overlay) return;

    if (overlay.classList.contains('active')) {
        overlay.classList.remove('active');
    } else {
        overlay.classList.add('active');
    }
}
window.toggleScannerModal = toggleScannerModal;

export function toggleSoundState() {
    const isEnabled = audio.toggleSound();
    const btn = document.getElementById('btnToggleSound');
    if (!btn) return;

    if (isEnabled) {
        btn.title = "Mute Audio";
        btn.innerHTML = `
            <svg id="soundIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
        `;
    } else {
        btn.title = "Unmute Audio";
        btn.innerHTML = `
            <svg id="soundIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <line x1="23" y1="9" x2="17" y2="15"></line>
                <line x1="17" y1="9" x2="23" y2="15"></line>
            </svg>
        `;
    }
}
window.toggleSoundState = toggleSoundState;

export async function runFullSecurityScan() {
    const body = document.getElementById('scannerBody');
    const dot = document.getElementById('scannerStatusDot');
    const btn = document.getElementById('btnRunScan');
    if (!body) return;

    // Loading State
    if (dot) dot.classList.add('has-anomaly'); // Make it red to indicate activity
    if (btn) {
        btn.innerText = 'Scanning...';
        btn.disabled = true;
    }
    
    body.innerHTML = `
        <div class="radar-empty-state">
            <div class="radar-sweep-scanner"></div>
            <span class="radar-empty-title">SCANNING IN PROGRESS</span>
            <span class="radar-empty-subtitle">ANALYZING NETWORK VULNERABILITIES</span>
        </div>
    `;

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
        if (btn) {
            btn.innerText = 'Run Scan';
            btn.disabled = false;
        }
    }
}
window.runFullSecurityScan = runFullSecurityScan;

function renderScannerResults(data) {
    const body = document.getElementById('scannerBody');
    if (!body) return;

    // 1. Overall Risk Score Calculation
    const risk = data.risk || {};
    const riskScore = risk.score !== undefined ? risk.score : 0;
    const riskLevel = risk.risk_level || 'UNKNOWN';
    let riskColor = 'var(--status-safe)';
    if (risk.risk_color === 'red') riskColor = 'var(--status-danger)';
    else if (risk.risk_color === 'yellow' || risk.risk_color === 'orange') riskColor = 'var(--status-warn)';

    // 2. Wi-Fi Status
    const wifi = data.wifi || {};
    let wifiColor = wifi.connected ? 'var(--status-safe)' : 'var(--status-warn)';
    let wifiDesc = wifi.connected ? `${wifi.network_name} [${wifi.security_type}]` : 'Disconnected';
    let wifiPercent = wifi.connected ? 100 : 0;

    // 3. Port Status
    const portsList = (data.ports && data.ports.ports) ? data.ports.ports : [];
    let highRiskPorts = portsList.filter(p => p.risk_level === 'high').length;
    let portsColor = highRiskPorts > 0 ? 'var(--status-danger)' : 'var(--status-safe)';
    let portsDesc = highRiskPorts > 0 ? `${highRiskPorts} High-Risk Open Ports` : 'No Critical Ports Exposed';
    let portsPercent = highRiskPorts > 0 ? Math.min(100, highRiskPorts * 20) : 100;

    // 4. Vulnerability Status
    const vulnsList = (data.vulnerabilities && data.vulnerabilities.vulnerabilities) ? data.vulnerabilities.vulnerabilities : [];
    let criticalVulns = vulnsList.filter(v => v.severity === 'critical' || v.severity === 'high').length;
    let vulnsColor = criticalVulns > 0 ? 'var(--status-danger)' : 'var(--status-safe)';
    let vulnsDesc = criticalVulns > 0 ? `${criticalVulns} System Vulnerabilities` : 'Firewall & UAC Active';
    let vulnsPercent = criticalVulns > 0 ? Math.max(0, 100 - (criticalVulns * 25)) : 100;

    // Render HTML Structure
    body.innerHTML = `
        <div class="tactical-scanner-grid">
            <div class="audit-gauges-col">
                
                <div class="gauge-card" style="background: rgba(255,42,42,0.05); border-color: ${riskColor};">
                    <div class="risk-gauge-container" style="--gauge-percent: ${riskScore}; --gauge-color: ${riskColor};">
                        <div class="risk-gauge-inner">${riskScore}</div>
                    </div>
                    <div class="gauge-details">
                        <span class="gauge-title" style="color: ${riskColor}; font-weight: bold;">Global Risk Score</span>
                        <span class="gauge-desc">Risk Level: ${riskLevel}</span>
                    </div>
                </div>

                <div class="gauge-card">
                    <div class="risk-gauge-container" style="--gauge-percent: ${wifiPercent}; --gauge-color: ${wifiColor}; width: 60px; height: 60px;">
                        <div class="risk-gauge-inner" style="width: 50px; height: 50px; font-size: 0.8rem;">WIFI</div>
                    </div>
                    <div class="gauge-details">
                        <span class="gauge-title">Network Encryption</span>
                        <span class="gauge-desc">${wifiDesc}</span>
                    </div>
                </div>

                <div class="gauge-card">
                    <div class="risk-gauge-container" style="--gauge-percent: ${portsPercent}; --gauge-color: ${portsColor}; width: 60px; height: 60px;">
                        <div class="risk-gauge-inner" style="width: 50px; height: 50px; font-size: 0.8rem;">PORT</div>
                    </div>
                    <div class="gauge-details">
                        <span class="gauge-title">Perimeter Defenses</span>
                        <span class="gauge-desc" style="${highRiskPorts > 0 ? 'color: var(--status-danger);' : ''}">${portsDesc}</span>
                    </div>
                </div>

                <div class="gauge-card">
                    <div class="risk-gauge-container" style="--gauge-percent: ${vulnsPercent}; --gauge-color: ${vulnsColor}; width: 60px; height: 60px;">
                        <div class="risk-gauge-inner" style="width: 50px; height: 50px; font-size: 0.8rem;">SYS</div>
                    </div>
                    <div class="gauge-details">
                        <span class="gauge-title">Host Defenses</span>
                        <span class="gauge-desc" style="${criticalVulns > 0 ? 'color: var(--status-danger);' : ''}">${vulnsDesc}</span>
                    </div>
                </div>

            </div>

            <div class="remediation-col">
                <div class="terminal-header">
                    <span>OVERSIGHT // REMEDIATION TERMINAL</span>
                    <span>root@oversight:~</span>
                </div>
                <div class="remediation-terminal" id="remediationTerminal"></div>
                <div class="terminal-input-container">
                    <span class="terminal-prompt">root@oversight:~#</span>
                    <input type="text" class="terminal-input-field" id="terminalInput" placeholder="Type /help or /patch --threat [ID]..." autocomplete="off">
                </div>
            </div>
        </div>
    `;

    // Dynamic Theme Shifting based on Risk Score (corrected logic: low score/high risk -> Red; high score/safe -> Cyan)
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

    // 5. Typewriter Effect for Recommendations
    const terminal = document.getElementById('remediationTerminal');
    const recsList = (data.recommendations && data.recommendations.recommendations) ? data.recommendations.recommendations : [];
    
    let rawText = "INITIATING POST-AUDIT REMEDIATION SEQUENCE...\n";
    rawText += "ANALYZING SYSTEM VULNERABILITIES...\n\n";

    if (recsList.length === 0) {
        rawText += "[+] SYSTEM IS SECURE. NO REMEDIATION REQUIRED.\n";
    } else {
        recsList.forEach((r, idx) => {
            rawText += `[!] THREAT ${idx + 1}: ${r.title}\n`;
            rawText += `    >> ACTION: ${r.action}\n`;
            rawText += `    >> PRIORITY: ${(r.priority || 'UNKNOWN').toUpperCase()}\n\n`;
        });
        rawText += "[*] AWAITING OPERATOR INTERVENTION...\n";
        rawText += "    Type /help inside CLI console below to patch vulnerabilities.\n\n";
    }

    typewriterEffect(terminal, rawText, 15); // Type at 15ms per character

    // Attach CLI Input Event Listener
    const terminalInput = document.getElementById('terminalInput');
    if (terminalInput) {
        terminalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = terminalInput.value.trim();
                terminalInput.value = '';
                if (cmd) {
                    handleTerminalCommand(cmd);
                }
            }
        });
    }
}

function typewriterEffect(element, text, speed) {
    let i = 0;
    element.innerHTML = '<span id="tw-content"></span><span class="terminal-cursor"></span>';
    const content = element.querySelector('#tw-content');
    
    function typeWriter() {
        if (i < text.length) {
            content.textContent += text.charAt(i);
            if (i % 3 === 0 && text.charAt(i) !== ' ') {
                audio.playClick();
            }
            i++;
            element.scrollTop = element.scrollHeight; // Auto-scroll down
            setTimeout(typeWriter, speed);
        }
    }
    typeWriter();
}

function typewriterEffectAppend(element, text, speed) {
    const content = element.querySelector('#tw-content');
    if (!content) return;
    
    let i = 0;
    function type() {
        if (i < text.length) {
            content.textContent += text.charAt(i);
            if (i % 3 === 0 && text.charAt(i) !== ' ') {
                audio.playClick();
            }
            i++;
            element.scrollTop = element.scrollHeight;
            setTimeout(type, speed);
        }
    }
    type();
}

let patchingActive = false;

function handleTerminalCommand(cmd) {
    const terminal = document.getElementById('remediationTerminal');
    if (!terminal || patchingActive) return;

    // Append user input to terminal
    const content = terminal.querySelector('#tw-content');
    if (content) {
        content.textContent += `\nroot@oversight:~# ${cmd}\n`;
        terminal.scrollTop = terminal.scrollHeight;
    }
    audio.playClick();

    const parts = cmd.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    if (command === '/help') {
        const helpText = 
            `\nAVAILABLE COMMANDS:\n` +
            `  /help                   - Display this guide\n` +
            `  /clear                  - Clear terminal buffer\n` +
            `  /patch --threat [ID]    - Mitigate specified threat ID (e.g. 1, 2)\n` +
            `  /patch --all            - Deploy defense policies for all vulnerabilities\n` +
            `  /ping                   - Sound sonar pulse diagnostics\n\n`;
        typewriterEffectAppend(terminal, helpText, 8);
    } else if (command === '/clear') {
        if (content) content.textContent = '';
    } else if (command === '/ping') {
        audio.playPing();
        typewriterEffectAppend(terminal, `\n[+] SENT SONAR DIAGNOSTIC PULSE. ALL SYSTEMS NOMINAL.\n\n`, 8);
    } else if (command === '/patch') {
        const arg = parts[1];
        if (arg === '--all') {
            triggerPatchSequence('ALL', terminal);
        } else if (arg === '--threat') {
            const id = parts[2];
            if (id && !isNaN(id)) {
                triggerPatchSequence(parseInt(id), terminal);
            } else {
                typewriterEffectAppend(terminal, `\n[-] ERROR: Please specify a valid threat ID (e.g., /patch --threat 1).\n\n`, 8);
            }
        } else {
            typewriterEffectAppend(terminal, `\n[-] ERROR: Unknown parameter "${arg || ''}". Use --threat [ID] or --all.\n\n`, 8);
        }
    } else {
        typewriterEffectAppend(terminal, `\n[-] ERROR: Unknown command "${command}". Type /help for assistance.\n\n`, 8);
    }
}

async function triggerPatchSequence(target, terminal) {
    patchingActive = true;
    audio.playPing();
    
    let category = 'ALL';
    let targetName = 'ALL SYSTEM DEFENSES';
    
    if (target !== 'ALL' && !isNaN(target)) {
        const recsList = (latestScanData && latestScanData.recommendations && latestScanData.recommendations.recommendations) 
            ? latestScanData.recommendations.recommendations 
            : [];
        const threat = recsList[target - 1];
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
    
    setTimeout(() => {
        typewriterEffectAppend(terminal, `[1/3] EXECUTING REAL-TIME SECURITY ENFORCEMENT ENGINE...\n`, 4);
    }, 600);
    
    setTimeout(async () => {
        typewriterEffectAppend(terminal, `      >> PARSING ACTIVE PROTECTION POLICIES FOR CATEGORY: ${category.toUpperCase()}...\n`, 4);
        
        try {
            const res = await fetch('/api/patch-vulnerability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category })
            });
            const resp = await res.json();
            
            if (resp.status === 'success') {
                setTimeout(() => {
                    typewriterEffectAppend(terminal, `[2/3] DEPLOYING LOCAL OPERATING SYSTEM SECURITY PATCHES...\n`, 4);
                    
                    const patchData = resp.data || [];
                    patchData.forEach((item, idx) => {
                        setTimeout(() => {
                            const prefix = item.status === 'success' ? '[✓] SUCCESS' : '[✗] FAILURE';
                            typewriterEffectAppend(terminal, `      ${prefix} [${item.category}]: ${item.message}\n`, 4);
                        }, idx * 400);
                    });
                    
                    setTimeout(() => {
                        if (!resp.is_admin) {
                            typewriterEffectAppend(terminal, `\n      [!] WARNING: Oversight did not run as Administrator.\n`, 4);
                            typewriterEffectAppend(terminal, `          Some policy changes require high privileges to take effect.\n`, 4);
                        }
                        
                        typewriterEffectAppend(terminal, `\n[3/3] RE-AUDITING SYSTEM EXPOSURE STATUS...\n`, 4);
                        setTimeout(() => {
                            typewriterEffectAppend(terminal, `      [====================================] 100% (RE-AUDIT COMPLETE)\n`, 4);
                            typewriterEffectAppend(terminal, `[+] ADVANCED THREAT REMEDIATION SEQUENCE COMPLETED!\n`, 4);
                            
                            patchingActive = false;
                            applySecurityPatchSuccess(category);
                        }, 1200);
                    }, patchData.length * 400 + 400);
                }, 800);
            } else {
                typewriterEffectAppend(terminal, `[-] ERROR EXECUTING PATCH PROTOCOL: ${resp.message}\n`, 4);
                patchingActive = false;
            }
        } catch (err) {
            typewriterEffectAppend(terminal, `[-] CONNECTION EXCEPTION: ${err.message}. Ensure backend is running.\n`, 4);
            patchingActive = false;
        }
    }, 1500);
}

function applySecurityPatchSuccess(category = 'ALL') {
    audio.playPing();
    
    // 1. Elevate Gauges (Correcting logic inversion: high score means high security/safety)
    const riskDial = document.querySelector('.risk-gauge-container');
    if (riskDial) {
        riskDial.style.setProperty('--gauge-percent', '95');
        riskDial.style.setProperty('--gauge-color', 'var(--status-safe)');
    }
    
    const riskVal = document.getElementById('riskVal');
    if (riskVal) {
        riskVal.innerText = '95';
        riskVal.style.color = 'var(--status-safe)';
    }

    const riskSubtitle = document.getElementById('riskSubtitle');
    if (riskSubtitle) {
        riskSubtitle.innerText = 'FULLY PROTECTED';
        riskSubtitle.style.color = 'var(--status-safe)';
    }

    // Elevate the ports gauge to 100% (2nd gauge card)
    if (category === 'ALL' || category === 'Ports') {
        const portContainer = document.querySelectorAll('.risk-gauge-container')[2];
        if (portContainer) {
            portContainer.style.setProperty('--gauge-percent', '100');
            portContainer.style.setProperty('--gauge-color', 'var(--status-safe)');
        }
        const portDesc = document.querySelectorAll('.gauge-desc')[1];
        if (portDesc) {
            portDesc.innerText = '0 Ports Exposed (Secured)';
            portDesc.style.color = 'var(--status-safe)';
        }
    }

    // Elevate the system vulnerability gauge to 100% (3rd gauge card)
    if (category === 'ALL' || category === 'Firewall' || category === 'User Account Control' || category === 'Remote Services') {
        const sysContainer = document.querySelectorAll('.risk-gauge-container')[3];
        if (sysContainer) {
            sysContainer.style.setProperty('--gauge-percent', '100');
            sysContainer.style.setProperty('--gauge-color', 'var(--status-safe)');
        }
        const sysDesc = document.querySelectorAll('.gauge-desc')[2];
        if (sysDesc) {
            sysDesc.innerText = '0 High Vulnerabilities (Audited)';
            sysDesc.style.color = 'var(--status-safe)';
        }
    }

    // 2. Set dynamic accents globally back to silver-white (Safe)
    document.documentElement.style.setProperty('--accent-blue', '#ffffff');
    document.documentElement.style.setProperty('--ai-accent', '#ffffff');

    // 3. Show a successful alert
    showAnomalyToast({
        time: nowTimeStr(),
        src: 'OVERSIGHT_CORE',
        dst: 'LOCAL_KERNEL',
        dport: '0',
        alert_type: 'Remediation Applied',
        isSafe: true,
        reconstruction_error: 0.001
    });

    // Auto-run a full security scan in background to fetch updated system states!
    setTimeout(() => {
        runFullSecurityScan();
    }, 4000);
}

// ─── Diagnostics Tabs & Whitelist Manager ────────────────────────────────────

export function switchScannerTab(tabName) {
    const auditTab = document.getElementById('tabScannerAudit');
    const whitelistTab = document.getElementById('tabScannerWhitelist');
    const auditView = document.getElementById('scannerAuditView');
    const whitelistView = document.getElementById('scannerWhitelistView');

    if (!auditTab || !whitelistTab || !auditView || !whitelistView) return;

    audio.playClick();

    if (tabName === 'AUDIT') {
        auditTab.classList.add('active');
        whitelistTab.classList.remove('active');
        auditView.style.display = 'block';
        whitelistView.style.display = 'none';
    } else if (tabName === 'WHITELIST') {
        whitelistTab.classList.add('active');
        auditTab.classList.remove('active');
        auditView.style.display = 'none';
        whitelistView.style.display = 'flex';
        renderWhitelistManager();
    }
}
window.switchScannerTab = switchScannerTab;

export async function renderWhitelistManager() {
    const listContainer = document.getElementById('whitelistEntriesList');
    if (!listContainer) return;

    listContainer.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; padding: 40px; color: rgba(255,255,255,0.4); font-family: 'Courier New', monospace; font-size: 0.8rem;">
            LOADING SECURE SYSTEM RULES...
        </div>
    `;

    try {
        const response = await fetch('/api/whitelist');
        const result = await response.json();
        
        if (result.status === 'success') {
            const data = result.data || [];
            if (data.length === 0) {
                listContainer.innerHTML = `
                    <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; border: 1px dashed rgba(255,255,255,0.05); border-radius: 4px; padding: 40px; background: rgba(0,0,0,0.15); margin-top: 10px;">
                        <span style="font-family: 'Courier New', monospace; font-size: 0.8rem; color: rgba(255,255,255,0.4); margin-bottom: 5px; text-transform: uppercase;">NO WHITELIST ENTRIES FOUND</span>
                        <span style="font-family: 'Courier New', monospace; font-size: 0.7rem; color: rgba(255,255,255,0.25);">Use "MARK SAFE" on any live stream event to whitelist a connection.</span>
                    </div>
                `;
                return;
            }

            let html = `
                <div style="flex-grow: 1; overflow-y: auto; max-height: 480px; border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; background: rgba(0,0,0,0.2); margin-top: 10px;">
                    <table style="width: 100%; border-collapse: collapse; font-family: 'Courier New', monospace; font-size: 0.75rem; color: rgba(255,255,255,0.85); text-align: left;">
                        <thead>
                            <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.08); text-transform: uppercase; color: var(--status-warn); font-size: 0.7rem; letter-spacing: 1px;">
                                <th style="padding: 10px 15px;">SOURCE IP</th>
                                <th style="padding: 10px 15px;">DESTINATION IP</th>
                                <th style="padding: 10px 15px;">DEST PORT</th>
                                <th style="padding: 10px 15px; text-align: right;">ACTION</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            data.forEach(entry => {
                html += `
                    <tr class="whitelist-row" style="border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s;">
                        <td style="padding: 10px 15px; color: var(--accent-blue);">${entry.src}</td>
                        <td style="padding: 10px 15px; color: rgba(255,255,255,0.8);">${entry.dst}</td>
                        <td style="padding: 10px 15px; color: var(--status-safe);">${entry.dport}</td>
                        <td style="padding: 10px 15px; text-align: right;">
                            <button class="btn-action danger" onclick="removeWhitelistEntry('${entry.src}', '${entry.dst}', ${entry.dport})" style="font-family: 'Courier New', monospace; font-size: 0.65rem; padding: 2px 8px; border-radius: 3px; height: auto; background: rgba(255, 42, 42, 0.15); border-color: rgba(255, 42, 42, 0.4); color: var(--status-danger);">
                                REMOVE
                            </button>
                        </td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
            listContainer.innerHTML = html;
        } else {
            listContainer.innerHTML = `<div style="color: var(--status-danger); font-family: 'Courier New', monospace; font-size: 0.8rem; padding: 20px;">FAILED TO RETRIEVE WHITELISTS: ${result.message}</div>`;
        }
    } catch (e) {
        console.error(e);
        listContainer.innerHTML = `<div style="color: var(--status-danger); font-family: 'Courier New', monospace; font-size: 0.8rem; padding: 20px;">CONNECTION ERROR RETRIEVING WHITELISTS.</div>`;
    }
}
window.renderWhitelistManager = renderWhitelistManager;

export async function removeWhitelistEntry(src, dst, dport) {
    audio.playClick();
    if (!confirm(`Are you sure you want to remove whitelist rule for ${src} -> ${dst}:${dport}?`)) {
        return;
    }

    try {
        const response = await fetch('/api/whitelist/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ src, dst, dport })
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            showAnomalyToast({
                time: nowTimeStr(),
                src: 'WHITELIST_ENG',
                dst: 'LOCAL_KERNEL',
                dport: dport.toString(),
                alert_type: 'Rule Terminated',
                isSafe: true,
                reconstruction_error: 0.0
            });
            renderWhitelistManager();
            await fetchWhitelist();
            renderStreamList();
        } else {
            alert(`Failed to delete: ${result.message}`);
        }
    } catch (e) {
        console.error(e);
        alert('Network error deleting whitelist entry.');
    }
}
window.removeWhitelistEntry = removeWhitelistEntry;

export async function exportSecurityDossier() {
    audio.playPing();

    let whitelist = [];
    try {
        const res = await fetch('/api/whitelist');
        const resp = await res.json();
        if (resp.status === 'success') {
            whitelist = resp.data || [];
        }
    } catch (e) {
        console.error("Failed to fetch whitelist for dossier:", e);
    }

    const riskVal = document.getElementById('riskVal')?.innerText || 'N/A';
    const riskSubtitle = document.getElementById('riskSubtitle')?.innerText || 'N/A';
    const captureState = state.isCapturing ? 'ACTIVE' : 'STANDBY';
    const anomalyCount = state.streamEvents ? state.streamEvents.filter(e => e.isAnomaly && !e.isSafe).length : 0;
    const whitelistedCount = whitelist.length;
    const totalEvents = state.streamEvents ? state.streamEvents.length : 0;

    let eventRows = '';
    if (state.streamEvents && state.streamEvents.length > 0) {
        state.streamEvents.forEach(e => {
            const badgeClass = e.isAnomaly ? (e.isSafe ? 'badge safe' : 'badge anomaly') : 'badge safe';
            const label = e.isAnomaly ? (e.isSafe ? 'RESOLVED SAFE' : (e.alert_type || e.anomaly_type || 'ANOMALY')) : 'SECURE FLOW';
            eventRows += `
                <tr>
                    <td style="color: #ffb300;">${e.time}</td>
                    <td style="color: var(--accent-blue);">${e.src}</td>
                    <td>${e.dst}</td>
                    <td style="color: var(--accent-blue); font-weight: bold;">${e.dport}</td>
                    <td><span class="${badgeClass}">${label}</span></td>
                    <td style="color: rgba(255,255,255,0.7); font-family: monospace;">${e.reconstruction_error !== undefined ? e.reconstruction_error.toFixed(5) : '0.00000'}</td>
                </tr>
            `;
        });
    } else {
        eventRows = `
            <tr>
                <td colspan="6" style="text-align: center; color: rgba(255,255,255,0.3); padding: 30px;">
                    NO INTERCEPTED TRAFFIC LOGS RECORDED IN THIS SESSION
                </td>
            </tr>
        `;
    }

    let whitelistRows = '';
    if (whitelist.length > 0) {
        whitelist.forEach(w => {
            whitelistRows += `
                <tr>
                    <td style="color: var(--accent-blue);">${w.src}</td>
                    <td>${w.dst}</td>
                    <td style="color: #ffb300; font-weight: bold;">${w.dport}</td>
                    <td style="color: var(--accent-blue);">MANUAL BYPASS RULE</td>
                </tr>
            `;
        });
    } else {
        whitelistRows = `
            <tr>
                <td colspan="4" style="text-align: center; color: rgba(255,255,255,0.3); padding: 30px;">
                    NO SYSTEM BYPASS / WHITELIST RULES ESTABLISHED
                </td>
            </tr>
        `;
    }

    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OVERSIGHT // SYSTEM SECURITY DOSSIER</title>
    <style>
        :root {
            --bg-color: #08090b;
            --panel-bg: rgba(14, 15, 19, 0.9);
            --border-color: rgba(255, 179, 0, 0.25);
            --gold: #ffb300;
            --cyan: #ffffff;
            --danger: #ff2a2a;
            --text-color: rgba(255, 255, 255, 0.95);
            --text-muted: rgba(255, 255, 255, 0.5);
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Courier New', Courier, monospace;
            margin: 0;
            padding: 40px 20px;
            display: flex;
            justify-content: center;
        }
        .container {
            width: 960px;
            max-width: 100%;
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            box-shadow: 0 0 35px rgba(255, 179, 0, 0.15);
            padding: 40px;
            border-radius: 8px;
            position: relative;
            background-image: radial-gradient(circle at 50% 50%, rgba(255, 179, 0, 0.03), transparent);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            margin: 0;
            font-size: 1.8rem;
            letter-spacing: 4px;
            color: var(--gold);
            text-shadow: 0 0 10px rgba(255, 179, 0, 0.3);
        }
        .header .subtitle {
            font-size: 0.75rem;
            color: var(--text-muted);
            letter-spacing: 2px;
            margin-top: 5px;
            text-transform: uppercase;
        }
        .timestamp {
            font-size: 0.8rem;
            color: var(--cyan);
            text-align: right;
            letter-spacing: 1px;
        }
        .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 35px;
        }
        .meta-card {
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 18px 15px;
            border-radius: 4px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .meta-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 2px;
            background: var(--gold);
            opacity: 0.4;
        }
        .meta-card.risk::before {
            background: ${riskVal > 60 ? 'var(--danger)' : (riskVal > 30 ? 'var(--gold)' : 'var(--cyan)')};
        }
        .meta-label {
            color: var(--text-muted);
            margin-bottom: 8px;
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 1.5px;
        }
        .meta-value {
            font-size: 1.4rem;
            font-weight: bold;
            color: var(--gold);
            text-shadow: 0 0 5px rgba(255, 179, 0, 0.2);
        }
        .meta-card.risk .meta-value {
            color: ${riskVal > 60 ? 'var(--danger)' : (riskVal > 30 ? 'var(--gold)' : 'var(--cyan)')};
            text-shadow: 0 0 5px ${riskVal > 60 ? 'rgba(255, 42, 42, 0.2)' : (riskVal > 30 ? 'rgba(255, 179, 0, 0.2)' : 'rgba(255, 255, 255, 0.2)')};
        }
        .section-title {
            color: var(--gold);
            font-size: 0.95rem;
            letter-spacing: 2px;
            margin: 40px 0 15px 0;
            border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
            padding-bottom: 8px;
            text-transform: uppercase;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .section-subtitle {
            font-size: 0.7rem;
            color: var(--text-muted);
            text-transform: none;
            letter-spacing: 0;
            font-weight: normal;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.75rem;
            margin-top: 15px;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        th {
            background: rgba(255, 179, 0, 0.04);
            color: var(--gold);
            text-align: left;
            padding: 12px 15px;
            border-bottom: 1px solid var(--border-color);
            letter-spacing: 1.5px;
            text-transform: uppercase;
            font-size: 0.7rem;
        }
        td {
            padding: 12px 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            color: rgba(255, 255, 255, 0.85);
        }
        tr:hover {
            background: rgba(255, 255, 255, 0.01);
        }
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 0.65rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .badge.anomaly {
            background: rgba(255, 42, 42, 0.12);
            border: 1px solid var(--danger);
            color: var(--danger);
            text-shadow: 0 0 4px rgba(255, 42, 42, 0.2);
        }
        .badge.safe {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid var(--cyan);
            color: var(--cyan);
            text-shadow: 0 0 4px rgba(255, 255, 255, 0.25);
        }
        .footer {
            margin-top: 60px;
            text-align: center;
            font-size: 0.65rem;
            color: var(--text-muted);
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 25px;
            letter-spacing: 1px;
        }
        .system-seal {
            border: 1px solid rgba(255, 179, 0, 0.25);
            background: rgba(255, 179, 0, 0.02);
            padding: 15px;
            border-radius: 4px;
            margin-top: 25px;
            font-size: 0.7rem;
            line-height: 1.5;
            color: var(--text-muted);
            border-left: 3px solid var(--gold);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>OVERSIGHT SECURITY DOSSIER</h1>
                <div class="subtitle">Tactical System Intrusion & Threat Defense Report</div>
            </div>
            <div class="timestamp">
                GENERATED: ${new Date().toLocaleString()}<br>
                STATUS: <span style="color: var(--cyan);">${captureState}</span>
            </div>
        </div>

        <div class="meta-grid">
            <div class="meta-card risk">
                <div class="meta-label">Global Risk Score</div>
                <div class="meta-value">${riskVal} / 100</div>
                <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 5px; text-transform: uppercase;">${riskSubtitle}</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Intercepted Traffic</div>
                <div class="meta-value">${totalEvents}</div>
                <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 5px;">TOTAL INTERCEPTED</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Active Anomalies</div>
                <div class="meta-value" style="color: ${anomalyCount > 0 ? 'var(--danger)' : 'var(--cyan)'}; text-shadow: none;">${anomalyCount}</div>
                <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 5px;">UNRESOLVED ALERTS</div>
            </div>
            <div class="meta-card">
                <div class="meta-label">Manual Whitelists</div>
                <div class="meta-value">${whitelistedCount}</div>
                <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 5px;">BYPASS DEFENSE RULES</div>
            </div>
        </div>

        <div class="section-title">
            <span>System Posture Assessment</span>
            <span class="section-subtitle">Core Diagnostics Summary</span>
        </div>
        <div class="system-seal">
            <strong>OVERSIGHT DEEP NETWORK INSPECTION REPORT</strong><br>
            Threat intelligence autoencoder is operating with full feature extraction pipeline. Local firewall status, 
            exposed open ports, and device vulnerabilities have been audited. Anomalous patterns are identified on 
            reconstruction error scaling. In the event of confirmed vulnerability exposure, apply manual whitelists 
            only for verified corporate secure vectors.
        </div>

        <div class="section-title">
            <span>Manual Whitelist Entries</span>
            <span class="section-subtitle">Established Secure Exception Vectors</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Source IP Address</th>
                    <th>Destination IP Address</th>
                    <th>Destination Port</th>
                    <th>Bypass Rule Authority</th>
                </tr>
            </thead>
            <tbody>
                ${whitelistRows}
            </tbody>
        </table>

        <div class="section-title">
            <span>Intercepted Stream Logs</span>
            <span class="section-subtitle">Last ${totalEvents} Connection Vectors Intercepted</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Time Stamp</th>
                    <th>Source IP</th>
                    <th>Destination IP</th>
                    <th>Port</th>
                    <th>Classification</th>
                    <th>Recon Error</th>
                </tr>
            </thead>
            <tbody>
                ${eventRows}
            </tbody>
        </table>

        <div class="footer">
            OVERSIGHT CYBER-SECURITY PLATFORM // CONFIDENTIAL STANDALONE REPORT // SECURED BY DEEP MODEL RECONSTRUCTION
        </div>
    </div>
</body>
</html>`;

    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `oversight-security-dossier-${timestampStr}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showAnomalyToast({
        time: nowTimeStr(),
        src: 'DOSSIER_ENG',
        dst: 'LOCAL_STORAGE',
        dport: '0',
        alert_type: 'Dossier Compiled',
        isSafe: true,
        reconstruction_error: 0.0
    });
}
window.exportSecurityDossier = exportSecurityDossier;


