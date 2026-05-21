import os
import requests

def download_geoip_db():
    print("=" * 60)
    print("OVERSIGHT: Downloading GeoLite2 Database")
    print("=" * 60)
    
    # Using a public mirror of the GeoLite2 City database
    url = "https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb"
    
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_dir = os.path.join(project_root, "backend", "data")
    os.makedirs(db_dir, exist_ok=True)
    
    db_path = os.path.join(db_dir, "GeoLite2-City.mmdb")
    
    print(f"Downloading from {url}...")
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        with open(db_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                
        print(f"Successfully downloaded and saved to: {db_path}")
    except Exception as e:
        print(f"[ERROR] Failed to download database: {e}")

if __name__ == "__main__":
    download_geoip_db()
