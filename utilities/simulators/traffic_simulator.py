import os
import socket
import time
import random
import threading

def udp_flood(target_ip, target_port, duration=30):
    """Generates a burst of UDP traffic to simulate anomalous activity."""
    print(f"[SIMULATOR] Starting UDP burst to {target_ip}:{target_port} for {duration}s...")
    timeout = time.time() + duration
    sent = 0
    
    # Create a random payload
    payload = os.urandom(1024)
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    while time.time() < timeout:
        sock.sendto(payload, (target_ip, target_port))
        sent += 1
        if sent % 1000 == 0:
            print(f"[SIMULATOR] Sent {sent} packets...")
        # Small sleep to prevent 100% CPU lockup but high enough to spike traffic
        time.sleep(0.001)
    
    print(f"[SIMULATOR] UDP burst complete. Total packets sent: {sent}")

def tcp_connect_spike(target_ip, target_port, duration=30):
    """Simulates a port scanning or connection spike anomaly."""
    print(f"[SIMULATOR] Starting TCP connection spike to {target_ip}:{target_port} for {duration}s...")
    timeout = time.time() + duration
    
    while time.time() < timeout:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.1)
            s.connect((target_ip, target_port))
            s.close()
        except:
            pass
        time.sleep(0.01)
    
    print("[SIMULATOR] TCP connection spike complete.")

def http_get_spike(target_ip, target_port, duration=30):
    """Simulates a sudden surge in HTTP GET requests (similar to a basic application layer spike)."""
    print(f"[SIMULATOR] Starting HTTP GET spike to {target_ip}:{target_port} for {duration}s...")
    timeout = time.time() + duration
    sent = 0
    
    while time.time() < timeout:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.1)
            s.connect((target_ip, target_port))
            request = f"GET / HTTP/1.1\r\nHost: {target_ip}\r\n\r\n"
            s.sendall(request.encode())
            s.close()
            sent += 1
            if sent % 500 == 0:
                print(f"[SIMULATOR] Sent {sent} HTTP requests...")
        except:
            pass
        time.sleep(0.005)
    
    print(f"[SIMULATOR] HTTP spike complete. Total requests: {sent}")

def simulated_port_scan(target_ip, start_port=1, end_port=1024):
    """Simulates a rapid sequential port scan across common ports."""
    print(f"[SIMULATOR] Starting port scan simulation on {target_ip} from port {start_port} to {end_port}...")
    for port in range(start_port, end_port + 1):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.01) # Very short timeout to quickly run through ports
            s.connect((target_ip, port))
            s.close()
        except:
            pass
    print("[SIMULATOR] Port scan simulation complete.")

if __name__ == "__main__":
    # For demo purposes, we can target localhost or a dummy IP
    # Targeting a non-existent local IP often triggers anomaly detection well
    TARGET_IP = "127.0.0.1" 
    TARGET_PORT = 8080
    
    print("=" * 60)
    print("OVERSIGHT: Network Traffic Simulator (Demo Tool)")
    print("=" * 60)
    print("This tool generates network activity to test anomaly detection.")
    print(f"Target: {TARGET_IP}")
    print("=" * 60)
    print("Select a simulation to run:")
    print("1. UDP Flood (High bandwidth spike)")
    print("2. TCP Connection Spike (Many rapid connections)")
    print("3. HTTP GET Spike (Web application layer stress)")
    print("4. Port Scan (Sequential connection attempts)")
    print("5. Run All Simultaneously")
    print("6. Cinematic Auto-Trigger (Delay + Infinite Background Loop)")
    print("=" * 60)
    
    try:
        choice = input("Enter your choice (1-6): ")
        print()
        
        if choice == '6':
            delay = int(input("Enter delay in seconds before attack starts (e.g., 300 for 5 mins): "))
            print(f"\n[SIMULATOR] Sleeping quietly in the background for {delay} seconds...")
            print("[SIMULATOR] You can minimize this window now. The attack will start automatically.")
            time.sleep(delay)
            print("\n[SIMULATOR] WAKING UP. INITIATING CONTINUOUS THREAT SIMULATION.")
            # Run endlessly in the background
            while True:
                threads = []
                threads.append(threading.Thread(target=udp_flood, args=(TARGET_IP, TARGET_PORT, 60)))
                threads.append(threading.Thread(target=tcp_connect_spike, args=(TARGET_IP, 8081, 60)))
                threads.append(threading.Thread(target=http_get_spike, args=(TARGET_IP, 80, 60)))
                threads.append(threading.Thread(target=simulated_port_scan, args=(TARGET_IP, 1, 1024)))
                
                for t in threads: t.start()
                for t in threads: t.join()
                print("[SIMULATOR] Loop complete. Restarting continuous attack...")
                time.sleep(2)
                
        else:
            threads = []
            if choice == '1' or choice == '5':
                threads.append(threading.Thread(target=udp_flood, args=(TARGET_IP, TARGET_PORT, 60)))
            if choice == '2' or choice == '5':
                threads.append(threading.Thread(target=tcp_connect_spike, args=(TARGET_IP, 8081, 60)))
            if choice == '3' or choice == '5':
                threads.append(threading.Thread(target=http_get_spike, args=(TARGET_IP, 80, 60)))
            if choice == '4' or choice == '5':
                threads.append(threading.Thread(target=simulated_port_scan, args=(TARGET_IP, 1, 1024)))
                
            if not threads:
                print("Invalid choice. Exiting.")
            else:
                for t in threads:
                    t.start()
                    
                for t in threads:
                    t.join()
                    
                print("=" * 60)
                print("All selected simulations finished.")
            
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Simulation aborted by user.")
