import { state } from './state_v2.js';

/** Returns a formatted HH:MM:SS time string for the current moment. */
export function nowTimeStr() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Formats an ISO timestamp string into a localized HH:MM:SS string. */
export function formatTimestampToTimeStr(isoString) {
    try {
        if (!isoString) return nowTimeStr();
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return nowTimeStr();
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
        return nowTimeStr();
    }
}

/** Returns a unique flow/arc ID. */
export function makeId() {
    return `flow-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/** Derives the alert title from a data payload. */
export function alertTitle(data) {
    return data.alert_type === 'Threat Intelligence Blocklist'
        ? 'Known Malicious IP Detected'
        : 'AI Behavioral Anomaly Detected';
}

/** Returns only the arcs that should appear on the globe (filtered by type & lock-on). */
export function getGlobalArcs() {
    let arcs = state.activeArcs;

    if (state.rightPanelFilter === 'EXTERNAL') {
        arcs = arcs.filter(a => !a.isLocal);
    } else if (state.rightPanelFilter === 'LOCAL') {
        arcs = arcs.filter(a => a.isLocal);
    }
    // ALL: no filter — show everything

    if (state.lockedOnIp) {
        arcs = arcs.filter(a => a.src === state.lockedOnIp || a.dst === state.lockedOnIp);
    }
    return arcs;
}

/** Resolves the endpoints of the currently selected flow or stream event. */
export function getSelectedFlowEndpoints() {
    if (!state.selectedFlowId) return null;

    if (state.selectedFlowId.startsWith('stream-')) {
        const event = state.streamEvents?.find(e => e.id === state.selectedFlowId);
        if (event) {
            return { src: event.src, dst: event.dst, dport: event.dport };
        }
    } else if (state.selectedFlowId.startsWith('flow-')) {
        const flow = state.recentFlows?.find(f => f.id === state.selectedFlowId);
        if (flow) {
            return { src: flow.src, dst: flow.dst, dport: flow.dport };
        }
    } else {
        // Assume it is a globe arc ID
        const arc = state.activeArcs?.find(a => a.id === state.selectedFlowId || (a.flows && a.flows.some(f => f.id === state.selectedFlowId)));
        if (arc) {
            return { src: arc.src, dst: arc.dst, dport: arc.dport };
        }
    }
    return null;
}

/** Formats byte counts to human-readable strings. */
export function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Determines if an IP is local (private, loopback, or link-local). */
export function checkIsLocalIp(ip) {
    if (!ip) return false;
    // Standard private/loopback/link-local IPv4/IPv6, plus multicast IPv4 (224-239.*), broadcast, and multicast IPv6 (ff00::)
    const localIpRegex = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.|169\.254\.|22[4-9]\.|23[0-9]\.|255\.255\.255\.255$|fe80:|fc00:|fd00:|ff00:|::1$|localhost$)/i;
    if (localIpRegex.test(ip)) return true;

    // Check for local multicast/DNS domain suffixes
    const ipStr = String(ip).toLowerCase();
    return ipStr.endsWith('.local') || ipStr.endsWith('.mcast.net');
}

/** Determines if both source and destination endpoints of a connection are local. */
export function checkIsLocalConnection(src, dst) {
    return checkIsLocalIp(src) && checkIsLocalIp(dst);
}

