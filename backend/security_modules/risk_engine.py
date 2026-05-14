"""
System Risk Assessment Engine.
Calculates a unified security risk score by weighting results from the Wi-Fi,
Vulnerability, and Port scan subsystems.
"""
from datetime import datetime


class RiskScoreEngine:


    def __init__(self):
        self.weights = {
            'wifi': 0.35,
            'vulnerabilities': 0.35,
            'ports': 0.30
        }

    def calculate(self, wifi_data, vuln_data, port_data):
        """
        Combines disparate security metrics into a single representative score (0-100).
        """
        try:
            wifi_score = self._calculate_wifi_score(wifi_data)
            vuln_score = self._calculate_vuln_score(vuln_data)
            port_score = self._calculate_port_score(port_data)

            total_score = (
                wifi_score * self.weights['wifi'] +
                vuln_score * self.weights['vulnerabilities'] +
                port_score * self.weights['ports']
            )

            total_score = round(total_score)

            if total_score >= 80:
                risk_level = 'Low Risk'
                risk_color = 'green'
                emoji = ''
            elif total_score >= 60:
                risk_level = 'Moderate Risk'
                risk_color = 'yellow'
                emoji = ''
            elif total_score >= 40:
                risk_level = 'High Risk'
                risk_color = 'orange'
                emoji = ''
            else:
                risk_level = 'Critical Risk'
                risk_color = 'red'
                emoji = ''

            factors = []

            if wifi_score < 60:
                factors.append('Wi-Fi security needs improvement')
            if vuln_score < 60:
                factors.append('System vulnerabilities detected')
            if port_score < 60:
                factors.append('Open ports pose risks')

            if not factors:
                factors.append('Your security posture looks good')

            return {
                'score': total_score,
                'risk_level': risk_level,
                'risk_color': risk_color,
                'emoji': emoji,
                'calculation_time': datetime.now().isoformat(),
                'component_scores': {
                    'ports': round(port_score)
                },
                'risk_factors': factors,
                'summary': self._generate_summary(total_score, risk_level)
            }

        except Exception as e:
            return {
                'score': 0,
                'risk_level': 'Unknown',
                'risk_color': 'gray',
                'emoji': '?',
                'error': str(e),
                'summary': 'Unable to calculate risk score'
            }

    def _calculate_wifi_score(self, wifi_data):
        """Derives a numerical score from Wi-Fi security levels and signal metrics."""
        if not wifi_data.get('connected', False):
            return 0

        base_score = wifi_data.get('risk_score', 0)

        try:
            signal = wifi_data.get('signal_raw', '0%')
            signal_val = int(signal.replace('%', ''))
            if signal_val < 30:
                base_score -= 10
        except:
            pass

        return max(0, min(100, base_score))

    def _calculate_vuln_score(self, vuln_data):
    # maps the vuln status string to a score (Good=90, Critical=20 etc)
        status = vuln_data.get('status', 'Unknown')

        scores = {
            'Good': 90,
            'Moderate': 65,
            'High Risk': 40,
            'Critical': 20,
            'Unknown': 50
        }

        return scores.get(status, 50)

    def _calculate_port_score(self, port_data):
    # maps port risk level to a score
        risk_level = port_data.get('overall_risk', {}).get('level', 'medium')

        scores = {
            'none': 95,
            'low': 80,
            'medium': 60,
            'high': 30
        }

        return scores.get(risk_level, 50)

    def _generate_summary(self, score, level):
    # returns a short description to show in the dashboard
        if score >= 80:
            return f"Excellent! Your risk score is {score}/100. Your security is in good shape."
        elif score >= 60:
            return f"Your risk score is {score}/100. There is room for improvement."
        elif score >= 40:
            return f"Your risk score is {score}/100. Several issues need attention."
        else:
            return f"Critical! Your risk score is {score}/100. Immediate action recommended."
