# Oversight - Shared Application State and Config

import os
import sys
import queue
import pickle
from datetime import datetime
from threading import Lock, Event
from flask_socketio import SocketIO

# Paths & Imports
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ai_modules'))

from ai_modules.feature_extractor import FlowManager

# Socket.io config
socketio = SocketIO(cors_allowed_origins="*", async_mode='threading')

# Locks
traffic_stats_lock = Lock()
latest_results_lock = Lock()
manual_whitelist_lock = Lock()
capture_running = Event()

# Main state variables
latest_results = {}
manual_whitelist = set()  # Tracks (src_ip, dst_ip, dport) tuples for user-verified connections

capture_thread = None
capture_error = None  # Tracks any critical error from the capture thread
flow_manager = FlowManager(timeout=5)
traffic_stats_queue = queue.Queue(maxsize=1000)

# Traffic metrics & stats
traffic_stats = {
    'total_packets': 0,
    'total_bytes': 0,
    'active_flows': 0,
    'anomaly_count': 0,
    'blocklist_hits': 0,
    'packets_per_second': 0,
    'last_update': datetime.now().isoformat(),
    'top_talkers': [],
    'top_services': [],
    'longest_flows': [],
    'protocol_distribution': {},
    'recent_anomalies': []
}

def is_admin_user():
    # check if process has admin privileges
    import platform
    if platform.system() == 'Windows':
        import ctypes
        try:
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except:
            return False
    else:
        try:
            return os.getuid() == 0
        except:
            return False

def reset_traffic_stats():
    # reset traffic metrics
    with traffic_stats_lock:
        traffic_stats.clear()
        traffic_stats.update({
            'total_packets': 0,
            'total_bytes': 0,
            'active_flows': 0,
            'anomaly_count': 0,
            'blocklist_hits': 0,
            'packets_per_second': 0,
            'last_update': datetime.now().isoformat(),
            'top_talkers': [],
            'top_services': [],
            'longest_flows': [],
            'protocol_distribution': {},
            'recent_anomalies': []
        })


# AI Model setup
anomaly_model = None
autoencoder_scaler = None
autoencoder_threshold = 0.05  # Default threshold for anomaly detection

# Persistent Storage Paths
MODEL_DIR = os.path.join(PROJECT_ROOT, 'model')
MODEL_PATH = os.path.join(MODEL_DIR, 'autoencoder.onnx')
SCALER_PATH = os.path.join(MODEL_DIR, 'scaler.pkl')
THRESHOLD_PATH = os.path.join(MODEL_DIR, 'threshold.json')

def reload_model(initial_load=False):
    # loads/reloads the ONNX model, scaler, and threshold
    global anomaly_model, autoencoder_scaler, autoencoder_threshold
    try:
        import onnxruntime as ort
        import json
        
        if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH) and os.path.exists(THRESHOLD_PATH):
            # Initialize the ONNX inference session
            anomaly_model = ort.InferenceSession(MODEL_PATH)
            
            # Load the pre-processing scaler
            with open(SCALER_PATH, 'rb') as f:
                autoencoder_scaler = pickle.load(f)
                
            # Load the calibrated anomaly threshold
            with open(THRESHOLD_PATH, 'r') as f:
                autoencoder_threshold = json.load(f).get('threshold', 0.05)
            
            if initial_load:
                print(f"[INFO] AI model loaded successfully from {MODEL_DIR}")
        elif initial_load:
            print("[WARNING] No pre-trained model found. System will require initial training.")
            
    except ImportError:
        if initial_load:
            print("[ERROR] ONNX Runtime not found. Please install dependencies.")
    except Exception as e:
        if initial_load:
            print(f"[ERROR] Failed to load AI model: {e}")

# initial model load
reload_model(initial_load=True)

# adaptive training setup
from services.adaptive_trainer import BaselineManager
baseline_manager = BaselineManager(PROJECT_ROOT)
