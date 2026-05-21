import { state } from './state_v2.js';
import { makeId, nowTimeStr, getGlobalArcs, getSelectedFlowEndpoints, formatBytes, checkIsLocalIp, checkIsLocalConnection } from './utils_v2.js';
import { renderActiveFlowsList, renderStreamList } from './ui_v2.js';

function dimColor(color, factor = 0.35) {
    if (Array.isArray(color)) {
        return color.map(c => dimColor(c, factor));
    }
    if (typeof color === 'string') {
        const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (match) {
            const r = match[1];
            const g = match[2];
            const b = match[3];
            const a = parseFloat(match[4]);
            return `rgba(${r}, ${g}, ${b}, ${a * factor})`;
        }
    }
    return color;
}

function getMidpointAndDistance(lat1, lng1, lat2, lng2) {
    const phi1 = lat1 * Math.PI / 180;
    const lambda1 = lng1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const lambda2 = lng2 * Math.PI / 180;

    const x1 = Math.cos(phi1) * Math.cos(lambda1);
    const y1 = Math.cos(phi1) * Math.sin(lambda1);
    const z1 = Math.sin(phi1);

    const x2 = Math.cos(phi2) * Math.cos(lambda2);
    const y2 = Math.cos(phi2) * Math.sin(lambda2);
    const z2 = Math.sin(phi2);

    const x = (x1 + x2) / 2;
    const y = (y1 + y2) / 2;
    const z = (z1 + z2) / 2;

    const hyp = Math.sqrt(x * x + y * y);
    
    const midLat = Math.atan2(z, hyp) * 180 / Math.PI;
    const midLng = Math.atan2(y, x) * 180 / Math.PI;

    // Haversine distance in radians
    const dPhi = phi2 - phi1;
    const dLambda = lambda2 - lambda1;
    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const distRad = 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));

    return {
        lat: midLat,
        lng: midLng,
        distance: distRad
    };
}

function isArcSelected(d) {
    const endpoints = getSelectedFlowEndpoints();
    if (!endpoints) {
        // Fallback standard check
        return d.flows ? d.flows.some(f => f.id === state.selectedFlowId) : (d.id === state.selectedFlowId);
    }
    
    if (d.flows) {
        return d.flows.some(f => f.src === endpoints.src && f.dst === endpoints.dst && f.dport === endpoints.dport);
    }
    return (d.src === endpoints.src && d.dst === endpoints.dst && d.dport === endpoints.dport);
}


let lastGlobeUpdate = 0;
let updateTimeoutId = null;
let currentFocusedFlowId = null;

export function updateGlobeData() {
    if (!state.globeWorld) return;

    if (state.isGlobeInteracting) {
        state.deferredGlobeUpdate = true;
        return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - lastGlobeUpdate;
    const throttleDelay = 120; // Limit WebGL rebuilds under traffic spikes to max ~8 updates per second

    if (timeSinceLastUpdate < throttleDelay) {
        if (!updateTimeoutId) {
            updateTimeoutId = setTimeout(() => {
                updateTimeoutId = null;
                updateGlobeData();
            }, throttleDelay - timeSinceLastUpdate);
        }
        return;
    }

    if (updateTimeoutId) {
        clearTimeout(updateTimeoutId);
        updateTimeoutId = null;
    }

    lastGlobeUpdate = now;

    requestAnimationFrame(() => {
        // clear out old arcs from the globe so it doesn't lag
        const timeNow = Date.now();
        state.activeArcs = state.activeArcs.filter(a => {
            const isSelected = isArcSelected(a);
            return (timeNow - a.lastSeen) < 5000 || isSelected;
        });
        
        let globalArcs = getGlobalArcs();
        if (state.selectedFlowId) {
            globalArcs = globalArcs.filter(a => isArcSelected(a));
        }
        
        // Separate local normal arcs from the rest to cap visual clutter
        const localNormalArcs = globalArcs.filter(a => a.isLocal && !a.isAnomaly);
        const otherArcs = globalArcs.filter(a => !a.isLocal || a.isAnomaly);
        // Cap local normal arcs to 3 on the globe — keeps the subtle presence without the blob
        const cappedLocalArcs = localNormalArcs.slice(0, 3);
        const renderArcs = [...otherArcs, ...cappedLocalArcs];

        // Consolidate overlapping arcs sharing exactly the same source and destination coordinates
        const consolidatedMap = new Map();
        renderArcs.forEach(a => {
            const coordKey = `${a.startLat.toFixed(3)}-${a.startLng.toFixed(3)}-${a.endLat.toFixed(3)}-${a.endLng.toFixed(3)}`;
            if (!consolidatedMap.has(coordKey)) {
                consolidatedMap.set(coordKey, {
                    ...a,
                    flows: [a],
                    flowCount: 1,
                    isAnomaly: a.isAnomaly,
                    totalPackets: a.packets || 1,
                    totalBytes: a.bytes || 64
                });
            } else {
                const group = consolidatedMap.get(coordKey);
                group.flows.push(a);
                group.flowCount++;
                group.totalPackets += (a.packets || 1);
                group.totalBytes += (a.bytes || 64);
                if (a.isAnomaly) {
                    group.isAnomaly = true;
                }
            }
        });
        const consolidatedArcs = Array.from(consolidatedMap.values());

        // Update colors based on consolidated anomaly state
        consolidatedArcs.forEach(a => {
            if (a.isAnomaly) {
                a.baseColor = ['rgba(255, 42, 42, 1)', 'rgba(255, 42, 42, 1)'];
            } else if (a.isLocal) {
                // Local normal arcs: elegant thin silver lines that are clearly visible but not dominant
                a.baseColor = ['rgba(170, 185, 200, 0.25)', 'rgba(210, 225, 240, 0.55)'];
            } else {
                a.baseColor = ['rgba(255, 179, 0, 0.3)', 'rgba(255, 110, 0, 0.85)'];
            }
        });

        // Generate invisible solid ghost arcs to act as fat mouse hitboxes
        const hitBoxArcs = consolidatedArcs.map(a => ({ ...a, isHitBox: true }));
        state.globeWorld.arcsData([...consolidatedArcs, ...hitBoxArcs]);

        // Compute dynamic city labels — skip local arcs entirely (no real geo, just noise)
        const uniqueLabels = new Map();
        renderArcs.forEach(a => {
            if (a.isLocal) return; // Local arcs have no meaningful location — skip labels

            const isOutbound = Math.abs(a.startLat - state.userLat) < 0.01 && Math.abs(a.startLng - state.userLng) < 0.01;
            const remoteLat = isOutbound ? a.endLat : a.startLat;
            const remoteLng = isOutbound ? a.endLng : a.startLng;

            const labelId = `${remoteLat.toFixed(2)}-${remoteLng.toFixed(2)}`;
            if (!uniqueLabels.has(labelId)) {
                uniqueLabels.set(labelId, { 
                    lat: remoteLat, 
                    lng: remoteLng, 
                    text: a.srcCity || a.dstCity || 'Unknown Region', 
                    isAnomaly: a.isAnomaly,
                    flowCount: 1
                });
            } else {
                const label = uniqueLabels.get(labelId);
                label.flowCount++;
                if (a.isAnomaly) label.isAnomaly = true;
            }
        });
        const labelsArray = Array.from(uniqueLabels.values());
        
        let hasAnomaly = false;
        let activeAnomalyCount = 0;
        if (renderArcs.length > 0) {
            hasAnomaly = renderArcs.some(a => a.isAnomaly);
            activeAnomalyCount = renderArcs.filter(a => a.isAnomaly).length;
            labelsArray.push({
                lat: state.userLat,
                lng: state.userLng,
                text: 'SYS_ORIGIN',
                isAnomaly: hasAnomaly,
                flowCount: renderArcs.length,
                isLocalUserNode: true
            });
        }
        
        state.globeWorld.labelsData(labelsArray);
        
        // Feed the remote locations and local node to the rings renderer!
        const ringsArray = [...labelsArray];
        
        // Defcon Effect: Change atmosphere color based on global threat state!
        state.globeWorld.atmosphereColor(hasAnomaly ? 'rgba(255, 42, 42, 0.6)' : 'rgba(100, 120, 150, 0.15)');
        
        if (activeAnomalyCount >= 3) {
            document.body.classList.add('panic-mode');
        } else {
            document.body.classList.remove('panic-mode');
        }
        
        state.globeWorld.ringsData(ringsArray);

        // Dynamic Camera focusing and auto-rotate locking
        const activeTargetId = state.selectedFlowId || (state.lockedOnIp ? `lock-${state.lockedOnIp}` : null);
        if (activeTargetId) {
            if (activeTargetId !== currentFocusedFlowId) {
                currentFocusedFlowId = activeTargetId;
                
                // Find an arc matching the selection or locked IP
                const selectedArc = state.activeArcs.find(a => {
                    if (state.selectedFlowId) return isArcSelected(a);
                    if (state.lockedOnIp) {
                        return a.src === state.lockedOnIp || a.dst === state.lockedOnIp ||
                               (a.flows && a.flows.some(f => f.src === state.lockedOnIp || f.dst === state.lockedOnIp));
                    }
                    return false;
                });
                
                if (selectedArc && state.globeWorld) {
                    state.globeWorld.controls().autoRotate = false;
                    
                    // Identify the remote location coordinate (the "other destination")
                    const isStartLocal = Math.abs(selectedArc.startLat - state.userLat) < 0.01 && 
                                         Math.abs(selectedArc.startLng - state.userLng) < 0.01;
                    const remoteLat = isStartLocal ? selectedArc.endLat : selectedArc.startLat;
                    const remoteLng = isStartLocal ? selectedArc.endLng : selectedArc.startLng;

                    const geoInfo = getMidpointAndDistance(
                        selectedArc.startLat, selectedArc.startLng,
                        selectedArc.endLat, selectedArc.endLng
                    );
                    const targetAltitude = 1.1 + (geoInfo.distance / Math.PI) * 1.3;
                    
                    triggerGlobeTransition({
                        lat: remoteLat,
                        lng: remoteLng,
                        altitude: targetAltitude
                    }, 2000);
                }
            }
        } else {
            if (currentFocusedFlowId !== null) {
                currentFocusedFlowId = null;
                if (state.globeWorld) {
                    state.globeWorld.controls().autoRotate = true;
                    triggerGlobeTransition({
                        lat: state.userLat,
                        lng: state.userLng,
                        altitude: 1.8
                    }, 2000);
                }
            }
        }
    });
}

export function initGlobeViz() {
    const globeContainer = document.getElementById('globeViz');
    if (!globeContainer || typeof Globe === 'undefined') return;

    state.globeWorld = Globe()
        (globeContainer)
        .globeTileEngineUrl((x, y, l) => `https://a.basemaps.cartocdn.com/dark_nolabels/${l}/${x}/${y}@2x.png`)
        .backgroundColor('rgba(0, 0, 0, 0)')
        .showAtmosphere(true)
        .atmosphereColor('rgba(100, 120, 150, 0.15)')
        .atmosphereAltitude(0.18)
        .pointOfView({ lat: state.userLat, lng: state.userLng, altitude: 1.8 })
        .arcLabel(d => {
            const isAnomaly = d.isAnomaly;
            const flows = d.flows || [d];
            const flowCount = d.flowCount || 1;
            
            const isOutbound = Math.abs(d.startLat - state.userLat) < 0.01 && Math.abs(d.startLng - state.userLng) < 0.01;
            const remoteCity = d.srcCity && d.srcCity !== 'Local' ? d.srcCity : (d.dstCity || 'Unknown Region');
            const locationText = d.isLocal 
                ? 'Internal Local Connection' 
                : (isOutbound ? `Destination: ${remoteCity}` : `Origin: ${remoteCity}`);

            let flowsHtml = '';
            // List up to 3 active flows in detail, and summarize the rest
            flows.slice(0, 3).forEach(f => {
                const srcDisplay = f.src_host && f.src_host !== f.src ? `${f.src_host}` : f.src;
                const dstDisplay = f.dst_host && f.dst_host !== f.dst ? `${f.dst_host}` : f.dst;
                flowsHtml += `
                    <div style="font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 2px;">
                        <span style="color: #fff">${srcDisplay}</span> &rarr; <span style="color: #fff">${dstDisplay}:${f.dport}</span>
                    </div>
                `;
            });
            if (flowCount > 3) {
                flowsHtml += `
                    <div style="font-size: 0.7rem; color: var(--text-tertiary); font-style: italic; margin-top: 4px;">
                        + ${flowCount - 3} more active session(s)...
                    </div>
                `;
            }

            const totalPackets = d.totalPackets || d.packets || 1;
            const totalBytes = d.totalBytes || d.bytes || 64;

            return `
                <div style="background: rgba(10, 10, 12, 0.85); border: 1px solid ${isAnomaly ? 'var(--status-danger)' : 'rgba(255,255,255,0.2)'}; padding: 12px 16px; border-radius: var(--radius-sm); font-family: Inter, sans-serif; backdrop-filter: blur(8px); box-shadow: 0 4px 20px rgba(0,0,0,0.6); min-width: 220px;">
                    <div style="font-weight: 800; font-size: 0.8rem; margin-bottom: 6px; color: ${isAnomaly ? 'var(--status-danger)' : '#fff'}; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                        <span>${isAnomaly ? '⚠️ THREAT ACTIVE' : '✓ SECURE LINK'}</span>
                        <span style="font-size: 0.7rem; background: ${isAnomaly ? 'rgba(255, 42, 42, 0.15)' : 'rgba(255, 179, 0, 0.15)'}; color: ${isAnomaly ? 'var(--status-danger)' : 'var(--status-warn)'}; padding: 2px 6px; border-radius: 4px; font-weight: 800;">
                            ${flowCount} ${flowCount === 1 ? 'FLOW' : 'FLOWS'}
                        </span>
                    </div>
                    <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding: 6px 0; margin-bottom: 6px;">
                        ${flowsHtml}
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-tertiary); margin-bottom: 6px;">
                        <span>Activity: ${totalPackets.toLocaleString()} Pkts</span>
                        <span>Volume: ${formatBytes(totalBytes)}</span>
                    </div>
                    <div style="font-size: 0.7rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em;">
                        ${locationText}
                    </div>
                </div>
            `;
        })
        .arcStartLat(d => d.startLat)
        .arcStartLng(d => d.startLng)
        .arcEndLat(d => d.endLat)
        .arcEndLng(d => d.endLng)
        .arcAltitude(d => d.altitude)
        .arcColor(d => {
            if (d.isHitBox) return 'rgba(255, 255, 255, 0.01)'; // Invisible massive hitbox
            if (state.selectedFlowId) {
                const isSelected = isArcSelected(d);
                if (isSelected) {
                    return d.isAnomaly
                        ? ['rgba(255, 42, 42, 1)', 'rgba(255, 42, 42, 1)']
                        : ['rgba(255, 179, 0, 0.9)', 'rgba(255, 179, 0, 0.9)'];
                }
                return dimColor(d.baseColor, 0.35); // Dim but clearly visible non-selected arcs
            }
            return d.baseColor;
        })
        .arcDashLength(d => {
            if (d.isHitBox) return 1;
            const isSelected = isArcSelected(d);
            if (state.selectedFlowId) {
                return isSelected ? 0.8 : 0.15; // Slightly visible dashes for other arcs
            }
            return d.isAnomaly ? 0.4 : 0.2;
        })
        .arcDashGap(d => {
            if (d.isHitBox) return 0;
            const isSelected = isArcSelected(d);
            if (state.selectedFlowId) {
                return isSelected ? 0.1 : 0.3;
            }
            return d.isAnomaly ? 0.2 : 0.1;
        })
        .arcDashAnimateTime(d => {
            if (d.isHitBox) return 0;
            const isSelected = isArcSelected(d);
            if (state.selectedFlowId && isSelected) return 500;
            const baseTime = d.isAnomaly ? 1200 : 2000;
            const speedFactor = Math.min((d.flowCount || 1), 5);
            return baseTime / speedFactor;
        })
        .arcStroke(d => {
            if (d.isHitBox) return 4.0;
            if (state.selectedFlowId) {
                const isSelected = isArcSelected(d);
                if (isSelected) return 2.0 + Math.min((d.flowCount || 1) * 0.2, 1.0);
                return 0.3; // Visible thin stroke for other arcs
            }
            if (d.isLocal && !d.isAnomaly) {
                return 0.35 + Math.min((d.flowCount || 1) * 0.1, 0.4); // Elegant thin lines for local normal traffic
            }
            return 0.6 + Math.min((d.flowCount || 1) * 0.25, 1.5);
        })
        .arcsTransitionDuration(0)
        .onArcClick(arc => {
            const flows = arc.flows || [arc];
            const primaryFlow = flows[0];
            window.selectFlow(primaryFlow.id);
            document.getElementById(`flow-item-${primaryFlow.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .labelText('text')
        .labelSize(d => d.isAnomaly ? 1.4 : 1.0)
        .labelDotRadius(0.35)
        .labelColor(d => d.isAnomaly ? 'rgba(255, 42, 42, 1)' : 'rgba(255, 255, 255, 0.95)')
        .labelResolution(6)
        .labelAltitude(0.012)
        .labelLabel(d => `
            <div style="background: rgba(10, 10, 12, 0.85); border: 1px solid ${d.isAnomaly ? 'var(--status-danger)' : 'rgba(255,255,255,0.2)'}; padding: 10px 14px; border-radius: var(--radius-sm); font-family: Inter, sans-serif; backdrop-filter: blur(8px); box-shadow: 0 4px 20px rgba(0,0,0,0.6);">
                <div style="font-weight: 800; font-size: 0.85rem; margin-bottom: 4px; color: ${d.isAnomaly ? 'var(--status-danger)' : '#fff'}; letter-spacing: 0.05em; text-transform: uppercase;">
                    ${d.text}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 2px;">
                    Status: <span style="color: ${d.isAnomaly ? 'var(--status-danger)' : 'var(--status-safe)'}; font-weight: 600;">${d.isAnomaly ? 'THREAT DETECTED' : 'SECURE'}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary);">
                    Active Connections: <span style="color: #fff; font-family: 'Courier New', monospace;">${d.flowCount}</span>
                </div>
            </div>
        `)
        .ringColor(d => d.isAnomaly ? 'rgba(255, 42, 42, 0.8)' : 'rgba(200, 200, 200, 0.4)')
        .ringMaxRadius(d => d.isAnomaly ? 18 : 2.5)
        .ringPropagationSpeed(d => d.isAnomaly ? 8 : 1.5)
        .ringRepeatPeriod(d => d.isAnomaly ? 800 : 1200);

    state.globeWorld.controls().autoRotate = true;
    state.globeWorld.controls().autoRotateSpeed = 0.35;

    // Upgraded Suggestion: Suspend WebGL data updates during camera rotation/drag interaction to achieve 60fps rotation
    const controls = state.globeWorld.controls();
    controls.addEventListener('start', () => {
        state.isGlobeInteracting = true;
    });
    controls.addEventListener('end', () => {
        state.isGlobeInteracting = false;
        if (state.deferredGlobeUpdate) {
            state.deferredGlobeUpdate = false;
            updateGlobeData();
        }
    });

    // Pause auto-rotation when hovering over the globe container and resume when leaving
    globeContainer.addEventListener('mouseenter', () => {
        if (state.globeWorld) {
            state.globeWorld.controls().autoRotate = false;
        }
    });

    globeContainer.addEventListener('mouseleave', () => {
        if (state.globeWorld && !state.selectedFlowId) {
            state.globeWorld.controls().autoRotate = true;
        }
    });

    // Capture-phase listeners to intercept clicks inside the WebGL canvas before event propagation is stopped
    let mouseDownX = 0;
    let mouseDownY = 0;
    let mouseDownTime = 0;

    globeContainer.addEventListener('mousedown', (e) => {
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        mouseDownTime = Date.now();
    }, { capture: true });

    globeContainer.addEventListener('click', (e) => {
        const clickDuration = Date.now() - mouseDownTime;
        const dragDistance = Math.sqrt(
            Math.pow(e.clientX - mouseDownX, 2) + 
            Math.pow(e.clientY - mouseDownY, 2)
        );

        // If the user dragged/rotated the globe (moved > 6px or held click > 300ms), do not deselect
        if (dragDistance > 6 || clickDuration > 300) {
            return;
        }

        // Defer execution using setTimeout(..., 0) so synchronous onArcClick raycasting runs first and sets state.justSelected
        setTimeout(() => {
            if (!state.selectedFlowId && !state.lockedOnIp) return;
            if (state.justSelected) {
                state.justSelected = false;
                return;
            }
            const clearSelectionBtn = document.getElementById('btnClearSelection');
            if (clearSelectionBtn && clearSelectionBtn.style.display !== 'none') {
                clearSelectionBtn.click();
            }
        }, 0);
    }, { capture: true });

    // Inject starfield into the 3D scene
    const THREE = window.THREE || Globe.THREE;
    if (THREE) {
        const scene = state.globeWorld.scene();
        const starCount = 3000;
        const positions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount * 3; i++) {
            positions[i] = (Math.random() - 0.5) * 2000;
        }
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.7,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true
        });
        scene.add(new THREE.Points(starGeometry, starMaterial));

        // Upgraded Suggestion 3: Holographic Orbital Grid Coordinate Sphere
        const gridMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff, // Stealth Silver-White
            wireframe: true,
            transparent: true,
            opacity: 0.02,
            depthWrite: false
        });
        const gridSphere = new THREE.Mesh(new THREE.SphereGeometry(100.8, 36, 18), gridMaterial);
        scene.add(gridSphere);

        // Slow three-dimensional coordinates rotation loop
        function animateGrid() {
            if (gridSphere) {
                gridSphere.rotation.y += 0.0002;
                gridSphere.rotation.x += 0.00008;
            }
            requestAnimationFrame(animateGrid);
        }
        animateGrid();
    } else {
        console.warn("THREE.js library not detected. Skipping starfield rendering.");
    }

    // TTL Garbage Collector for Arcs (retain selected arcs indefinitely)
    setInterval(() => {
        if (!state.globeWorld || state.activeArcs.length === 0) return;
        const now = Date.now();
        const initialLen = state.activeArcs.length;
        
        // Remove arcs older than 5 seconds unless they are currently selected
        state.activeArcs = state.activeArcs.filter(a => {
            const isSelected = isArcSelected(a);
            return (now - a.lastSeen) < 5000 || isSelected;
        });
        
        if (state.activeArcs.length !== initialLen) {
            updateGlobeData();
        }
    }, 3000);
}

// Dynamically resize and center the globe in the available workspace width
export function resizeGlobe() {
    if (!state.globeWorld) return;
    const container = document.getElementById('globeViz');
    if (container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        // Safeguard against 0 or unrendered dimensions to prevent camera crash
        if (width <= 0 || height <= 0) return;

        state.globeWorld.width(width);
        state.globeWorld.height(height);

        // Dynamically adjust camera altitude (zoom out) when screen is narrow
        const aspect = width / height;
        if (isNaN(aspect) || !isFinite(aspect)) return;

        let targetAltitude = 1.8;
        if (aspect < 1.0) {
            // Shrink/zoom out the globe as the available width gets narrow to prevent cropping
            targetAltitude = 1.8 + (1.0 - aspect) * 0.85;
        }
        
        // Safeguard against NaN target altitude
        if (isNaN(targetAltitude) || !isFinite(targetAltitude)) return;

        // Skip direct camera manipulation if a camera pointOfView animation is running to avoid OrbitControls conflicts/freezes
        if (state.isGlobeTransitioning) return;

        // Safely adjust ThreeJS camera distance (altitude) directly to prevent any coordinate/target drift
        try {
            const camera = state.globeWorld.camera();
            const controls = state.globeWorld.controls();
            if (camera && controls) {
                // Explicitly lock target origin to center (0, 0, 0) to prevent coordinate/target drift
                controls.target.set(0, 0, 0);

                // In globe.gl, the globe radius is 100 units. Camera distance = radius * (1 + altitude)
                const targetDistance = 100 * (1 + targetAltitude);
                camera.position.setLength(targetDistance);
                controls.update();
            }
        } catch (err) {
            console.warn("Failed to set direct camera altitude or scale compass:", err);
            // Fallback to pointOfView if direct ThreeJS calls fail
            state.globeWorld.pointOfView({ altitude: targetAltitude });
        }
    }
}

window.addEventListener('resize', resizeGlobe);

// Create a ResizeObserver to observe #globeViz itself so that any layout/CSS transition shifts trigger a re-scale instantly
try {
    const globeContainer = document.getElementById('globeViz');
    if (globeContainer) {
        const globeResizeObserver = new ResizeObserver(() => {
            resizeGlobe();
        });
        globeResizeObserver.observe(globeContainer);
    }
} catch (e) {
    console.error('Error setting up globe container ResizeObserver:', e);
}

export function addGlobeArc(data, isAnomaly) {
    if (!state.globeWorld) return;

    const flowKey = `${data.src}-${data.dst}-${data.dport}`;
    const now = Date.now();
    let existingArc = state.activeArcs.find(a => a.flowKey === flowKey);

    let currentArc;
    let currentIsOutbound;

    if (existingArc) {
        existingArc.lastSeen = now;
        existingArc.packets = (existingArc.packets || 0) + (data.packets || 1);
        existingArc.bytes = (existingArc.bytes || 0) + (data.bytes || 64);
        if (isAnomaly && !existingArc.isAnomaly) {
            existingArc.isAnomaly = true;
            existingArc.baseColor = ['rgba(255, 42, 42, 0.3)', 'rgba(255, 42, 42, 1)'];
        }
        
        // If the new data has geo info and the existing arc was unknown/simulated, update its geo info
        if (data.geo && (existingArc.srcCity === 'Unknown Region' || existingArc.isLocal)) {
            const remoteLat = data.geo.lat + (Math.random() * 0.4 - 0.2);
            const remoteLng = data.geo.lng + (Math.random() * 0.4 - 0.2);
            const isPrivateIP = checkIsLocalIp(data.src);
            const isOutbound = isPrivateIP;
            
            existingArc.startLat = isOutbound ? state.userLat : remoteLat;
            existingArc.startLng = isOutbound ? state.userLng : remoteLng;
            existingArc.endLat = isOutbound ? remoteLat : state.userLat;
            existingArc.endLng = isOutbound ? remoteLng : state.userLng;
            existingArc.srcCity = data.geo.city !== 'Unknown' ? data.geo.city : data.geo.country;
            existingArc.isLocal = false;
            
            currentIsOutbound = isOutbound;
        } else {
            currentIsOutbound = existingArc.startLat === state.userLat; // Infer outbound if start is user
        }
        currentArc = existingArc;
    } else {
        let remoteLat, remoteLng, isLocal;

        const isLocalConn = checkIsLocalConnection(data.src, data.dst);

        if (data.geo) {
            // Add a micro-jitter (approx 10-20 miles) to prevent perfect arc overlapping
            remoteLat = data.geo.lat + (Math.random() * 0.4 - 0.2);
            remoteLng = data.geo.lng + (Math.random() * 0.4 - 0.2);
            isLocal = false;
        } else if (isLocalConn) {
            // Local traffic has no geo – simulate a small random offset around the local node
            remoteLat = state.userLat + (Math.random() * 5 - 2.5);
            remoteLng = state.userLng + (Math.random() * 5 - 2.5);
            isLocal = true;
        } else {
            // External traffic with missing/failed geo - do not render on the globe to keep the map clean and accurate
            return;
        }

        // Determine direction using private IP ranges
        const isPrivateIP = checkIsLocalIp(data.src);
        currentIsOutbound = isPrivateIP; // If source is local, we are sending

        // Swap arc start/end based on true direction
        const startLat = currentIsOutbound ? state.userLat : remoteLat;
        const startLng = currentIsOutbound ? state.userLng : remoteLng;
        const endLat = currentIsOutbound ? remoteLat : state.userLat;
        const endLng = currentIsOutbound ? remoteLng : state.userLng;

        // Assign colors: Monochromatic aesthetic (White/Silver for normal, Red for anomalies)
        let baseColor;
        if (isAnomaly) {
            baseColor = ['rgba(255, 42, 42, 1)', 'rgba(255, 42, 42, 1)']; // Neon Red
        } else {
            baseColor = ['rgba(255, 179, 0, 0.3)', 'rgba(255, 110, 0, 0.85)']; // Cyber Amber/Orange Gradient
        }

        currentArc = {
            id: makeId(),
            flowKey,
            startLat, startLng,
            endLat, endLng,
            altitude: isLocal ? (Math.random() * 0.2 + 0.1) : 0.3,
            baseColor,
            src: data.src,
            dst: data.dst,
            dport: data.dport,
            src_host: data.src_host,
            dst_host: data.dst_host,
            isAnomaly,
            isLocal,
            srcCity: data.geo ? (data.geo.city !== 'Unknown' ? data.geo.city : data.geo.country) : (isLocal ? 'Local' : 'Unknown Region'),
            packets: data.packets || 1,
            bytes: data.bytes || 64,
            time: nowTimeStr(),
            lastSeen: now
        };

        state.activeArcs.unshift(currentArc);
        if (state.activeArcs.length > 100) state.activeArcs.pop();
    }

    updateGlobeData();

    if (isAnomaly && !state.selectedFlowId) {
        const rings = state.globeWorld.ringsData();
        
        // Find correct start lat/lng for ring based on the arc's remote location
        const remoteLat = currentIsOutbound ? currentArc.endLat : currentArc.startLat;
        const remoteLng = currentIsOutbound ? currentArc.endLng : currentArc.startLng;

        rings.push({ lat: remoteLat, lng: remoteLng });
        state.globeWorld.ringsData(rings);

        setTimeout(() => {
            const currentRings = state.globeWorld.ringsData();
            if (currentRings.length > 0) {
                currentRings.shift();
                state.globeWorld.ringsData(currentRings);
            }
        }, 3000);
    }

    renderActiveFlowsList();
}

export function triggerGlobeTransition(pov, duration = 2000) {
    if (!state.globeWorld) return;
    
    state.isGlobeTransitioning = true;
    state.globeWorld.pointOfView(pov, duration);
    
    setTimeout(() => {
        state.isGlobeTransitioning = false;
    }, duration + 100);
}
