from flask import Blueprint, jsonify, request
from datetime import datetime
import copy
from globals import latest_results, latest_results_lock
from security_modules.wifi_analyzer import WiFiAnalyzer
from security_modules.network_scanner import NetworkScanner
from security_modules.port_scanner import PortScanner
from security_modules.vulnerability_scanner import VulnerabilityScanner
from security_modules.risk_engine import RiskScoreEngine
from security_modules.recommendations import RecommendationsEngine

security_bp = Blueprint('security_bp', __name__)

# Initialize security modules
wifi_analyzer = WiFiAnalyzer()
network_scanner = NetworkScanner()
port_scanner = PortScanner()
vuln_scanner = VulnerabilityScanner()
risk_engine = RiskScoreEngine()
recommendations = RecommendationsEngine()

@security_bp.route('/api/wifi-security')
def get_wifi_security():
    # returns wifi security info for the current connection
    try:
        result = wifi_analyzer.analyze()
        with latest_results_lock:
            latest_results['wifi'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/nearby-networks')
def get_nearby_networks():
    # scans for nearby networks using netsh
    try:
        result = network_scanner.scan_nearby_networks()
        with latest_results_lock:
            latest_results['nearby'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/port-scan')
def get_port_scan():
    # port scan, target defaults to local machine
    try:
        target = request.args.get('target', 'local')
        result = port_scanner.scan(target)
        with latest_results_lock:
            latest_results['ports'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/vulnerability-scan')
def get_vulnerability_scan():
    # checks firewall, UAC, services etc
    try:
        result = vuln_scanner.scan()
        with latest_results_lock:
            latest_results['vulnerabilities'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/endpoint-scan')
def get_endpoint_scan():
    # simulates checking EDR/AV status
    try:
        result = {'status': 'Active', 'protection_level': 'High'}
        with latest_results_lock:
            latest_results['endpoint'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/risk-score')
def get_risk_score():
    # combines wifi + vuln + port data into one score
    try:
        wifi_data = wifi_analyzer.analyze()
        vuln_data = vuln_scanner.scan()
        port_data = port_scanner.scan('local')
        result = risk_engine.calculate(wifi_data, vuln_data, port_data)
        with latest_results_lock:
            latest_results['risk'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/recommendations')
def get_recommendations():
    # generates recommendations based on scan results
    try:
        with latest_results_lock:
            if 'risk' not in latest_results:
                wifi_data = wifi_analyzer.analyze()
                vuln_data = vuln_scanner.scan()
                port_data = port_scanner.scan('local')
                risk_data = risk_engine.calculate(wifi_data, vuln_data, port_data)
                latest_results['risk'] = risk_data
            else:
                risk_data = latest_results['risk']
            results_copy = copy.deepcopy(latest_results)

        result = recommendations.generate(risk_data, results_copy)
        with latest_results_lock:
            latest_results['recommendations'] = result
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@security_bp.route('/api/full-scan', methods=['POST'])
def run_full_scan():
    # runs everything at once, used by the full scan button
    try:
        results = {}
        results['wifi'] = wifi_analyzer.analyze()
        results['ports'] = port_scanner.scan('local')
        results['vulnerabilities'] = vuln_scanner.scan()
        results['endpoint'] = {'status': 'Active', 'protection_level': 'High'}
        results['risk'] = risk_engine.calculate(
            results['wifi'],
            results['vulnerabilities'],
            results['ports']
        )
        results['recommendations'] = recommendations.generate(
            results['risk'],
            results
        )

        with latest_results_lock:
            latest_results.update(results)
            latest_results['last_scan'] = datetime.now().isoformat()

        return jsonify({'status': 'success', 'data': results})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
