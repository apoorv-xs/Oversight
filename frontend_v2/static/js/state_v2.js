export const state = {
    notificationHistory: [],
    unreadCount: 0,
    rightPanelFilter: 'ALL',
    upperLeftFilter: 'ANOMALIES',
    whitelist: [], // Cached list of persistent whitelisted (secured) connection rules

    // AI Traffic
    isCapturing: false,
    socket: null,

    // Globe
    globeWorld: null,
    activeArcs: [],
    recentFlows: [],
    streamEvents: [],

    // User location (overwritten by geolocation)
    userLat: 0.0,
    userLng: 0.0,

    selectedFlowId: null,
    lockedOnIp: null,
    justSelected: false,
    isGlobeInteracting: false,
    deferredGlobeUpdate: false,
    isGlobeTransitioning: false
};
