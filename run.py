import os
import sys

# Ensure UTF-8 output encoding for Windows command prompt
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Add the backend directory to the search path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from app import app, socketio, run_ml_training_if_needed
from threading import Thread

if __name__ == '__main__':
    print("=" * 60)
    print("OVERSIGHT: Adaptive Threat Engine")
    print("=" * 60)
    print("Initializing security modules...")
    print("Starting AI anomaly detection engine...")
    print("Access the dashboard at: http://localhost:5000")
    print("=" * 60)

    # Start ML training check in background
    training_thread = Thread(target=run_ml_training_if_needed, daemon=True)
    training_thread.start()

    # Run the Flask-SocketIO app
    debug_mode = os.getenv('OVERSIGHT_DEBUG', '').lower() in ('true', '1')
    socketio.run(app, host='127.0.0.1', port=5000, debug=debug_mode, use_reloader=False, allow_unsafe_werkzeug=debug_mode)
