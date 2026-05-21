import requests
import time
import threading
import ipaddress

class ThreatIntel:
    """
    Local Threat Intelligence Engine.
    Maintains an in-memory cache of the FireHOL blocklist to identify known malicious IP addresses.
    The cache is refreshed every 24 hours to ensure up-to-date protection.
    """
    
    def __init__(self):
        self.blocklist = set()
        self.subnets = []
        self.last_update = 0
        self.update_interval = 3600 * 24  # 24-hour refresh cycle
        self.lock = threading.Lock()
        
        # FireHOL Level 1: Curated list of high-confidence malicious IPs
        self.blocklist_url = "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset"
        
        # Initiate asynchronous blocklist synchronization loop
        threading.Thread(target=self._blocklist_sync_loop, daemon=True).start()

    def _blocklist_sync_loop(self):
        """Periodically synchronizes the blocklist, retrying on failure."""
        while True:
            self.update_blocklist()
            
            with self.lock:
                success = len(self.blocklist) > 0 or len(self.subnets) > 0
            
            if success:
                time.sleep(self.update_interval)
            else:
                print("[WARNING] Threat Intelligence blocklist is empty, retrying in 5 minutes...")
                time.sleep(300) # Retry in 5 minutes

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
                new_subnets = []
                for line in response.text.splitlines():
                    line = line.strip()
                    # Filter out comments and whitespace
                    if line and not line.startswith('#'):
                        if '/' not in line:
                            new_blocklist.add(line)
                        else:
                            try:
                                new_subnets.append(ipaddress.ip_network(line, strict=False))
                            except ValueError:
                                pass
                            
                with self.lock:
                    self.blocklist = new_blocklist
                    self.subnets = new_subnets
                    self.last_update = current_time
                    
                print(f"[INFO] Threat Intelligence synchronized: {len(self.blocklist)} blocked IPs and {len(self.subnets)} subnets loaded.")
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

        # Bypass checks for local/private/multicast/reserved ranges to prevent false positives from bogon lists
        try:
            ip_obj = ipaddress.ip_address(ip)
            if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_reserved:
                return False
        except ValueError:
            # If it's a hostname (e.g. mdns.mcast.net), bypass if it matches local/multicast suffixes
            ip_str = ip.lower()
            if ip_str.endswith('.local') or ip_str.endswith('.mcast.net') or ip_str == 'localhost':
                return False
            
        with self.lock:
            if ip in self.blocklist:
                return True
                
            if self.subnets:
                try:
                    ip_obj = ipaddress.ip_address(ip)
                    for subnet in self.subnets:
                        if ip_obj in subnet:
                            return True
                except ValueError:
                    pass
                
        return False

        
# Global instance
threat_intel = ThreatIntel()
