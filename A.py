from flask import Flask, render_template, jsonify
import psutil
import subprocess
import time
import os

app = Flask(__name__)

def get_cpu_info():
    return {
        'usage': psutil.cpu_percent(interval=1),
        'temp': get_cpu_temp(),
        'cores': psutil.cpu_count(logical=False),
        'freq': psutil.cpu_freq().current if hasattr(psutil, 'cpu_freq') else 0
    }

def get_cpu_temp():
    try:
        if os.path.exists('/sys/class/thermal/thermal_zone0/temp'):
            with open('/sys/class/thermal/thermal_zone0/temp', 'r') as f:
                return float(f.read()) / 1000
        return None
    except Exception as e:
        print(f"Temp error: {e}")
        return None

def get_gpu_info():
    try:
        # Voor Raspberry Pi
        result = subprocess.run(['vcgencmd', 'measure_temp'], stdout=subprocess.PIPE)
        temp = float(result.stdout.decode('utf-8').replace("temp=", "").replace("'C\n", ""))
        return {
            'temp': temp,
            'usage': None  # Raspberry Pi heeft geen standaard GPU usage meting
        }
    except Exception as e:
        print(f"GPU error: {e}")
        return None

def get_system_info():
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    return {
        'memory': {
            'total': mem.total / (1024**3),
            'used': mem.used / (1024**3),
            'percent': mem.percent
        },
        'disk': {
            'total': disk.total / (1024**3),
            'used': disk.used / (1024**3),
            'percent': disk.percent
        },
        'uptime': time.time() - psutil.boot_time()
    }

def gethostname():
    try:
        return os.uname().nodename
    except Exception as e:
        print(f"Hostname error: {e}")
        return "Unknown"
    
def get_local_ip():
    try:
        # More reliable method using Python's stdlib
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Doesn't even have to be reachable
            s.connect(('10.255.255.255', 1))
            ip = s.getsockname()[0]
        except Exception:
            ip = '127.0.0.1'
        finally:
            s.close()
        return ip
    except Exception as e:
        print(f"IP error: {e}")
        return "Unknown"
    
@app.route('/')
def dashboard():
    return render_template('dashboard.html')

@app.route('/data')
def get_data():
    return jsonify({
        'cpu': get_cpu_info(),
        'gpu': get_gpu_info(),
        'system': get_system_info(),
        'timestamp': time.strftime('%H:%M:%S'),
        'hostname': gethostname(),
        'ip_adress': get_local_ip()
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)