from flask import Blueprint, jsonify, request
from datetime import datetime
import copy
from globals import latest_results, latest_results_lock, is_admin_user
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


@security_bp.route('/api/patch-vulnerability', methods=['POST'])
def patch_vulnerability():
    import subprocess
    
    try:
        data = request.get_json() or {}
        category = data.get('category', 'ALL')
        
        # Check for Administrator privileges
        is_admin = is_admin_user()
                
        results = []
        
        # Firewall remediation
        if category == 'ALL' or category == 'Firewall':
            try:
                cmd = ['netsh', 'advfirewall', 'set', 'currentprofile', 'state', 'on']
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                if res.returncode == 0:
                    results.append({
                        'category': 'Firewall',
                        'status': 'success',
                        'message': 'Windows Defender Firewall has been successfully enabled.'
                    })
                else:
                    err = res.stderr.strip() or 'Unknown access restriction'
                    results.append({
                        'category': 'Firewall',
                        'status': 'error',
                        'message': f'Failed to enable Firewall: {err}. Please run as Administrator.'
                    })
            except Exception as e:
                results.append({
                    'category': 'Firewall',
                    'status': 'error',
                    'message': f'Firewall patch error: {str(e)}'
                })
                
        # UAC remediation
        if category == 'ALL' or category == 'User Account Control':
            try:
                import winreg
                key_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
                try:
                    key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path, 0, winreg.KEY_SET_VALUE)
                    winreg.SetValueEx(key, "EnableLUA", 0, winreg.REG_DWORD, 1)
                    winreg.CloseKey(key)
                    results.append({
                        'category': 'User Account Control',
                        'status': 'success',
                        'message': 'UAC registry policy updated to Enabled. (Reboot required to take effect).'
                    })
                except PermissionError:
                    results.append({
                        'category': 'User Account Control',
                        'status': 'error',
                        'message': 'Failed to modify registry. Administrator privileges are required to enable UAC.'
                    })
            except Exception as e:
                results.append({
                    'category': 'User Account Control',
                    'status': 'error',
                    'message': f'UAC patch error: {str(e)}'
                })
                
        # Remote Services remediation (RemoteRegistry, TlntSvr)
        if category == 'ALL' or category == 'Remote Services':
            services_to_disable = ['RemoteRegistry', 'TlntSvr']
            service_results = []
            for srv in services_to_disable:
                try:
                    # Check if service is installed
                    check_cmd = ['sc', 'query', srv]
                    check_res = subprocess.run(check_cmd, capture_output=True, text=True, timeout=5)
                    if srv in check_res.stdout:
                        # Stop service
                        stop_cmd = ['sc', 'stop', srv]
                        stop_res = subprocess.run(stop_cmd, capture_output=True, text=True, timeout=5)
                        # Disable service
                        config_cmd = ['sc', 'config', srv, 'start=', 'disabled']
                        config_res = subprocess.run(config_cmd, capture_output=True, text=True, timeout=5)
                        
                        if stop_res.returncode == 0 or config_res.returncode == 0:
                            service_results.append(f'Stopped and disabled risky service: {srv}.')
                        else:
                            service_results.append(f'Failed to modify service: {srv} (requires admin).')
                except Exception as e:
                    service_results.append(f'Error managing service {srv}: {str(e)}')
            
            if service_results:
                results.append({
                    'category': 'Remote Services',
                    'status': 'success' if any('Stopped' in r for r in service_results) else 'error',
                    'message': ' | '.join(service_results)
                })
                
        # Open Ports block rules remediation
        if category == 'ALL' or category == 'Ports':
            with latest_results_lock:
                port_data = latest_results.get('ports', {})
            high_risk_ports = [p for p in port_data.get('ports', []) if p.get('risk_level') == 'high']
            
            port_results = []
            for p_info in high_risk_ports:
                port_num = p_info.get('port')
                if port_num:
                    try:
                        port_int = int(port_num)
                        if port_int < 1 or port_int > 65535:
                            raise ValueError("Port must be in range 1-65535")
                        
                        cmd = ['netsh', 'advfirewall', 'firewall', 'add', 'rule', 
                               f'name=Oversight Block Port {port_int}', 'dir=in', 'action=block', 'protocol=TCP', f'localport={port_int}']
                        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                        if res.returncode == 0:
                            port_results.append(f'Successfully blocked port {port_num} in local firewall.')
                        else:
                            port_results.append(f'Failed to block port {port_num}: {res.stderr.strip()} (requires admin).')
                    except Exception as e:
                        port_results.append(f'Error blocking port {port_num}: {str(e)}')
            
            if port_results:
                results.append({
                    'category': 'Ports',
                    'status': 'success' if any('Successfully' in r for r in port_results) else 'error',
                    'message': ' | '.join(port_results)
                })
                
        return jsonify({
            'status': 'success',
            'data': results,
            'is_admin': is_admin
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

