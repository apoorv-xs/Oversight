"""
OVERSIGHT: Adaptive Threat Engine
Main Application Entry Point

This script initializes the Flask application, registers blueprints, 
configures SocketIO for real-time communication, and starts the server.
"""

from flask import Flask, request
from flask_cors import CORS
from threading import Thread
import os
import sys

# Add backend directory to sys.path to ensure modular imports work correctly
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import shared application state and socket instance
from globals import PROJECT_ROOT, socketio

# Import API Blueprints
from routes.core import core_bp
from routes.security import security_bp
from routes.ai_traffic import ai_bp
from routes.reports import reports_bp

# Initialize Flask Application
app = Flask(__name__,
    template_folder=os.path.join(PROJECT_ROOT, 'frontend_v2', 'templates'),
    static_folder=os.path.join(PROJECT_ROOT, 'frontend_v2', 'static')
)
app.config['SECRET_KEY'] = 'oversight-adaptive-threat-engine-secret'
CORS(app)

# Initialize SocketIO
socketio.init_app(app)

# Register Blueprints for modular routing
app.register_blueprint(core_bp)
app.register_blueprint(security_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(reports_bp)

# Ensure packet capture state is reset on startup
from globals import capture_running
capture_running.clear()

@app.after_request
def add_header(response):
    """Disable caching for API endpoints and responses."""
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response


@socketio.on('connect')
def handle_connect():
    """Handles new WebSocket client connections."""
    print(f"Client connected: {request.sid}")
    socketio.emit('connected', {'status': 'success', 'message': 'Connected to OVERSIGHT Real-time Engine'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handles WebSocket client disconnections."""
    print(f"Client disconnected: {request.sid}")

def run_ml_training_if_needed():
    """
    Verifies the existence of a trained model on startup.
    If no model is found, it initiates the initial training process in the background.
    """
    from globals import baseline_manager
    baseline_manager.startup_retrain()

if __name__ == '__main__':
    print("ERROR: Please run the application using 'python run.py' from the project root.")
    sys.exit(1)
