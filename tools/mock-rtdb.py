#!/usr/bin/env python3
"""A tiny stand-in for the Firebase Realtime Database REST API, for testing online party mode locally.
Supports GET / PUT / PATCH / DELETE on /<path>.json, {".sv": "timestamp"} server values, and
EventSource streaming (Accept: text/event-stream) with put/patch events, like the real thing.
Usage: python3 tools/mock-rtdb.py [port]   then open a game with ?nbdb=http://localhost:<port>"""
import json, sys, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

DATA = {}
LOCK = threading.Lock()
SUBS = []   # (path_parts, queue list, condition)

def parts(p):
    p = p.split('?')[0]
    if p.endswith('.json'): p = p[:-5]
    return [x for x in p.strip('/').split('/') if x]

def resolve_sv(v):
    if isinstance(v, dict):
        if v.get('.sv') == 'timestamp' and len(v) == 1: return int(time.time() * 1000)
        return {k: resolve_sv(x) for k, x in v.items() if x is not None}
    return v

def prune(v):
    if isinstance(v, dict):
        out = {k: prune(x) for k, x in v.items()}
        out = {k: x for k, x in out.items() if x is not None and x != {}}
        return out if out else None
    return v

def get_at(ps):
    o = DATA
    for k in ps:
        if not isinstance(o, dict) or k not in o: return None
        o = o[k]
    return o

def set_at(ps, v):
    global DATA
    if not ps:
        DATA = prune(v) or {}
        return
    o = DATA
    for k in ps[:-1]:
        if not isinstance(o.get(k), dict): o[k] = {}
        o = o[k]
    if v is None: o.pop(ps[-1], None)
    else: o[ps[-1]] = v
    DATA = prune(DATA) or {}

def notify(ps, value, kind):
    # tell each stream whose path overlaps the change
    for sp, q, cv in list(SUBS):
        n = min(len(sp), len(ps))
        if sp[:n] != ps[:n]: continue
        if len(ps) >= len(sp):
            rel = '/' + '/'.join(ps[len(sp):])
            ev = (kind, {'path': rel, 'data': value})
        else:
            ev = ('put', {'path': '/', 'data': get_at(sp)})
        with cv:
            q.append(ev); cv.notify()

def notify_patch(ps, v):
    # one 'patch' event for the whole update, like the real database
    for sp, q, cv in list(SUBS):
        n = min(len(sp), len(ps))
        if sp[:n] != ps[:n]: continue
        if len(ps) >= len(sp):
            ev = ('patch', {'path': '/' + '/'.join(ps[len(sp):]), 'data': v})
        else:
            ev = ('put', {'path': '/', 'data': get_at(sp)})
        with cv:
            q.append(ev); cv.notify()

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.send_header('Content-Length', '0'); self.end_headers()
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'null') if n else None
    def reply(self, v):
        b = json.dumps(v).encode()
        self.send_response(200); self.cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        ps = parts(self.path)
        if 'text/event-stream' in (self.headers.get('Accept') or ''):
            return self.stream(ps)
        with LOCK: v = get_at(ps)
        self.reply(v)
    def stream(self, ps):
        self.send_response(200); self.cors()
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.end_headers()
        q, cv = [], threading.Condition()
        with LOCK:
            q.append(('put', {'path': '/', 'data': get_at(ps)}))
            sub = (ps, q, cv); SUBS.append(sub)
        try:
            while True:
                with cv:
                    if not q: cv.wait(15)
                    evs, q[:] = q[:], []
                if not evs: evs = [('keep-alive', None)]
                for kind, d in evs:
                    self.wfile.write(('event: %s\ndata: %s\n\n' % (kind, json.dumps(d))).encode())
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with LOCK:
                if sub in SUBS: SUBS.remove(sub)
    def do_PUT(self):
        ps = parts(self.path); v = resolve_sv(self.body())
        with LOCK:
            set_at(ps, v); notify(ps, get_at(ps), 'put')
        self.reply(v)
    def do_PATCH(self):
        ps = parts(self.path); raw = self.body() or {}
        v = {k: (None if x is None else resolve_sv(x)) for k, x in raw.items()}
        with LOCK:
            for k, x in v.items(): set_at(ps + [p for p in k.split('/') if p], x)
            notify_patch(ps, v)
        self.reply(v)
    def do_DELETE(self):
        ps = parts(self.path)
        with LOCK:
            set_at(ps, None); notify(ps, None, 'put')
        self.reply(None)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9000
    print('mock RTDB on http://localhost:%d' % port, flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()
