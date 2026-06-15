from flask import Blueprint, jsonify, request
from datetime import datetime
import copy
import time
import globals
from globals import traffic_stats, traffic_stats_lock, capture_running, flow_manager, is_admin_user, reset_traffic_stats
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
            traffic_stats['active_flows'] = flow_manager.get_active_flow_count()
            traffic_stats['last_update'] = datetime.now().isoformat()
            stats_copy = copy.deepcopy(traffic_stats)

        return jsonify({'status': 'success', 'data': stats_copy})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/start-capture', methods=['POST'])
def start_capture():
    """Initiates the Scapy packet capture thread on the specified or default interface."""
    try:
        # Check for Administrator/root privileges (soft warning only)
        is_admin = is_admin_user()
        warning_msg = None
        if not is_admin:
            warning_msg = 'Running without Administrator/root privileges. Raw packet interception might be restricted depending on system policies.'

        data = request.get_json() or {}
        interface_name = data.get('interface', None)

        with globals.capture_lock:
            if capture_running.is_set():
                return jsonify({'status': 'error', 'message': 'Capture already running'}), 400

            # Also check if old thread is still alive (safety net)
            old_thread = getattr(globals, 'capture_thread', None)
            if old_thread and old_thread.is_alive():
                return jsonify({'status': 'error', 'message': 'Capture thread is still active'}), 400

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

            # Reset traffic statistics and flow manager tracking before starting new session
            print(f"[{datetime.now()}] /api/start-capture called. Resetting traffic_stats.")

            reset_traffic_stats()
            flow_manager.clear_flows()

            print(f"[{datetime.now()}] traffic_stats reset completed. total_packets={traffic_stats.get('total_packets')}")

            bpf_filter = data.get('bpf_filter', 'ip')

            globals.capture_error = None
            capture_running.set()
            globals.capture_thread = PacketCaptureThread(
                selected_interface['name'],
                packet_callback,
                bpf_filter=bpf_filter
            )
            globals.capture_thread.daemon = True
            globals.capture_thread.start()

        return jsonify({
            'status': 'success',
            'message': f'Capture started on {selected_interface["name"]}',
            'interface': selected_interface,
            'warning': warning_msg
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/stop-capture', methods=['POST'])
def stop_capture():
    """Signals the capture thread to terminate, flushes training data, and resets capture state."""
    try:
        print(f"[{datetime.now()}] /api/stop-capture called.")

        if not capture_running.is_set():
            return jsonify({'status': 'error', 'message': 'No capture running'}), 400

        with globals.capture_lock:
            if globals.capture_thread:
                globals.capture_thread.stop()
            capture_running.clear()
            time.sleep(0.5)  # Allow thread cleanup time

            # Flush any remaining buffered normal flows to the training baseline CSV
            from globals import baseline_manager
            baseline_manager.flush()
            print(f"[{datetime.now()}] Baseline buffer flushed to disk on engine stop.")

            # Reset traffic stats so next engine start begins from 0
            reset_traffic_stats()

            # Reset the flow manager so stale flows don't carry over
            flow_manager.clear_flows()

            globals.capture_thread = None

        print(f"[{datetime.now()}] Traffic stats and flow manager reset.")

        return jsonify({'status': 'success', 'message': 'Capture stopped, data flushed to training baseline'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/capture-status')
def get_capture_status():
    """Provides a quick status check to synchronize the frontend UI with the backend capture state."""
    with traffic_stats_lock:
        traffic_stats['active_flows'] = flow_manager.get_active_flow_count()
        stats_copy = copy.deepcopy(traffic_stats)
    
    capture_err = getattr(globals, 'capture_error', None)
    return jsonify({
        'status': 'success',
        'data': {
            'capturing': capture_running.is_set(),
            'stats': stats_copy,
            'error': capture_err
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
            from globals import manual_whitelist, manual_whitelist_lock
            with manual_whitelist_lock:
                manual_whitelist.add((str(src), str(dst), int(dport)))
        
        if not raw_features:
            return jsonify({'status': 'error', 'message': 'No raw features provided'}), 400
            
        from globals import baseline_manager
        baseline_manager.save_flow(raw_features)
        
        return jsonify({'status': 'success', 'message': 'Flow whitelisted and saved to baseline'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/update-timeout', methods=['POST'])
def update_timeout():
    """
    Dynamically updates the flow manager timeout.
    """
    try:
        data = request.get_json() or {}
        new_timeout = data.get('timeout')
        if new_timeout is None:
            return jsonify({'status': 'error', 'message': 'No timeout value provided'}), 400
        
        try:
            new_timeout = float(new_timeout)
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid timeout value'}), 400

        if new_timeout < 2 or new_timeout > 60:
            return jsonify({'status': 'error', 'message': 'Timeout must be between 2 and 60 seconds'}), 400

        flow_manager.timeout = new_timeout
        
        print(f"[{datetime.now()}] Flow manager timeout dynamically updated to {new_timeout}s.")
        return jsonify({'status': 'success', 'message': f'Timeout updated to {new_timeout} seconds'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/whitelist', methods=['GET'])
def get_whitelist():
    """
    Returns the list of manually whitelisted connection vectors.
    """
    try:
        from globals import manual_whitelist, manual_whitelist_lock
        # Convert set of tuples to list of dicts for JSON representation
        with manual_whitelist_lock:
            whitelist_list = [{'src': item[0], 'dst': item[1], 'dport': item[2]} for item in manual_whitelist]
        return jsonify({'status': 'success', 'data': whitelist_list})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@ai_bp.route('/api/whitelist/delete', methods=['POST'])
def delete_whitelist():
    """
    Deletes a whitelisted connection vector.
    """
    try:
        data = request.get_json() or {}
        src = data.get('src')
        dst = data.get('dst')
        dport = data.get('dport')
        if src and dst and dport is not None:
            from globals import manual_whitelist, manual_whitelist_lock
            entry = (str(src), str(dst), int(dport))
            with manual_whitelist_lock:
                if entry in manual_whitelist:
                    manual_whitelist.remove(entry)
                    return jsonify({'status': 'success', 'message': 'Entry removed from whitelist'})
        return jsonify({'status': 'error', 'message': 'Entry not found in whitelist'}), 404
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

