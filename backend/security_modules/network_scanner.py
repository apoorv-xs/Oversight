"""
Nearby Network Scanner.
Discovers and evaluates the security posture of surrounding wireless networks
using the Windows native netsh API.
"""
import subprocess
import re
from datetime import datetime


class NetworkScanner:


    def __init__(self):
        self.security_levels = {
            'WPA3': 'Excellent',
            'WPA2': 'Good',
            'WPA': 'Moderate',
            'WEP': 'Poor',
            'Open': 'None'
        }

    def scan_nearby_networks(self):
        """
        Executes a passive scan for surrounding Wi-Fi networks and performs
        security classification for each discovered SSID.
        """
        try:
            networks = self._scan_windows_networks()

            analyzed = []
            secure_count = 0
            open_count = 0
            weak_count = 0

            for network in networks:
                analysis = self._analyze_network(network)
                analyzed.append(analysis)

                if analysis['security_rating'] in ['Excellent', 'Good']:
                    secure_count += 1
                elif analysis['security_rating'] == 'None':
                    open_count += 1
                else:
                    weak_count += 1

            return {
                'scan_time': datetime.now().isoformat(),
                'total_networks': len(analyzed),
                'secure_networks': secure_count,
                'open_networks': open_count,
                'weak_networks': weak_count,
                'networks': analyzed,
                'summary': self._generate_summary(secure_count, open_count, weak_count)
            }

        except Exception as e:
            return {
                'scan_time': datetime.now().isoformat(),
                'total_networks': 0,
                'networks': [],
                'error': str(e),
                'summary': 'Unable to scan for networks'
            }

    def _scan_windows_networks(self):
        """Invokes netsh to capture raw BSSID data and manages character encoding variability."""
        try:
            cmd = ['netsh', 'wlan', 'show', 'networks', 'mode=Bssid']
            result = subprocess.run(cmd, capture_output=True, timeout=30)

            if result.returncode != 0:
                return []

            output = result.stdout.decode('utf-8', errors='replace')
            if "SSID" not in output:
                output = result.stdout.decode('cp1252', errors='replace')

            return self._parse_networks(output)

        except Exception:
            return []

    def _parse_networks(self, output):
    # parses the raw netsh text line by line - bit fragile but works
        networks = []
        current_network = {}

        for line in output.split('\n'):
            line = line.strip()

            if re.search(r'(?i)^SSID\s*\d+', line):
                if current_network:
                    networks.append(current_network)
                current_network = {}
                match = re.search(r'(?i)SSID\s*\d+\s*:\s*(.*)', line)
                if match:
                    current_network['ssid'] = match.group(1).strip()

            elif 'Auth' in line and ':' in line:
                match = re.search(r'(?i)Authentic\w*\s*:\s*(.+)', line)
                if match:
                    current_network['authentication'] = match.group(1).strip()

            elif 'Encrypt' in line and ':' in line:
                match = re.search(r'(?i)Encrypt\w*\s*:\s*(.+)', line)
                if match:
                    current_network['encryption'] = match.group(1).strip()

            elif 'Signal' in line and ':' in line:
                match = re.search(r'(?i)Signal\s*:\s*(\d+)%', line)
                if match:
                    current_network['signal'] = int(match.group(1))

            elif 'BSSID' in line and ':' in line and len(line) > 15:
                match = re.search(r'(?i)BSSID\s*\d+\s*:\s*([\w:]+)', line)
                if match:
                    current_network['bssid'] = match.group(1).strip()

            elif 'Channel' in line and ':' in line:
                match = re.search(r'(?i)Channel\s*:\s*(\d+)', line)
                if match:
                    current_network['channel'] = int(match.group(1))

        if current_network:
            networks.append(current_network)

        return networks

    def _analyze_network(self, network):
    # figures out the security rating and colour for a network
        auth = network.get('authentication', 'Unknown')
        encryption = network.get('encryption', 'Unknown')

        if 'WPA3' in auth:
            rating = 'Excellent'
            color = 'green'
            risk = 'low'
        elif 'WPA2' in auth:
            rating = 'Good'
            color = 'green'
            risk = 'low'
        elif 'WPA' in auth:
            rating = 'Moderate'
            color = 'yellow'
            risk = 'medium'
        elif 'WEP' in auth:
            rating = 'Poor'
            color = 'red'
            risk = 'high'
        elif 'Open' in auth or encryption == 'None':
            rating = 'None'
            color = 'red'
            risk = 'critical'
        else:
            rating = 'Unknown'
            color = 'gray'
            risk = 'unknown'

        signal = network.get('signal', 0)
        if signal >= 80:
            signal_desc = 'Excellent'
        elif signal >= 60:
            signal_desc = 'Good'
        elif signal >= 40:
            signal_desc = 'Fair'
        else:
            signal_desc = 'Weak'

        return {
            'ssid': network.get('ssid', 'Hidden Network'),
            'bssid': network.get('bssid', 'Unknown'),
            'authentication': auth,
            'encryption': encryption,
            'signal_strength': signal,
            'signal_description': signal_desc,
            'channel': network.get('channel', 'Unknown'),
            'security_rating': rating,
            'color': color,
            'risk_level': risk,
            'user_friendly': self._get_friendly_description(rating, network.get('ssid', 'Hidden Network'))
        }

    def _get_friendly_description(self, rating, ssid):
    # just maps the rating to a plain english string for the ui
        descriptions = {
            'Excellent': f"'{ssid}' uses modern WPA3 security - the best available protection.",
            'Good': f"'{ssid}' uses WPA2 security - strong protection for everyday use.",
            'Moderate': f"'{ssid}' uses older WPA security - acceptable but could be better.",
            'Poor': f"'{ssid}' uses WEP security - easily hacked, avoid if possible.",
            'None': f"'{ssid}' has no password protection - anyone can connect.",
            'Unknown': f"'{ssid}' security status unknown."
        }
        return descriptions.get(rating, descriptions['Unknown'])

    def _generate_summary(self, secure, open_count, weak):
    # summary text for the network panel
        total = secure + open_count + weak

        if total == 0:
            return "No networks found in range."

        if open_count > 0:
            return f"Found {total} networks. Warning: {open_count} open networks detected."
        elif weak > 0:
            return f"Found {total} networks. {weak} networks use weak encryption."
        else:
            return f"Found {total} networks. All nearby networks appear secure."
