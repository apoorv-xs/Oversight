import socket
import threading
from concurrent.futures import ThreadPoolExecutor

class AsyncDNSCache:
    def __init__(self, max_workers=5):
        self.cache = {}
        self.pending = set()
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=max_workers)

    def _resolve_ip(self, ip):
        try:
            # socket.gethostbyaddr returns (hostname, aliaslist, ipaddrlist)
            hostname, _, _ = socket.gethostbyaddr(ip)
        except Exception:
            hostname = ip  # Fallback to the IP address if resolution fails

        with self.lock:
            self.cache[ip] = hostname
            if ip in self.pending:
                self.pending.remove(ip)

    def get_hostname(self, ip):
        if not ip:
            return ""

        with self.lock:
            if ip in self.cache:
                return self.cache[ip]
            
            if ip not in self.pending:
                self.pending.add(ip)
                self.executor.submit(self._resolve_ip, ip)
                
            return ip  # Return IP temporarily until resolution finishes

# Global instance for use across the application
dns_cache = AsyncDNSCache()
