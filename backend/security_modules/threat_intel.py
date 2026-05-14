import requests
import time
import threading

class ThreatIntel:
    """
    Local Threat Intelligence Engine.
    Maintains an in-memory cache of the FireHOL blocklist to identify known malicious IP addresses.
    The cache is refreshed every 24 hours to ensure up-to-date protection.
    """
    
    def __init__(self):
        self.blocklist = set()
        self.last_update = 0
        self.update_interval = 3600 * 24  # 24-hour refresh cycle
        self.lock = threading.Lock()
        
        # FireHOL Level 1: Curated list of high-confidence malicious IPs
        self.blocklist_url = "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset"
        
        # Initiate asynchronous blocklist synchronization
        threading.Thread(target=self.update_blocklist, daemon=True).start()

    def update_blocklist(self):
        """Downloads and parses the external IP blocklist into the local cache."""
        current_time = time.time()
        if current_time - self.last_update < self.update_interval and self.blocklist:
            return

        print("[INFO] Synchronizing Threat Intelligence blocklist...")
        try:
            response = requests.get(self.blocklist_url, timeout=10)
            if response.status_code == 200:
                new_blocklist = set()
                for line in response.text.splitlines():
                    line = line.strip()
                    # Filter out comments and whitespace
                    if line and not line.startswith('#'):
                        if '/' not in line:
                            new_blocklist.add(line)
                        else:
                            # TODO: Implement CIDR parsing for complex network sets
                            new_blocklist.add(line)
                            
                with self.lock:
                    self.blocklist = new_blocklist
                    self.last_update = current_time
                    
                print(f"[INFO] Threat Intelligence synchronized: {len(self.blocklist)} blocked endpoints loaded.")
            else:
                print(f"[ERROR] Blocklist synchronization failed (HTTP {response.status_code}).")
        except Exception as e:
            print(f"[ERROR] Threat Intelligence update encountered an error: {e}")

    def is_malicious(self, ip):
        """
        Checks if an IP address exists within the active threat blocklist.
        
        Args:
            ip (str): The IP address to verify.
            
        Returns:
            bool: True if the IP is identified as malicious, False otherwise.
        """
        if not ip or ip == "N/A":
            return False
            
        with self.lock:
            if ip in self.blocklist:
                return True
                
        return False

        
# Global instance
threat_intel = ThreatIntel()
