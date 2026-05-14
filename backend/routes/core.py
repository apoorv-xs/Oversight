from flask import Blueprint, render_template, jsonify
from datetime import datetime
import os
from globals import PROJECT_ROOT, anomaly_model

core_bp = Blueprint('core_bp', __name__)

@core_bp.route('/')
def index():
    # just serves the main page
    return render_template('index.html')

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
