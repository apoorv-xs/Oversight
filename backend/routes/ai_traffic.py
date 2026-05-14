from flask import Blueprint, jsonify, request
from datetime import datetime
import copy
import time
import globals
from globals import traffic_stats, traffic_stats_lock, capture_running, flow_manager
from ai_modules.packet_capture import list_interfaces_safe, PacketCaptureThread
from services.packet_handler import packet_callback

ai_bp = Blueprint('ai_bp', __name__)

@ai_bp.route('/api/network-interfaces')
def get_network_interfaces():
    """Returns a list of all available network interfaces on the host system."""
    try:
        interfaces = list_interfaces_safe()
        return jsonify({'status': 'success', 'data': interfaces})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/traffic-stats')
def get_traffic_stats():
    """Retrieves real-time packet statistics, flow counts, and anomaly metrics."""
    try:
        with traffic_stats_lock:
            traffic_stats['active_flows'] = len(flow_manager.flows)
            traffic_stats['last_update'] = datetime.now().isoformat()
            stats_copy = copy.deepcopy(traffic_stats)

        return jsonify({'status': 'success', 'data': stats_copy})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/start-capture', methods=['POST'])
def start_capture():
    """Initiates the Scapy packet capture thread on the specified or default interface."""
    try:
        data = request.get_json() or {}
        interface_name = data.get('interface', None)

        if capture_running.is_set():
            return jsonify({'status': 'error', 'message': 'Capture already running'}), 400

        # Enumerate interfaces to find a match or suitable fallback
        interfaces = list_interfaces_safe()
        if not interfaces:
            return jsonify({'status': 'error', 'message': 'No network interfaces found'}), 400

        selected_interface = None
        if interface_name:
            selected_interface = next((i for i in interfaces if i['name'] == interface_name), None)
        
        # Fallback logic: prefer Wi-Fi, otherwise first working interface
        if not selected_interface:
            for iface in interfaces:
                if 'Wi-Fi' in iface['name'] or 'Wi-Fi' in iface.get('description', ''):
                    selected_interface = iface
                    break
            if not selected_interface:
                selected_interface = interfaces[0]

        capture_running.set()
        globals.capture_thread = PacketCaptureThread(
            selected_interface['name'],
            packet_callback,
            capture_running
        )
        globals.capture_thread.daemon = True
        globals.capture_thread.start()

        return jsonify({
            'status': 'success',
            'message': f'Capture started on {selected_interface["name"]}',
            'interface': selected_interface
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/stop-capture', methods=['POST'])
def stop_capture():
    """Signals the capture thread to terminate and resets the capture state."""
    try:
        if not capture_running.is_set():
            return jsonify({'status': 'error', 'message': 'No capture running'}), 400

        capture_running.clear()
        time.sleep(0.5)  # Allow thread cleanup time

        return jsonify({'status': 'success', 'message': 'Capture stopped'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/capture-status')
def get_capture_status():
    """Provides a quick status check to synchronize the frontend UI with the backend capture state."""
    with traffic_stats_lock:
        traffic_stats['active_flows'] = len(flow_manager.flows)
        stats_copy = copy.deepcopy(traffic_stats)
    return jsonify({
        'status': 'success',
        'data': {
            'capturing': capture_running.is_set(),
            'stats': stats_copy
        }
    })

@ai_bp.route('/api/adaptive-stats')
def get_adaptive_stats():
    """Retrieves progress metrics for the adaptive learning pipeline (baseline accumulation)."""
    try:
        from globals import baseline_manager
        stats = baseline_manager.get_stats()
        return jsonify({'status': 'success', 'data': stats})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/mark-normal', methods=['POST'])
def mark_normal():
    """
    Manually classifies a connection as normal.
    Updates the local whitelist and persists the flow for future model retraining.
    """
    try:
        data = request.get_json() or {}
        raw_features = data.get('raw_features')
        
        # Immediately whitelist connection to suppress future AI alerts
        src = data.get('src')
        dst = data.get('dst')
        dport = data.get('dport')
        if src and dst and dport is not None:
            from globals import manual_whitelist
            manual_whitelist.add((str(src), str(dst), int(dport)))
        
        if not raw_features:
            return jsonify({'status': 'error', 'message': 'No raw features provided'}), 400
            
        from globals import baseline_manager
        baseline_manager.save_flow(raw_features)
        
        return jsonify({'status': 'success', 'message': 'Flow whitelisted and saved to baseline'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

