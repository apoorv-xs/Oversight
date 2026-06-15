from flask import Blueprint, render_template, jsonify, send_from_directory
from datetime import datetime
from globals import anomaly_model, VITE_DIST
import os

core_bp = Blueprint('core_bp', __name__)

@core_bp.route('/')
def index():
    # Serve Vite production build if available, otherwise fall back to dev template
    vite_index = os.path.join(VITE_DIST, 'index.html')
    if os.path.exists(vite_index):
        return send_from_directory(VITE_DIST, 'index.html')
    return render_template('index.html')

@core_bp.route('/assets/<path:filename>')
def vite_assets(filename):
    vite_assets_dir = os.path.join(VITE_DIST, 'assets')
    if os.path.exists(os.path.join(vite_assets_dir, filename)):
        return send_from_directory(vite_assets_dir, filename)
    return '', 404

@core_bp.route('/api/system-info')
def get_system_info():
    # grabs cpu, memory, hostname etc for the system info panel
    try:
        import platform
        import socket
        import psutil

        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)

        return jsonify({
            'status': 'success',
            'data': {
                'hostname': hostname,
                'local_ip': local_ip,
                'platform': platform.system(),
                'platform_version': platform.version(),
                'cpu_usage': psutil.cpu_percent(interval=1),
                'memory_usage': psutil.virtual_memory().percent,
                'timestamp': datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@core_bp.route('/api/health')
def health_check():
    # simple ping endpoint, also tells us if the model is loaded
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'ai_model_loaded': anomaly_model is not None
    })
