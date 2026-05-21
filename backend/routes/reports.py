from flask import Blueprint, jsonify, make_response
from datetime import datetime
import copy
import csv
import io

from globals import latest_results, latest_results_lock, traffic_stats, traffic_stats_lock
from report_generator import ReportGenerator

reports_bp = Blueprint('reports_bp', __name__)

def _build_file_response(content, filename, content_type):
    # just a helper so i dont repeat the same 3 header lines in every route
    response = make_response(content)
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Content-Type"] = content_type
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

@reports_bp.route('/api/report/download')
def download_report():
    # generates the html report and sends it as a download
    try:
        report_gen = ReportGenerator()
        with latest_results_lock:
            results_copy = copy.deepcopy(latest_results)
        report_path = report_gen.generate(results_copy)

        with open(report_path, 'r', encoding='utf-8') as f:
            content = f.read()

        filename = f"OVERSIGHT-Report-{datetime.now().strftime('%Y%m%d-%H%M%S')}.html"
        return _build_file_response(content, filename, "text/html; charset=utf-8")
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@reports_bp.route('/api/report/download-pdf')
def download_report_pdf():
    # same as html but pdf - uses weasyprint under the hood
    try:
        report_gen = ReportGenerator()
        with latest_results_lock:
            results_copy = copy.deepcopy(latest_results)
        report_path = report_gen.generate_pdf(results_copy)

        with open(report_path, 'rb') as f:
            content = f.read()

        filename = f"OVERSIGHT-Report-{datetime.now().strftime('%Y%m%d-%H%M%S')}.pdf"
        return _build_file_response(content, filename, "application/pdf")
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@reports_bp.route('/api/anomalies/export-csv')
def export_anomalies_csv():
    # exports the anomaly list as csv so you can open it in excel
    try:
        with traffic_stats_lock:
            anomalies = copy.deepcopy(traffic_stats.get('recent_anomalies', []))

        if not anomalies:
            return jsonify({'status': 'error', 'message': 'No anomalies to export'}), 404

        report_gen = ReportGenerator()
        csv_content = report_gen.generate_anomaly_csv(anomalies)

        filename = f"OVERSIGHT-Anomalies-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
        return _build_file_response(csv_content, filename, "text/csv; charset=utf-8")
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@reports_bp.route('/api/report/export-scan-csv')
def export_scan_csv():
    # exports all the scan data (wifi/ports/vulns) as a csv
    try:
        output = io.StringIO()
        fieldnames = ['category', 'metric', 'value', 'status']
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        with latest_results_lock:
            results_copy = copy.deepcopy(latest_results)

        if 'wifi' in results_copy:
            wifi = results_copy['wifi']
            if wifi.get('connected'):
                writer.writerow({'category': 'Wi-Fi', 'metric': 'Network', 'value': wifi.get('network_name', ''), 'status': 'connected'})
                writer.writerow({'category': 'Wi-Fi', 'metric': 'Security', 'value': wifi.get('security_type', ''), 'status': wifi.get('risk_level', '')})
                writer.writerow({'category': 'Wi-Fi', 'metric': 'Signal', 'value': wifi.get('signal_raw', ''), 'status': wifi.get('signal_strength', '')})

        if 'ports' in results_copy:
            ports = results_copy['ports']
            writer.writerow({'category': 'Ports', 'metric': 'Open Ports', 'value': ports.get('open_ports_count', 0), 'status': ''})
            writer.writerow({'category': 'Ports', 'metric': 'High Risk', 'value': ports.get('high_risk', 0), 'status': 'high' if ports.get('high_risk', 0) > 0 else 'ok'})
            for port in ports.get('ports', []):
                writer.writerow({'category': 'Ports', 'metric': f"Port {port.get('port')}", 'value': port.get('service', ''), 'status': port.get('risk_level', '')})

        if 'vulnerabilities' in results_copy:
            vuln = results_copy['vulnerabilities']
            writer.writerow({'category': 'Vulnerabilities', 'metric': 'Total', 'value': vuln.get('total_vulnerabilities', 0), 'status': ''})
            writer.writerow({'category': 'Vulnerabilities', 'metric': 'Critical', 'value': vuln.get('critical_count', 0), 'status': 'critical' if vuln.get('critical_count', 0) > 0 else 'ok'})
            writer.writerow({'category': 'Vulnerabilities', 'metric': 'High', 'value': vuln.get('high_count', 0), 'status': 'high' if vuln.get('high_count', 0) > 0 else 'ok'})

        if 'risk' in results_copy:
            risk = results_copy['risk']
            writer.writerow({'category': 'Risk', 'metric': 'Score', 'value': risk.get('score', 0), 'status': risk.get('risk_level', '')})

        csv_content = output.getvalue()
        filename = f"OVERSIGHT-Scan-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
        return _build_file_response(csv_content, filename, "text/csv; charset=utf-8")
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
