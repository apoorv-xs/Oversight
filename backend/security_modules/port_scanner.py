"""
Network Port Scanner.
Scans common system ports to identify exposed services and assess potential
attack vectors based on service risk profiles.
"""
import socket
from datetime import datetime


class PortScanner:


    def __init__(self):
        self.common_ports = {
            21: {'service': 'FTP', 'description': 'File Transfer', 'risk': 'medium'},
            22: {'service': 'SSH', 'description': 'Secure Shell', 'risk': 'low'},
            23: {'service': 'Telnet', 'description': 'Remote Access (insecure)', 'risk': 'high'},
            25: {'service': 'SMTP', 'description': 'Email Server', 'risk': 'medium'},
            53: {'service': 'DNS', 'description': 'Domain Name Service', 'risk': 'low'},
            80: {'service': 'HTTP', 'description': 'Web Server', 'risk': 'medium'},
            110: {'service': 'POP3', 'description': 'Email Retrieval', 'risk': 'medium'},
            135: {'service': 'RPC', 'description': 'Windows RPC', 'risk': 'medium'},
            139: {'service': 'NetBIOS', 'description': 'Windows File Sharing', 'risk': 'medium'},
            143: {'service': 'IMAP', 'description': 'Email Access', 'risk': 'medium'},
            443: {'service': 'HTTPS', 'description': 'Secure Web Server', 'risk': 'low'},
            445: {'service': 'SMB', 'description': 'Windows File Sharing', 'risk': 'high'},
            3306: {'service': 'MySQL', 'description': 'Database Server', 'risk': 'high'},
            3389: {'service': 'RDP', 'description': 'Remote Desktop', 'risk': 'high'},
            5900: {'service': 'VNC', 'description': 'Remote Desktop', 'risk': 'high'},
            8080: {'service': 'HTTP-Alt', 'description': 'Alternative Web Server', 'risk': 'medium'},
            8443: {'service': 'HTTPS-Alt', 'description': 'Alternative Secure Web', 'risk': 'low'},
        }

        self.risk_descriptions = {
            'low': 'Standard service, generally safe if properly configured',
            'medium': 'Common service, ensure it is needed and secured',
            'high': 'Potentially risky service, verify it is intentionally exposed'
        }

    def scan(self, target='local'):
        """
        Scans a target host (defaults to localhost) for open common ports.
        
        Args:
            target (str): Target hostname or IP address.
        """
        try:
            if target == 'local':
                target_ip = '127.0.0.1'
                target_desc = 'your computer'
            else:
                target_ip = target
                target_desc = target

            open_ports = self._scan_ports(target_ip)

            analyzed = []
            high_risk = 0
            medium_risk = 0
            low_risk = 0

            for port in open_ports:
                analysis = self._analyze_port(port)
                analyzed.append(analysis)

                if analysis['risk_level'] == 'high':
                    high_risk += 1
                elif analysis['risk_level'] == 'medium':
                    medium_risk += 1
                else:
                    low_risk += 1

            overall_risk = self._calculate_overall_risk(high_risk, medium_risk, low_risk)

            return {
                'scan_time': datetime.now().isoformat(),
                'target': target_desc,
                'target_ip': target_ip,
                'total_ports_scanned': len(self.common_ports),
                'open_ports_count': len(analyzed),
                'high_risk': high_risk,
                'medium_risk': medium_risk,
                'low_risk': low_risk,
                'overall_risk': overall_risk,
                'ports': analyzed,
                'summary': self._generate_summary(len(analyzed), high_risk, medium_risk)
            }

        except Exception as e:
            return {
                'scan_time': datetime.now().isoformat(),
                'target': target,
                'error': str(e),
                'summary': 'Unable to complete port scan'
            }

    def _scan_ports(self, target_ip):
        """Attempts to establish TCP connections to a predefined list of sensitive ports."""
        open_ports = []

        for port in self.common_ports.keys():
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.5)
                result = sock.connect_ex((target_ip, port))

                if result == 0:
                    open_ports.append(port)

                sock.close()
            except:
                pass

        return open_ports

    def _analyze_port(self, port):
    # looks up the port in our known ports dict and builds the result object
        info = self.common_ports.get(port, {
            'service': 'Unknown',
            'description': 'Unknown Service',
            'risk': 'medium'
        })

        risk_level = info['risk']

        return {
            'port': port,
            'service': info['service'],
            'description': info['description'],
            'risk_level': risk_level,
            'risk_description': self.risk_descriptions.get(risk_level, 'Unknown risk level'),
            'user_friendly': self._get_friendly_description(port, info['service'], risk_level),
            'recommendation': self._get_recommendation(port, info['service'], risk_level)
        }

    def _get_friendly_description(self, port, service, risk):
    # short description shown in the port list on the dashboard
        if risk == 'high':
            return f"Port {port} ({service}) is open and accessible. This could be a security concern."
        elif risk == 'medium':
            return f"Port {port} ({service}) is open. This is a common service but verify you need it."
        else:
            return f"Port {port} ({service}) is open. This is a standard service."

    def _get_recommendation(self, port, service, risk):
    # the advice shown under each port entry
        if risk == 'high':
            return f"Consider closing port {port} ({service}) if you do not need this service, or ensure it is protected."
        elif risk == 'medium':
            return f"Review whether you need {service} running on port {port}."
        else:
            return f"Port {port} ({service}) appears to be operating normally."

    def _calculate_overall_risk(self, high, medium, low):
    # rolls up high/medium/low counts into one overall verdict
        if high > 0:
            return {
                'level': 'high',
                'color': 'red',
                'description': 'High risk - multiple sensitive ports are exposed'
            }
        elif medium > 2:
            return {
                'level': 'medium',
                'color': 'yellow',
                'description': 'Medium risk - several services are running'
            }
        elif medium > 0 or low > 0:
            return {
                'level': 'low',
                'color': 'green',
                'description': 'Low risk - standard services detected'
            }
        else:
            return {
                'level': 'none',
                'color': 'green',
                'description': 'No open ports detected - very secure'
            }

    def _generate_summary(self, total, high, medium):
    # summary line for the port scan card
        if total == 0:
            return "No open ports detected. Your system appears to be well-protected."
        elif high > 0:
            return f"Found {total} open ports, including {high} high-risk service(s). Review recommendations."
        elif medium > 0:
            return f"Found {total} open ports. Some may be unnecessary - review the list."
        else:
            return f"Found {total} open port(s). All appear to be low-risk services."
