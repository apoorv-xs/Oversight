# Oversight - Flask backend & WebSocket server

from flask import Flask, request
from flask_cors import CORS
from threading import Thread
import os
import sys

# add backend directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# shared state and sockets
from globals import PROJECT_ROOT, socketio

# routes
from routes.core import core_bp
from routes.security import security_bp
from routes.ai_traffic import ai_bp
from routes.reports import reports_bp

# init flask app
app = Flask(__name__,
    template_folder=os.path.join(PROJECT_ROOT, 'frontend_v2', 'templates'),
    static_folder=os.path.join(PROJECT_ROOT, 'frontend_v2', 'static')
)
app.config['SECRET_KEY'] = 'oversight-adaptive-threat-engine-secret'
CORS(app)

# init socketio
socketio.init_app(app)

# register blueprints
app.register_blueprint(core_bp)
app.register_blueprint(security_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(reports_bp)

# reset capture state on startup
from globals import capture_running
capture_running.clear()

@app.after_request
def add_header(response):
    # disable cache for api responses
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response


@socketio.on('connect')
def handle_connect():
    # socket client connected
    print(f"Client connected: {request.sid}")
    socketio.emit('connected', {'status': 'success', 'message': 'Connected to OVERSIGHT Real-time Engine'})

@socketio.on('disconnect')
def handle_disconnect():
    # socket client disconnected
    print(f"Client disconnected: {request.sid}")

def run_ml_training_if_needed():
    # train model if it doesn't exist yet
    from globals import baseline_manager
    baseline_manager.startup_retrain()

if __name__ == '__main__':
    print("ERROR: Please run the application using 'python run.py' from the project root.")
    sys.exit(1)
