# Oversight packet capture thread using scapy
import scapy.all as scapy
from threading import Thread, Event
import time

class PacketCaptureThread(Thread):
    # bg thread for scapy packet capture

    def __init__(self, interface, callback):
        # init the capture thread with iface and callback
        super().__init__()
        self.interface = interface
        self.callback = callback
        self.packet_count = 0
        self.stop_event = Event()
        self.stop_event.set()
        self.sniffer = None

    def stop(self):
        # signal the capture loop to stop
        self.stop_event.clear()

    def run(self):
        # start sniffing
        print(f"[INFO] Starting packet capture on interface: {self.interface}")

        def process_packet(packet):
            if not self.stop_event.is_set():
                return False

            try:
                packet_info = self.extract_packet_info(packet)
                if packet_info:
                    self.callback(packet_info)
                    self.packet_count += 1
            except Exception as e:
                print(f"[ERROR] Packet processing failed: {e}")

            return self.stop_event.is_set()

        try:
            scapy.sniff(
                iface=self.interface,
                prn=process_packet,
                stop_filter=lambda x: not self.stop_event.is_set(),
                store=False
            )
        except Exception as e:
            err_msg = str(e)
            print(f"[CRITICAL] Scapy sniffer encountered an error: {err_msg}")
            try:
                import logging
                logging.error(f"[CRITICAL] Scapy sniffer encountered an error: {err_msg}")
            except:
                pass
            try:
                import globals
                globals.capture_error = err_msg
            except:
                pass

        print(f"[INFO] Capture session terminated. Total packets captured: {self.packet_count}")
        try:
            import globals
            globals.capture_running.clear()
        except Exception as ex:
            print(f"[WARNING] Could not clear capture_running event: {ex}")



    def extract_packet_info(self, packet):
        # parse raw scapy packet into simple info dict
        if not packet.haslayer('IP'):
            return None

        info = {
            'src': packet['IP'].src,
            'dst': packet['IP'].dst,
            'protocol': 'IP',
            'size': len(packet),
            'timestamp': time.time(),
            'ttl': packet['IP'].ttl
        }

        # Determine protocol and extract L4 information
        proto_num = packet['IP'].proto
        if proto_num == 6:
            info['protocol'] = 'TCP'
            if packet.haslayer('TCP'):
                info['sport'] = packet['TCP'].sport
                info['dport'] = packet['TCP'].dport
                info['window'] = packet['TCP'].window
        elif proto_num == 17:
            info['protocol'] = 'UDP'
            if packet.haslayer('UDP'):
                info['sport'] = packet['UDP'].sport
                info['dport'] = packet['UDP'].dport
        elif proto_num == 1:
            info['protocol'] = 'ICMP'
        elif proto_num == 2:
            info['protocol'] = 'IGMP'

        return info

def list_interfaces_safe():
    # list all network interfaces we can sniff on
    interfaces = []
    try:
        working_ifaces = scapy.get_working_ifaces()
        for iface in working_ifaces:
            try:
                iface_info = {
                    'name': iface.name,
                    'description': getattr(iface, 'description', 'Unknown'),
                    'ip': getattr(iface, 'ip', '0.0.0.0'),
                    'mac': getattr(iface, 'mac', '00:00:00:00:00:00')
                }
                interfaces.append(iface_info)
            except Exception as e:
                print(f"[WARNING] Could not read interface metadata: {e}")
    except Exception as e:
        print(f"[ERROR] Interface enumeration failed: {e}")

    return interfaces


def get_default_interface():
    # find default interface
    try:
        # Try to get the interface used for default route
        default_ip = scapy.conf.route.route("0.0.0.0")[2]
        for iface in scapy.get_working_ifaces():
            if iface.ip == default_ip:
                return iface.name
    except:
        pass

    # Fallback to first working interface
    interfaces = list_interfaces_safe()
    return interfaces[0]['name'] if interfaces else None
