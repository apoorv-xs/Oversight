"""
Wi-Fi Security Analyzer.
Evaluates the security posture of the current wireless connection, including 
encryption protocols, signal integrity, and potential risk levels.
"""
import subprocess
import socket


class WiFiAnalyzer:


    def __init__(self):
        self.security_levels = {
            'WPA3': {'level': 3, 'label': 'Excellent', 'color': 'green'},
            'WPA2': {'level': 3, 'label': 'Good', 'color': 'green'},
            'WPA': {'level': 2, 'label': 'Moderate', 'color': 'yellow'},
            'WEP': {'level': 1, 'label': 'Poor', 'color': 'red'},
            'Open': {'level': 0, 'label': 'No Security', 'color': 'red'},
            'Unknown': {'level': 1, 'label': 'Unknown', 'color': 'yellow'}
        }

    def analyze(self):
        """
        Main analysis pipeline. Retrieves Wi-Fi metadata and generates a security risk profile.
        """
        try:
            result = self._get_windows_wifi_info()

            if not result:
                return {
                    'connected': False,
                    'message': 'Not connected to Wi-Fi',
                    'risk_level': 'Unknown',
                    'risk_score': 0
                }

            security_type = result.get('Authentication', 'Unknown')
            cipher = result.get('Cipher', 'Unknown')

            if 'WPA3' in security_type:
                sec_info = self.security_levels['WPA3']
            elif 'WPA2' in security_type:
                sec_info = self.security_levels['WPA2']
            elif 'WPA' in security_type and 'WPA2' not in security_type:
                sec_info = self.security_levels['WPA']
            elif 'WEP' in security_type:
                sec_info = self.security_levels['WEP']
            elif 'Open' in security_type or security_type == '':
                sec_info = self.security_levels['Open']
            else:
                sec_info = self.security_levels['Unknown']

            risk_score = self._calculate_risk_score(result, sec_info)
            description = self._generate_description(result, sec_info)

            return {
                'connected': True,
                'network_name': result.get('SSID', 'Unknown'),
                'signal_strength': self._get_signal_description(result.get('Signal', '0%')),
                'signal_raw': result.get('Signal', '0%'),
                'security_type': security_type,
                'cipher': cipher,
                'bssid': result.get('BSSID', 'Unknown'),
                'channel': result.get('Channel', 'Unknown'),
                'ip_address': self._get_local_ip(),
                'risk_level': sec_info['label'],
                'risk_color': sec_info['color'],
                'risk_score': risk_score,
                'description': description,
                'recommendations': self._get_recommendations(sec_info)
            }

        except Exception as e:
            return {
                'connected': False,
                'message': f'Unable to analyze Wi-Fi: {str(e)}',
                'risk_level': 'Unknown',
                'risk_score': 0
            }

    def _get_windows_wifi_info(self):
        """Retrieves Wi-Fi interface details via netsh and parses the formatted output."""
        try:
            cmd = ['netsh', 'wlan', 'show', 'interfaces']
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

            if result.returncode != 0:
                return None

            output = result.stdout

            if "There is no wireless interface" in output:
                return None

            info = {}
            for line in output.split('\n'):
                line = line.strip()
                if ':' in line:
                    parts = line.split(':', 1)
                    if len(parts) == 2:
                        key = parts[0].strip()
                        value = parts[1].strip()
                        info[key] = value

            if not info.get('SSID'):
                return None

            return info

        except Exception:
            return None

    def _get_signal_description(self, signal_str):
    # converts the signal % string (e.g. '72%') into Excellent/Good/Fair/Weak
        try:
            signal = int(signal_str.replace('%', ''))
            if signal >= 80:
                return 'Excellent'
            elif signal >= 60:
                return 'Good'
            elif signal >= 40:
                return 'Fair'
            else:
                return 'Weak'
        except:
            return 'Unknown'

    def _get_local_ip(self):
    # just gets the local ip via socket
        try:
            hostname = socket.gethostname()
            return socket.gethostbyname(hostname)
        except:
            return 'Unknown'

    def _calculate_risk_score(self, result, sec_info):
    # scores 0-100, higher is better - based on security level + signal strength
        score = sec_info['level'] * 25

        try:
            signal = int(result.get('Signal', '0%').replace('%', ''))
            if signal < 30:
                score -= 10
        except:
            pass

        return max(0, min(100, score))

    def _generate_description(self, result, sec_info):
    # plain english description of the connection shown in the wifi card
        network = result.get('SSID', 'Unknown')
        security = sec_info['label']

        descriptions = {
            'Excellent': f"Your connection to '{network}' is secured with modern WPA3 encryption.",
            'Good': f"Your connection to '{network}' uses WPA2 encryption, providing strong security.",
            'Moderate': f"Your connection to '{network}' uses older WPA encryption. Consider upgrading.",
            'Poor': f"Your connection to '{network}' uses WEP encryption, which can be easily broken.",
            'No Security': f"Your connection to '{network}' is not encrypted. Anyone nearby can see your data.",
            'Unknown': f"Unable to determine the security level of your connection to '{network}'."
        }

        return descriptions.get(security, descriptions['Unknown'])

    def _get_recommendations(self, sec_info):
    # returns a list of recommendation objects based on how bad the security is
        recommendations = []

        if sec_info['label'] == 'No Security':
            recommendations.append({
                'priority': 'high',
                'title': 'Disconnect Immediately',
                'description': 'This network has no security. Do not access sensitive accounts.'
            })
        elif sec_info['label'] == 'Poor':
            recommendations.append({
                'priority': 'high',
                'title': 'Switch Networks',
                'description': 'WEP encryption is easily cracked. Use a different network.'
            })
        elif sec_info['label'] == 'Moderate':
            recommendations.append({
                'priority': 'medium',
                'title': 'Update Router',
                'description': 'Ask your network administrator to upgrade to WPA2 or WPA3.'
            })

        return recommendations
