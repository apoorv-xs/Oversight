"""
Feature extraction module for real-time network flow analysis.
Aggregates raw packets into 'Flows' to extract 14 statistical features, 
ensuring compatibility with the autoencoder.
"""
import pandas as pd
import time
from collections import defaultdict
import threading

# 14 baseline features required by the neural network
LIVE_FEATURES = [
    'dur', 'spkts', 'dpkts', 'sbytes', 'dbytes', 'rate', 'sttl', 'dttl',
    'sload', 'dload', 'swin', 'dwin', 'smean', 'dmean'
]

class FlowManager:
    """In-memory state tracker for active network flows."""

    def __init__(self, timeout=5):
        self.flows = {}
        self.timeout = timeout
        self.lock_time = time.time()
        self.lock = threading.Lock()

    def update_flow(self, packet):
        """Update active flows with new packet data (Scapy packet)."""
        if not packet.haslayer('IP'):
            return None

        proto = packet['IP'].proto
        src = packet['IP'].src
        dst = packet['IP'].dst
        sport = packet.sport if packet.haslayer('TCP') or packet.haslayer('UDP') else 0
        dport = packet.dport if packet.haslayer('TCP') or packet.haslayer('UDP') else 0

        return self._update_flow_internal(src, dst, sport, dport, proto, len(packet), packet)

    def update_flow_from_info(self, packet_info):
        """Update active flows from packet info dict (from capture thread)."""
        src = packet_info.get('src')
        dst = packet_info.get('dst')
        proto_num = self._get_proto_num(packet_info.get('protocol', 'IP'))
        sport = packet_info.get('sport', 0) or 0
        dport = packet_info.get('dport', 0) or 0
        size = packet_info.get('size', 0)
        ttl = packet_info.get('ttl', 128)
        window = packet_info.get('window', 0)

        return self._update_flow_internal(src, dst, sport, dport, proto_num, size, None, ttl, window)

    def _get_proto_num(self, protocol_name):
        """Convert protocol name to number."""
        proto_map = {
            'TCP': 6,
            'UDP': 17,
            'ICMP': 1,
            'IGMP': 2,
            'IP': 0
        }
        return proto_map.get(protocol_name.upper(), 0)

    def _update_flow_internal(self, src, dst, sport, dport, proto, size, packet=None, ttl=128, window=0):
        """Internal flow update logic."""
        flow_key = (src, dst, sport, dport, proto)
        reverse_key = (dst, src, dport, sport, proto)
        current_time = time.time()

        with self.lock:
            if flow_key in self.flows:
                flow = self.flows[flow_key]
                flow['last_seen'] = current_time
                flow['spkts'] += 1
                flow['sbytes'] += size
                flow['sttl'] = ttl
                if window:
                    flow['swin'] = window

            elif reverse_key in self.flows:
                flow = self.flows[reverse_key]
                flow['last_seen'] = current_time
                flow['dpkts'] += 1
                flow['dbytes'] += size
                flow['dttl'] = ttl
                if window:
                    flow['dwin'] = window

            else:
                self.flows[flow_key] = {
                    'start_time': current_time,
                    'last_seen': current_time,
                    'spkts': 1,
                    'sbytes': size,
                    'sttl': ttl,
                    'swin': window,
                    'dpkts': 0,
                    'dbytes': 0,
                    'dttl': 0,
                    'dwin': 0
                }

            return flow_key if flow_key in self.flows else reverse_key

    def get_expired_flows(self):
        """Calculate final statistics for flows that exceeded the timeout threshold."""
        current_time = time.time()
        expired_data = []

        with self.lock:
            expired_keys = [k for k, v in self.flows.items() if (current_time - v['last_seen']) > self.timeout]

            for key in expired_keys:
                flow = self.flows.pop(key)
                src, dst, sport, dport, proto = key
                
                duration = flow['last_seen'] - flow['start_time']
                if duration <= 0:
                    duration = 0.001  # Avoid division by zero

                # Map flow stats to UNSW-NB15 features
                stats = {feat: 0 for feat in LIVE_FEATURES}
                stats['src'] = src
                stats['dst'] = dst
                stats['sport'] = sport
                stats['dport'] = dport
                stats['proto'] = proto

                stats['dur'] = duration
                stats['spkts'] = flow['spkts']
                stats['dpkts'] = flow['dpkts']
                stats['sbytes'] = flow['sbytes']
                stats['dbytes'] = flow['dbytes']

                total_pkts = flow['spkts'] + flow['dpkts']
                stats['rate'] = total_pkts / duration

                stats['sttl'] = flow['sttl']
                stats['dttl'] = flow['dttl']
                stats['sload'] = (flow['sbytes'] * 8) / duration
                stats['dload'] = (flow['dbytes'] * 8) / duration

                stats['swin'] = flow['swin']
                stats['dwin'] = flow['dwin']
                stats['smean'] = flow['sbytes'] / flow['spkts'] if flow['spkts'] > 0 else 0
                stats['dmean'] = flow['dbytes'] / flow['dpkts'] if flow['dpkts'] > 0 else 0

                expired_data.append(stats)

        return pd.DataFrame(expired_data) if expired_data else pd.DataFrame()

    def get_active_flows_summary(self):
        """Get summary of currently active flows."""
        current_time = time.time()
        active_flows = []

        with self.lock:
            for key, flow in self.flows.items():
                if (current_time - flow['last_seen']) <= self.timeout:
                    src, dst, sport, dport, proto = key
                    active_flows.append({
                        'src': src,
                        'dst': dst,
                        'sport': sport,
                        'dport': dport,
                        'protocol': proto,
                        'duration': current_time - flow['start_time'],
                        'packet_count': flow['spkts'] + flow['dpkts'],
                        'byte_count': flow['sbytes'] + flow['dbytes']
                    })

        return active_flows

    def get_top_talkers(self, n=5):
        """Get top N talkers by byte count."""
        talkers = defaultdict(lambda: {'bytes': 0, 'packets': 0})

        with self.lock:
            for key, flow in self.flows.items():
                src, dst, _, _, _ = key
                talkers[src]['bytes'] += flow['sbytes']
                talkers[src]['packets'] += flow['spkts']
                talkers[dst]['bytes'] += flow['dbytes']
                talkers[dst]['packets'] += flow['dpkts']

        sorted_talkers = sorted(talkers.items(), key=lambda x: x[1]['bytes'], reverse=True)
        return [{'ip': ip, **stats} for ip, stats in sorted_talkers[:n]]

    def get_top_services(self, n=5):
        """Get top consumed services by byte count."""
        services = defaultdict(lambda: 0)

        with self.lock:
            for key, flow in self.flows.items():
                _, _, sport, dport, _ = key
                # Assume the lower port is the service port (e.g., 443 vs 52341)
                svc_port = min(sport, dport) if min(sport, dport) > 0 else max(sport, dport)
                services[svc_port] += flow['sbytes'] + flow['dbytes']

        sorted_services = sorted(services.items(), key=lambda x: x[1], reverse=True)
        return [{'port': port, 'bytes': bytes_count} for port, bytes_count in sorted_services[:n]]

    def get_longest_flows(self, n=5):
        """Get longest active connections."""
        current_time = time.time()
        flows_list = []
        
        with self.lock:
            for key, flow in self.flows.items():
                src, dst, _, dport, _ = key
                duration = current_time - flow['start_time']
                flows_list.append({
                    'src': src,
                    'dst': dst,
                    'port': dport,
                    'duration': duration
                })

        sorted_flows = sorted(flows_list, key=lambda x: x['duration'], reverse=True)
        return sorted_flows[:n]

    def clear_flows(self):
        """Clear all flows."""
        with self.lock:
            self.flows.clear()

    def get_active_flow_count(self):
        # get number of active flows (with lock)
        with self.lock:
            return len(self.flows)
