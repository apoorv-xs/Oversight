import os
import geoip2.database
from globals import PROJECT_ROOT

class Geolocator:
    def __init__(self):
        self.db_path = os.path.join(PROJECT_ROOT, "backend", "data", "GeoLite2-City.mmdb")
        self.reader = None
        self._cache = {}  # Simple in-memory IP → location cache
        self._load_db()

    def _load_db(self):
        if os.path.exists(self.db_path):
            try:
                self.reader = geoip2.database.Reader(self.db_path)
                print(f"[INFO] GeoIP database loaded from {self.db_path}")
            except Exception as e:
                print(f"[ERROR] Failed to load GeoIP database: {e}")
        else:
            print(f"[WARNING] GeoIP database not found at {self.db_path}. Geolocation will be disabled.")

    def get_location(self, ip_address):
        """
        Resolves an IP address to latitude and longitude.
        Returns a dict with lat, lng, city, country, or None if not found/local.
        Results are cached in memory for extreme performance.
        """
        if not self.reader or not ip_address:
            return None

        # Check cache first
        if ip_address in self._cache:
            return self._cache[ip_address]
        
        # Skip local/private IPs
        import ipaddress
        try:
            ip_obj = ipaddress.ip_address(ip_address)
            if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_reserved:
                self._cache[ip_address] = None
                return None
        except ValueError:
            # If it's a hostname or not a valid IP, treat as local/private (no geo info)
            self._cache[ip_address] = None
            return None

        try:
            response = self.reader.city(ip_address)
            result = {
                'lat': response.location.latitude,
                'lng': response.location.longitude,
                'city': response.city.name if response.city.name else 'Unknown',
                'country': response.country.name if response.country.name else 'Unknown'
            }
            self._cache[ip_address] = result
            return result
        except geoip2.errors.AddressNotFoundError:
            self._cache[ip_address] = None
            return None
        except Exception as e:
            return None

    def close(self):
        if self.reader:
            self.reader.close()

# Global singleton
geolocator = Geolocator()
