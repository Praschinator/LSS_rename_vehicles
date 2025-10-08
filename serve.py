#!/usr/bin/env python3
"""
Live-reload HTTP server to serve the index.html file on localhost
Usage: python serve.py
"""

import http.server
import socketserver
import os
import webbrowser
import threading
import time
import json
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Configuration
PORT = 8000
HOST = "localhost"

class LiveReloadHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Inject live reload script into HTML files
        if self.path.endswith('.html') or self.path == '/':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()
    
    def do_GET(self):
        if self.path == '/livereload.js':
            self.send_response(200)
            self.send_header('Content-type', 'application/javascript')
            self.end_headers()
            
            # Simple live reload JavaScript
            js_code = """
            (function() {
                let lastModified = 0;
                
                function checkForChanges() {
                    fetch('/status')
                        .then(response => response.json())
                        .then(data => {
                            if (lastModified !== 0 && data.lastModified > lastModified) {
                                console.log('File changed, reloading...');
                                location.reload();
                            }
                            lastModified = data.lastModified;
                        })
                        .catch(err => console.log('Live reload check failed:', err));
                }
                
                // Check every 500ms
                setInterval(checkForChanges, 500);
                checkForChanges(); // Initial check
            })();
            """
            self.wfile.write(js_code.encode())
            return
        
        elif self.path == '/status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            # Get the latest modification time of watched files
            max_mtime = 0
            for file_path in Path('.').glob('*.html'):
                mtime = file_path.stat().st_mtime
                max_mtime = max(max_mtime, mtime)
            
            status = {'lastModified': max_mtime}
            self.wfile.write(json.dumps(status).encode())
            return
        
        # For HTML files, inject the live reload script
        elif self.path.endswith('.html') or self.path == '/':
            try:
                if self.path == '/':
                    file_path = Path('index.html')
                else:
                    file_path = Path(self.path.lstrip('/'))
                
                if file_path.exists():
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html')
                    self.end_headers()
                    
                    content = file_path.read_text(encoding='utf-8')
                    # Inject live reload script before closing body tag
                    if '</body>' in content:
                        content = content.replace('</body>', 
                            '<script src="/livereload.js"></script></body>')
                    else:
                        content += '<script src="/livereload.js"></script>'
                    
                    self.wfile.write(content.encode('utf-8'))
                    return
            except Exception as e:
                print(f"Error serving HTML: {e}")
        
        # Default behavior for other files
        super().do_GET()

def main():
    # Change to the directory containing this script
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    # Create server with live reload handler
    handler = LiveReloadHandler
    
    try:
        with socketserver.TCPServer((HOST, PORT), handler) as httpd:
            print(f"Live-reload server running at http://{HOST}:{PORT}")
            print(f"Serving files from: {script_dir}")
            print(f"Watching for changes in HTML files...")
            print("Press Ctrl+C to stop the server")
            
            # Optionally open browser automatically
            try:
                webbrowser.open(f"http://{HOST}:{PORT}/index.html")
                print("Browser opened automatically")
            except:
                print("Could not open browser automatically")
            
            # Start serving
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\nServer stopped")
    except OSError as e:
        if e.errno == 10048:  # Address already in use on Windows
            print(f"Port {PORT} is already in use. Try a different port or stop other servers.")
        else:
            print(f"Error starting server: {e}")

if __name__ == "__main__":
    main()