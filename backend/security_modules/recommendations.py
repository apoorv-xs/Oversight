"""
Security Recommendations Engine.
Synthesizes data from various scan modules to produce an actionable,
prioritized list of security remediation steps.
"""
from datetime import datetime


class RecommendationsEngine:


    def __init__(self):
        self.recommendations = []

    def generate(self, risk_data, all_results):
        """
        Processes scan data to populate the prioritized recommendations list.
        
        Args:
            risk_data (dict): Overall risk metrics from the risk engine.
            all_results (dict): Consolidated raw results from individual scanners.
        """
        self.recommendations = []

        if 'wifi' in all_results:
            self._analyze_wifi(all_results['wifi'])

        if 'vulnerabilities' in all_results:
            self._analyze_vulnerabilities(all_results['vulnerabilities'])

        if 'ports' in all_results:
            self._analyze_ports(all_results['ports'])

        self._add_general_recommendations(risk_data)

        priority_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
        self.recommendations.sort(key=lambda x: priority_order.get(x['priority'], 4))

        critical = [r for r in self.recommendations if r['priority'] == 'critical']
        high = [r for r in self.recommendations if r['priority'] == 'high']
        medium = [r for r in self.recommendations if r['priority'] == 'medium']
        low = [r for r in self.recommendations if r['priority'] == 'low']

        return {
            'generated_at': datetime.now().isoformat(),
            'total_recommendations': len(self.recommendations),
            'critical_count': len(critical),
            'high_count': len(high),
            'medium_count': len(medium),
            'low_count': len(low),
            'recommendations': self.recommendations,
            'prioritized': {
                'critical': critical,
                'high': high,
                'medium': medium,
                'low': low
            },
            'summary': self._generate_summary(len(critical), len(high), len(medium))
        }

    def _analyze_wifi(self, wifi_data):
        """Analyzes Wi-Fi results to generate connectivity and encryption recommendations."""
        if not wifi_data.get('connected', False):
            self.recommendations.append({
                'category': 'Network',
                'title': 'Connect to a Secure Network',
                'description': 'You are not connected to a Wi-Fi network. Use a trusted network.',
                'priority': 'high',
                'icon': 'wifi-off',
                'action': 'Connect to a known secure Wi-Fi network'
            })
            return

        risk_level = wifi_data.get('risk_level', '')

        if risk_level == 'No Security':
            self.recommendations.append({
                'category': 'Network',
                'title': 'Avoid Open Networks',
                'description': f"You are connected to an unencrypted network. Do not access sensitive accounts.",
                'priority': 'critical',
                'icon': 'alert-triangle',
                'action': 'Disconnect and use a secured network (WPA2 or WPA3)'
            })
        elif risk_level == 'Poor':
            self.recommendations.append({
                'category': 'Network',
                'title': 'Upgrade Network Security',
                'description': 'Your network uses WEP encryption which can be easily cracked.',
                'priority': 'critical',
                'icon': 'shield-alert',
                'action': 'Ask your network administrator to upgrade to WPA2 or WPA3'
            })
        elif risk_level == 'Moderate':
            self.recommendations.append({
                'category': 'Network',
                'title': 'Consider Network Upgrade',
                'description': 'Your network uses WPA encryption. Consider upgrading to WPA2 or WPA3.',
                'priority': 'medium',
                'icon': 'shield',
                'action': 'Contact your network administrator about upgrading router firmware'
            })

        signal_desc = wifi_data.get('signal_strength', '')
        if signal_desc == 'Weak':
            self.recommendations.append({
                'category': 'Network',
                'title': 'Improve Wi-Fi Signal',
                'description': 'Your Wi-Fi signal is weak, which can cause connection issues.',
                'priority': 'low',
                'icon': 'signal',
                'action': 'Move closer to your router or check for interference'
            })

    def _analyze_vulnerabilities(self, vuln_data):
    # converts critical/high vulns into recommendation cards
        for vuln in vuln_data.get('vulnerabilities', []):
            if vuln.get('severity') == 'critical':
                self.recommendations.append({
                    'category': 'System',
                    'title': vuln.get('title', 'Critical Issue'),
                    'description': vuln.get('description', ''),
                    'priority': 'critical',
                    'icon': vuln.get('icon', 'alert-circle'),
                    'action': vuln.get('recommendation', 'Address immediately')
                })
            elif vuln.get('severity') == 'high':
                self.recommendations.append({
                    'category': 'System',
                    'title': vuln.get('title', 'High Priority Issue'),
                    'description': vuln.get('description', ''),
                    'priority': 'high',
                    'icon': vuln.get('icon', 'alert-circle'),
                    'action': vuln.get('recommendation', 'Address soon')
                })

    def _analyze_ports(self, port_data):
    # flags high risk ports and adds them as recommendations
        high_risk = port_data.get('high_risk', 0)

        if high_risk > 0:
            high_risk_ports = [p for p in port_data.get('ports', [])
                               if p.get('risk_level') == 'high']

            for port in high_risk_ports[:3]:
                self.recommendations.append({
                    'category': 'Ports',
                    'title': f"Close Port {port.get('port')} ({port.get('service')})",
                    'description': port.get('user_friendly', ''),
                    'priority': 'high',
                    'icon': 'lock',
                    'action': port.get('recommendation', 'Review and close if unnecessary')
                })

        elif port_data.get('medium_risk', 0) > 3:
            self.recommendations.append({
                'category': 'Ports',
                'title': 'Review Open Ports',
                'description': 'You have multiple services running that may not be needed.',
                'priority': 'medium',
                'icon': 'search',
                'action': 'Review the list of open ports and close unnecessary services'
            })

    def _add_general_recommendations(self, risk_data):
    # adds general stuff like keep firewall on, stay updated etc
        score = risk_data.get('score', 50)

        if score < 40:
            self.recommendations.append({
                'category': 'General',
                'title': 'Security Audit Recommended',
                'description': 'Your overall security score is critically low. Consider a comprehensive security review.',
                'priority': 'critical',
                'icon': 'alert-octagon',
                'action': 'Work through all critical and high priority recommendations'
            })
        elif score < 60:
            self.recommendations.append({
                'category': 'General',
                'title': 'Improve Your Security',
                'description': 'Your security score indicates room for improvement.',
                'priority': 'medium',
                'icon': 'trending-up',
                'action': 'Follow the recommendations above to improve your score'
            })

        existing_categories = {r['category'] for r in self.recommendations}

        if 'Firewall' not in existing_categories:
            self.recommendations.append({
                'category': 'General',
                'title': 'Keep Firewall Enabled',
                'description': 'Ensure your Windows Firewall is always enabled for basic protection.',
                'priority': 'low',
                'icon': 'shield',
                'action': 'Check Windows Security settings'
            })

        self.recommendations.append({
            'category': 'General',
            'title': 'Stay Updated',
            'description': 'Keep your operating system and applications updated with the latest security patches.',
            'priority': 'medium',
            'icon': 'refresh-cw',
            'action': 'Enable automatic Windows updates'
        })

    def _generate_summary(self, critical, high, medium):
    # summary line for the recommendations panel
        total_actions = critical + high + medium

        if critical > 0:
            return f"Found {total_actions} recommended actions including {critical} critical item(s) requiring immediate attention."
        elif high > 0:
            return f"Found {total_actions} recommended actions including {high} high priority item(s)."
        elif medium > 0:
            return f"Found {total_actions} recommended actions to improve your security."
        else:
            return "Your security looks good. Follow best practices to stay protected."
