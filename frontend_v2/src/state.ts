import type { GlobeArc, StreamEvent, FlowEntry, NotificationEntry, AdaptiveStats, WhitelistEntry, GeoLocation } from './types';

export interface AppState {
  notificationHistory: NotificationEntry[];
  unreadCount: number;
  rightPanelFilter: 'ALL' | 'EXTERNAL' | 'LOCAL';
  upperLeftFilter: 'ANOMALIES' | 'SAFE';
  whitelist: WhitelistEntry[];

  // AI Traffic
  isCapturing: boolean;
  socket: ReturnType<typeof import('socket.io-client')['io']> | null;

  // Globe
  globeWorld: ReturnType<import('globe.gl')['default']> | null;
  activeArcs: GlobeArc[];
  recentFlows: FlowEntry[];
  streamEvents: StreamEvent[];

  // User location
  userLat: number;
  userLng: number;

  selectedFlowId: string | null;
  lockedOnIp: string | null;
  justSelected: boolean;
  isGlobeInteracting: boolean;
  deferredGlobeUpdate: boolean;
  isGlobeTransitioning: boolean;

  // Adaptive / training
  adaptive: AdaptiveStats | null;

  // Radar
  radarSweepInterval: ReturnType<typeof setInterval> | null;

  // Flow timeout (frontend mirror)
  flowTimeout: number;
}

export const state: AppState = {
  notificationHistory: [],
  unreadCount: 0,
  rightPanelFilter: 'ALL',
  upperLeftFilter: 'ANOMALIES',
  whitelist: [],

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
  isGlobeTransitioning: false,

  adaptive: null,
  radarSweepInterval: null,
  flowTimeout: 5,
};
