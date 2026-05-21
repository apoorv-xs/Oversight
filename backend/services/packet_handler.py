from datetime import datetime
from globals import socketio, traffic_stats_lock, traffic_stats, flow_manager, anomaly_model
from ai_modules.feature_extractor import LIVE_FEATURES
from services.dns_resolver import dns_cache

def packet_callback(packet_info):
    # callback for raw packets, updates stats and feeds flow manager
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

        # Throttle WebSocket emissions to max 1 message per second per unique flow to prevent browser network congestion
        flow_key = f"{packet_info.get('src')}-{packet_info.get('dst')}-{packet_info.get('dport')}"
        import time
        current_time = time.time()
        
        if not hasattr(packet_callback, 'last_emitted'):
            packet_callback.last_emitted = {}
            
        if current_time - packet_callback.last_emitted.get(flow_key, 0) > 1.0:
            packet_callback.last_emitted[flow_key] = current_time
            
            from services.geolocator import geolocator
            src_str = str(packet_info.get('src', ''))
            dst_str = str(packet_info.get('dst', ''))
            geo_info = geolocator.get_location(src_str)
            if not geo_info:
                geo_info = geolocator.get_location(dst_str)
            
            socketio.emit('packet', {
                'timestamp': datetime.now().isoformat(),
                'src': packet_info.get('src'),
                'src_host': dns_cache.get_hostname(packet_info.get('src')),
                'dst': packet_info.get('dst'),
                'dst_host': dns_cache.get_hostname(packet_info.get('dst')),
                'protocol': proto,
                'size': packet_info.get('size', 0),
                'sport': packet_info.get('sport'),
                'dport': packet_info.get('dport'),
                'geo': geo_info
            }, namespace='/')
            
            # Periodic memory cleanup of the tracking dictionary
            if len(packet_callback.last_emitted) > 500:
                expired_keys = [k for k, v in packet_callback.last_emitted.items() if current_time - v > 5.0]
                for k in expired_keys:
                    del packet_callback.last_emitted[k]

        # Evaluate expired flows against the security engine
        check_expired_flows()

    except Exception as e:
        print(f"[ERROR] Packet processing error: {e}")

def _emit_anomaly(row, alert_type, error, geo_info):
    # builds anomaly dict, updates stats thread-safely, and sends via socketio
    src_str = str(row.get('src', 'N/A'))
    dst_str = str(row.get('dst', 'N/A'))
    
    anomaly_data = {
        'timestamp': datetime.now().isoformat(),
        'duration': float(row.get('dur', 0.0)),
        'packets': int(row.get('spkts', 0) + row.get('dpkts', 0)),
        'bytes': int(row.get('sbytes', 0) + row.get('dbytes', 0)),
        'src': src_str,
        'src_host': dns_cache.get_hostname(src_str),
        'dst': dst_str,
        'dst_host': dns_cache.get_hostname(dst_str),
        'sport': int(row.get('sport', 0)),
        'dport': int(row.get('dport', 0)),
        'alert_type': alert_type,
        'reconstruction_error': float(error),
        'raw_features': row if isinstance(row, dict) else row.to_dict(),
        'geo': geo_info
    }
    with traffic_stats_lock:
        if alert_type == 'Threat Intelligence Blocklist':
            traffic_stats['blocklist_hits'] += 1
        else:
            traffic_stats['anomaly_count'] += 1
        traffic_stats['recent_anomalies'].append(anomaly_data)
        traffic_stats['recent_anomalies'] = traffic_stats['recent_anomalies'][-50:]
    socketio.emit('anomaly', anomaly_data, namespace='/')


def _emit_normal_flow(src_str, dst_str, dport_int, error, geo_info):
    # sends normal flow info via socketio for the dashboard map/lists
    normal_data = {
        'src': src_str,
        'src_host': dns_cache.get_hostname(src_str),
        'dst': dst_str,
        'dst_host': dns_cache.get_hostname(dst_str),
        'dport': dport_int,
        'error': float(error),
        'geo': geo_info
    }
    socketio.emit('normal_flow', normal_data, namespace='/')


def check_expired_flows():
    # audits expired flows: first threat intel feed, then ONNX autoencoder
    try:
        import numpy as np
        from globals import anomaly_model, autoencoder_scaler, autoencoder_threshold
        from globals import manual_whitelist, manual_whitelist_lock
        from security_modules.threat_intel import threat_intel
        from services.geolocator import geolocator
        
        expired = flow_manager.get_expired_flows()
        if expired is not None and not expired.empty:
            
            # Stage 1: threat intel check
            clean_indices = []
            
            for i, row in expired.iterrows():
                src_ip = row.get('src')
                dst_ip = row.get('dst')
                
                # Check if either endpoint exists in the global threat blocklist
                is_threat = threat_intel.is_malicious(src_ip) or threat_intel.is_malicious(dst_ip)
                
                if is_threat:
                    src_str = str(src_ip)
                    dst_str = str(dst_ip)
                    geo_info = geolocator.get_location(src_str)
                    if not geo_info:
                        geo_info = geolocator.get_location(dst_str)
                        
                    _emit_anomaly(row, 'Threat Intelligence Blocklist', 1.0, geo_info)
                else:
                    clean_indices.append(i)
                    
            if not clean_indices:
                return
                
            clean_expired = expired.loc[clean_indices]
            
            # Stage 2: deep learning/autoencoder check
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
                    
                    src_str = str(flow_info.get('src', 'N/A'))
                    dst_str = str(flow_info.get('dst', 'N/A'))
                    dport_int = int(flow_info.get('dport', 0))
                    
                    # Fetch Geolocation
                    geo_info = geolocator.get_location(src_str)
                    if not geo_info:
                        geo_info = geolocator.get_location(dst_str)
                    
                    if error > autoencoder_threshold:  # Statistical outlier detected
                        
                        # Verify against user-defined manual whitelist
                        is_whitelisted = False
                        with manual_whitelist_lock:
                            if (src_str, dst_str, dport_int) in manual_whitelist:
                                is_whitelisted = True
                        
                        if is_whitelisted:
                            from globals import baseline_manager
                            baseline_manager.save_flow(flow_info.to_dict())
                            if emitted_normals < 5:
                                _emit_normal_flow(src_str, dst_str, dport_int, error, geo_info)
                                emitted_normals += 1
                            continue
                        
                        _emit_anomaly(flow_info, 'AI Behavioral Anomaly', error, geo_info)
                    else:
                        # Flow confirmed as within statistical baseline
                        from globals import baseline_manager
                        baseline_manager.save_flow(flow_info.to_dict())
                        # Limit emissions per batch to optimize WebSocket bandwidth
                        if emitted_normals < 5:
                            _emit_normal_flow(src_str, dst_str, dport_int, error, geo_info)
                            emitted_normals += 1
            else:
                # Fallback: if model is not loaded (e.g. initial training phase),
                # treat all non-threat flows as normal baseline traffic so they display on frontend
                emitted_normals = 0
                for _, row in clean_expired.iterrows():
                    src_str = str(row.get('src', 'N/A'))
                    dst_str = str(row.get('dst', 'N/A'))
                    dport_int = int(row.get('dport', 0))
                    
                    geo_info = geolocator.get_location(src_str)
                    if not geo_info:
                        geo_info = geolocator.get_location(dst_str)
                        
                    from globals import baseline_manager
                    baseline_manager.save_flow(row.to_dict())
                        
                    if emitted_normals < 5:
                        _emit_normal_flow(src_str, dst_str, dport_int, 0.0, geo_info)
                        emitted_normals += 1

    except Exception as e:
        print(f"[ERROR] Flow analysis failed: {e}")

