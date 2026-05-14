from datetime import datetime
import globals
from globals import socketio, traffic_stats_lock, traffic_stats, flow_manager, anomaly_model
from ai_modules.feature_extractor import LIVE_FEATURES
from services.dns_resolver import dns_cache

def packet_callback(packet_info):
    """
    Main callback for live network traffic interception. 
    Updates global statistics and triggers the flow manager for behavioral analysis.
    
    Args:
        packet_info (dict): Extracted metadata from the captured packet.
    """
    try:
        proto = packet_info.get('protocol', 'OTHER')

        with traffic_stats_lock:
            traffic_stats['total_packets'] += 1
            pkt_size = packet_info.get('size', 0)
            traffic_stats['total_bytes'] += pkt_size
            traffic_stats['protocol_distribution'][proto] = traffic_stats['protocol_distribution'].get(proto, 0) + 1

            # Volumetric Telemetry: Track bandwidth per IP address
            if '_ip_bytes' not in traffic_stats:
                traffic_stats['_ip_bytes'] = {}
            src_ip = packet_info.get('src', '')
            dst_ip = packet_info.get('dst', '')
            if src_ip:
                traffic_stats['_ip_bytes'][src_ip] = traffic_stats['_ip_bytes'].get(src_ip, 0) + pkt_size
            if dst_ip:
                traffic_stats['_ip_bytes'][dst_ip] = traffic_stats['_ip_bytes'].get(dst_ip, 0) + pkt_size
            
            # Periodic recalculation of top talkers and longest flows (every 5 packets)
            if traffic_stats['total_packets'] % 5 == 0 or not traffic_stats.get('top_services'):
                sorted_ips = sorted(traffic_stats['_ip_bytes'].items(), key=lambda x: x[1], reverse=True)[:5]
                traffic_stats['top_talkers'] = [{'ip': ip, 'host': dns_cache.get_hostname(ip), 'bytes': b} for ip, b in sorted_ips]
                traffic_stats['top_services'] = flow_manager.get_top_services(5)
                longest_flows = flow_manager.get_longest_flows(5)
                for flow in longest_flows:
                    flow['src_host'] = dns_cache.get_hostname(flow['src'])
                traffic_stats['longest_flows'] = longest_flows

        # Update the flow manager to aggregate individual packets into bidirectional flows
        flow_manager.update_flow_from_info(packet_info)

        # Broadcast packet metadata to connected frontend clients via WebSocket
        socketio.emit('packet', {
            'timestamp': datetime.now().isoformat(),
            'src': packet_info.get('src'),
            'src_host': dns_cache.get_hostname(packet_info.get('src')),
            'dst': packet_info.get('dst'),
            'dst_host': dns_cache.get_hostname(packet_info.get('dst')),
            'protocol': proto,
            'size': packet_info.get('size', 0),
            'sport': packet_info.get('sport'),
            'dport': packet_info.get('dport')
        }, namespace='/')

        # Evaluate expired flows against the security engine
        check_expired_flows()

    except Exception as e:
        print(f"[ERROR] Packet processing error: {e}")

def check_expired_flows():
    """
    Performs a dual-stage security audit on completed network flows.
    Stage 1: Threat Intelligence (Blocklist matching)
    Stage 2: AI Behavioral Analysis (Autoencoder reconstruction error)
    """
    try:
        import numpy as np
        from globals import anomaly_model, autoencoder_scaler, autoencoder_threshold
        from globals import manual_whitelist
        from security_modules.threat_intel import threat_intel
        from globals import traffic_stats, traffic_stats_lock, socketio
        from datetime import datetime
        
        expired = flow_manager.get_expired_flows()
        if expired is not None and not expired.empty:
            
            # --- Stage 1: Threat Intelligence Check ---
            clean_indices = []
            
            for i, row in expired.iterrows():
                src_ip = row.get('src')
                dst_ip = row.get('dst')
                
                # Check if either endpoint exists in the global threat blocklist
                is_threat = threat_intel.is_malicious(src_ip) or threat_intel.is_malicious(dst_ip)
                
                if is_threat:
                    anomaly_data = {
                        'timestamp': datetime.now().isoformat(),
                        'duration': float(row['dur']),
                        'packets': int(row['spkts'] + row['dpkts']),
                        'bytes': int(row['sbytes'] + row['dbytes']),
                        'src': str(src_ip),
                        'src_host': dns_cache.get_hostname(str(src_ip)),
                        'dst': str(dst_ip),
                        'dst_host': dns_cache.get_hostname(str(dst_ip)),
                        'sport': int(row.get('sport', 0)),
                        'dport': int(row.get('dport', 0)),
                        'alert_type': 'Threat Intelligence Blocklist',
                        'reconstruction_error': 1.0, # Visual indicator: Max error
                        'raw_features': row.to_dict()
                    }
                    with traffic_stats_lock:
                        traffic_stats['anomaly_count'] += 1
                        traffic_stats['recent_anomalies'].append(anomaly_data)
                        traffic_stats['recent_anomalies'] = traffic_stats['recent_anomalies'][-50:]
                    socketio.emit('anomaly', anomaly_data, namespace='/')
                else:
                    clean_indices.append(i)
                    # Persist normal flows for future model reinforcement
                    from globals import baseline_manager
                    baseline_manager.save_flow(row.to_dict())
                    
            if not clean_indices:
                return
                
            clean_expired = expired.loc[clean_indices]
            
            # --- Stage 2: Deep Learning Behavioral Analysis (ONNX) ---
            if anomaly_model and autoencoder_scaler:
                # Pre-process flow features for model inference
                df_to_predict = clean_expired.reindex(columns=LIVE_FEATURES).fillna(0)
                
                # Normalize data using the pre-fitted scaler
                scaled_data = autoencoder_scaler.transform(df_to_predict).astype(np.float32)
                
                # Execute inference via ONNX Runtime
                input_name = anomaly_model.get_inputs()[0].name
                reconstructed = anomaly_model.run(None, {input_name: scaled_data})[0]
                
                # Calculate Reconstruction Error (Mean Squared Error)
                mse = np.mean((scaled_data - reconstructed) ** 2, axis=1)

                emitted_normals = 0

                for idx, error in enumerate(mse):
                    flow_info = clean_expired.iloc[idx]
                    
                    if error > autoencoder_threshold:  # Statistical outlier detected
                        src_str = str(flow_info.get('src', 'N/A'))
                        dst_str = str(flow_info.get('dst', 'N/A'))
                        dport_int = int(flow_info.get('dport', 0))
                        
                        # Verify against user-defined manual whitelist
                        if (src_str, dst_str, dport_int) in manual_whitelist:
                            from globals import baseline_manager
                            baseline_manager.save_flow(flow_info.to_dict())
                            if emitted_normals < 5:
                                normal_data = {
                                    'src': src_str,
                                    'src_host': dns_cache.get_hostname(src_str),
                                    'dst': dst_str,
                                    'dst_host': dns_cache.get_hostname(dst_str),
                                    'dport': dport_int,
                                    'error': float(error)
                                }
                                socketio.emit('normal_flow', normal_data, namespace='/')
                                emitted_normals += 1
                            continue
                        
                        anomaly_data = {
                            'timestamp': datetime.now().isoformat(),
                            'duration': float(flow_info['dur']),
                            'packets': int(flow_info['spkts'] + flow_info['dpkts']),
                            'bytes': int(flow_info['sbytes'] + flow_info['dbytes']),
                            'src': str(flow_info.get('src', 'N/A')),
                            'src_host': dns_cache.get_hostname(str(flow_info.get('src', 'N/A'))),
                            'dst': str(flow_info.get('dst', 'N/A')),
                            'dst_host': dns_cache.get_hostname(str(flow_info.get('dst', 'N/A'))),
                            'sport': int(flow_info.get('sport', 0)),
                            'dport': int(flow_info.get('dport', 0)),
                            'alert_type': 'AI Behavioral Anomaly',
                            'reconstruction_error': float(error),
                            'raw_features': flow_info.to_dict()
                        }
                        with traffic_stats_lock:
                            traffic_stats['anomaly_count'] += 1
                            traffic_stats['recent_anomalies'].append(anomaly_data)
                            traffic_stats['recent_anomalies'] = traffic_stats['recent_anomalies'][-50:]

                        socketio.emit('anomaly', anomaly_data, namespace='/')
                    else:
                        # Flow confirmed as within statistical baseline
                        # Limit emissions per batch to optimize WebSocket bandwidth
                        if emitted_normals < 5:
                            normal_data = {
                                'src': str(flow_info.get('src', 'N/A')),
                                'src_host': dns_cache.get_hostname(str(flow_info.get('src', 'N/A'))),
                                'dst': str(flow_info.get('dst', 'N/A')),
                                'dst_host': dns_cache.get_hostname(str(flow_info.get('dst', 'N/A'))),
                                'dport': int(flow_info.get('dport', 0)),
                                'error': float(error)
                            }
                            socketio.emit('normal_flow', normal_data, namespace='/')
                            emitted_normals += 1

    except Exception as e:
        print(f"[ERROR] Flow analysis failed: {e}")

