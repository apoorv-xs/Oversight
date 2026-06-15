/* ─── Shared Types & Interfaces ─── */

export interface GeoLocation {
  lat: number;
  lng: number;
  city: string;
  country: string;
}

export interface PacketInfo {
  src: string;
  dst: string;
  protocol: string;
  size: number;
  timestamp: number;
  ttl: number;
  sport?: number;
  dport?: number;
  window?: number;
  geo?: GeoLocation;
}

export interface FlowEntry {
  id: string;
  src: string;
  src_host?: string;
  dst: string;
  dst_host?: string;
  dport: number;
  isAnomaly: boolean;
  time: string;
  lastSeen: number;
  hasGeo?: boolean;
}

export interface StreamEvent {
  id: string;
  src: string;
  src_host?: string;
  dst: string;
  dst_host?: string;
  dport: number;
  isAnomaly: boolean;
  isSafe: boolean;
  time: string;
  timestamp?: string;
  reconstruction_error?: number | null;
  raw_features?: Record<string, unknown> | null;
}

export interface AnomalyData {
  timestamp: string;
  duration: number;
  packets: number;
  bytes: number;
  src: string;
  src_host: string;
  dst: string;
  dst_host: string;
  sport: number;
  dport: number;
  alert_type: string;
  reconstruction_error: number;
  raw_features?: Record<string, unknown>;
  geo: GeoLocation | null;
  isSafe?: boolean;
}

export interface NormalFlowData {
  src: string;
  src_host?: string;
  dst: string;
  dst_host?: string;
  dport: number;
  error: number;
  geo: GeoLocation | null;
}

export interface GlobeArc {
  id: string;
  flowKey: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  altitude: number;
  baseColor: string[];
  src: string;
  dst: string;
  dport: number;
  src_host?: string;
  dst_host?: string;
  isAnomaly: boolean;
  isLocal: boolean;
  srcCity: string;
  packets: number;
  bytes: number;
  time: string;
  lastSeen: number;
  flows?: GlobeArc[];
  flowCount?: number;
  totalPackets?: number;
  totalBytes?: number;
  isHitBox?: boolean;
}

export interface NotificationEntry {
  id: string;
  time: string;
  title: string;
  desc: string;
  rawData: AnomalyData;
}

export interface AdaptiveStats {
  new_since_retrain: number;
  is_retraining: boolean;
  retrain_threshold: number;
  model_threshold: number;
  total_baseline: number;
}

export interface CaptureStatusResponse {
  status: string;
  data: {
    capturing: boolean;
    stats: Record<string, unknown>;
    error: string | null;
  };
}

export interface WhitelistEntry {
  src: string;
  dst: string;
  dport: number;
}

export interface RiskData {
  score: number;
  risk_level: string;
  risk_color: string;
  component_scores: {
    wifi: number;
    vulnerabilities: number;
    ports: number;
  };
  risk_factors: string[];
  summary: string;
}

export interface WhoisInfo {
  asn: string;
  org: string;
  country: string;
  net_range: string;
}
