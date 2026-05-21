"""
Report Generator Module
Generates downloadable security reports in HTML, PDF, and CSV formats
"""
import csv
import io
from datetime import datetime
from jinja2 import Template
import os

try:
    from fpdf import FPDF
    FPDF_AVAILABLE = True
except ImportError:
    FPDF_AVAILABLE = False


class ReportGenerator:
    """Generates security reports in multiple formats."""

    def __init__(self):
        self.reports_dir = os.path.join(os.path.dirname(__file__), '..', 'reports')
        os.makedirs(self.reports_dir, exist_ok=True)

    def generate(self, data):
        """Generate HTML report from scan data."""
        report_html = self._create_html_template()
        template = Template(report_html)

        report_data = {
            'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'scan_date': data.get('last_scan', datetime.now().isoformat()),
            'wifi': data.get('wifi', {}),
            'nearby': data.get('nearby', {}),
            'ports': data.get('ports', {}),
            'vulnerabilities': data.get('vulnerabilities', {}),
            'risk': data.get('risk', {}),
            'recommendations': data.get('recommendations', {})
        }

        html_content = template.render(**report_data)

        filename = f"security-report-{datetime.now().strftime('%Y%m%d-%H%M%S')}.html"
        filepath = os.path.join(self.reports_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html_content)

        return filepath

    def generate_pdf(self, data):
        """Generate PDF report from scan data."""
        if not FPDF_AVAILABLE:
            raise ImportError("fpdf2 not installed. Run: pip install fpdf2")

        pdf = FPDF()
        pdf.add_page()
        pdf.set_auto_page_break(auto=True, margin=15)

        # Title
        pdf.set_font('Helvetica', 'B', 20)
        pdf.cell(0, 15, 'OVERSIGHT Security Report', ln=True, align='C')
        pdf.set_font('Helvetica', '', 11)
        pdf.cell(0, 8, f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}', ln=True, align='C')
        pdf.ln(10)

        # Risk Score Section
        if data.get('risk'):
            risk = data['risk']
            pdf.set_font('Helvetica', 'B', 14)
            pdf.cell(0, 10, 'Overall Security Score', ln=True)
            pdf.set_font('Helvetica', '', 12)
            score_color = {
                'green': (16, 185, 129),
                'yellow': (245, 158, 11),
                'orange': (249, 115, 22),
                'red': (239, 68, 68)
            }.get(risk.get('risk_color', 'gray'), (100, 100, 100))

            pdf.set_text_color(*score_color)
            pdf.set_font('Helvetica', 'B', 36)
            pdf.cell(0, 20, f"{risk.get('score', 0)}/100", ln=True, align='C')
            pdf.set_text_color(0, 0, 0)
            pdf.set_font('Helvetica', '', 12)
            pdf.cell(0, 8, f"Risk Level: {risk.get('risk_level', 'Unknown')}", ln=True, align='C')
            pdf.cell(0, 8, f"{risk.get('summary', '')}", ln=True, align='C')
            pdf.ln(5)

        # Wi-Fi Section
        if data.get('wifi') and data['wifi'].get('connected'):
            wifi = data['wifi']
            pdf.set_font('Helvetica', 'B', 14)
            pdf.cell(0, 10, 'Wi-Fi Security', ln=True)
            pdf.set_font('Helvetica', '', 11)
            pdf.cell(95, 8, f"Network: {wifi.get('network_name', 'N/A')}", ln=False)
            pdf.cell(95, 8, f"Security: {wifi.get('security_type', 'N/A')}", ln=True)
            pdf.cell(95, 8, f"Signal: {wifi.get('signal_strength', 'N/A')} ({wifi.get('signal_raw', 'N/A')})", ln=False)
            pdf.cell(95, 8, f"Risk: {wifi.get('risk_level', 'N/A')}", ln=True)
            pdf.ln(5)

        # Ports Section
        if data.get('ports'):
            ports = data['ports']
            pdf.set_font('Helvetica', 'B', 14)
            pdf.cell(0, 10, 'Open Ports', ln=True)
            pdf.set_font('Helvetica', '', 11)
            pdf.cell(60, 8, f"Total Open: {ports.get('open_ports_count', 0)}", ln=False)
            pdf.cell(60, 8, f"High Risk: {ports.get('high_risk', 0)}", ln=False)
            pdf.cell(60, 8, f"Medium Risk: {ports.get('medium_risk', 0)}", ln=True)

            # List ports
            for port in ports.get('ports', [])[:10]:
                risk_indicator = '*' if port.get('risk_level') == 'high' else ' '
                pdf.cell(0, 6, f"{risk_indicator} Port {port.get('port')} ({port.get('service')}) - {port.get('risk_level', 'unknown').upper()}", ln=True)
            pdf.ln(5)

        # Vulnerabilities Section
        if data.get('vulnerabilities'):
            vuln = data['vulnerabilities']
            pdf.set_font('Helvetica', 'B', 14)
            pdf.cell(0, 10, 'Vulnerabilities', ln=True)
            pdf.set_font('Helvetica', '', 11)
            pdf.cell(45, 8, f"Total: {vuln.get('total_vulnerabilities', 0)}", ln=False)
            pdf.cell(45, 8, f"Critical: {vuln.get('critical_count', 0)}", ln=False)
            pdf.cell(45, 8, f"High: {vuln.get('high_count', 0)}", ln=False)
            pdf.cell(45, 8, f"Medium: {vuln.get('medium_count', 0)}", ln=True)

            for v in vuln.get('vulnerabilities', [])[:10]:
                severity = v.get('severity', 'low').upper()
                pdf.cell(0, 6, f"[{severity}] {v.get('title', 'Issue')}", ln=True)
            pdf.ln(5)

        # Recommendations Section
        if data.get('recommendations'):
            recs = data['recommendations']
            pdf.set_font('Helvetica', 'B', 14)
            pdf.cell(0, 10, 'Recommendations', ln=True)
            pdf.set_font('Helvetica', '', 11)

            priority_map = {'critical': '[!!!]', 'high': '[!!]', 'medium': '[!]', 'low': '[.]'}
            for rec in recs.get('recommendations', [])[:15]:
                priority = rec.get('priority', 'low')
                marker = priority_map.get(priority, '[.]')
                title = rec.get('title', 'Recommendation')
                pdf.cell(0, 6, f"{marker} {title}", ln=True)
            pdf.ln(5)

        # Footer
        pdf.set_font('Helvetica', 'I', 9)
        pdf.set_text_color(128, 128, 128)
        pdf.cell(0, 10, 'Generated by OVERSIGHT | Adaptive Threat Engine', ln=True, align='C')

        filename = f"OVERSIGHT-Report-{datetime.now().strftime('%Y%m%d-%H%M%S')}.pdf"
        filepath = os.path.join(self.reports_dir, filename)
        pdf.output(filepath)
        return filepath

    def generate_anomaly_csv(self, anomalies):
        """Generate CSV export of anomaly data."""
        output = io.StringIO()
        fieldnames = ['timestamp', 'src', 'dst', 'sport', 'dport', 'protocol', 'duration', 'packets', 'bytes', 'severity']

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for anomaly in anomalies:
            row = {
                'timestamp': anomaly.get('timestamp', ''),
                'src': anomaly.get('src', ''),
                'dst': anomaly.get('dst', ''),
                'sport': anomaly.get('sport', ''),
                'dport': anomaly.get('dport', ''),
                'protocol': anomaly.get('protocol', 'TCP/UDP'),
                'duration': anomaly.get('duration', 0),
                'packets': anomaly.get('packets', 0),
                'bytes': anomaly.get('bytes', 0),
                'severity': 'anomaly'
            }
            writer.writerow(row)

        output.seek(0)
        return output.getvalue()

    def generate_scan_history_csv(self, scan_history):
        """Generate CSV export of scan history."""
        output = io.StringIO()
        fieldnames = ['timestamp', 'risk_score', 'risk_level', 'wifi_security', 'open_ports', 'vulnerabilities', 'recommendations']

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for scan in scan_history:
            row = {
                'timestamp': scan.get('timestamp', ''),
                'risk_score': scan.get('risk_score', 0),
                'risk_level': scan.get('risk_level', ''),
                'wifi_security': scan.get('wifi_security', ''),
                'open_ports': scan.get('open_ports', 0),
                'vulnerabilities': scan.get('vulnerabilities', 0),
                'recommendations': scan.get('recommendations', 0)
            }
            writer.writerow(row)

        output.seek(0)
        return output.getvalue()

    def _create_html_template(self):
        """Read HTML report template from file."""
        template_path = os.path.join(os.path.dirname(__file__), '..', 'frontend_v2', 'templates', 'report_template.html')
        try:
            with open(template_path, 'r', encoding='utf-8') as f:
                return f.read()
        except FileNotFoundError:
            return "<html><body><h1>Error: Report template not found</h1></body></html>"
