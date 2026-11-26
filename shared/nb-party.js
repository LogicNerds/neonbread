/* NB-PARTY START v1 — Neon Bread Arcade online party mode (rooms, lobby, live sync).
   Canonical copy: LogicNerds/neonbread/shared/nb-party.js. Each online game inlines this block
   (tools/inject-nb-party.py) so every game stays one self-contained file.
   Backend: Firebase Realtime Database (project neon-bread-arcade) over its REST API.
   Writes are plain fetch() calls; the room is followed with one EventSource stream. No sign-in, no SDK.
   Testing: ?nbdb=http://localhost:9000 (or localStorage nbp_db) points it at another server. */
(function () {
  'use strict';
  if (window.NBParty) return;
  const DEFAULT_DB = 'https://neon-bread-arcade-default-rtdb.firebaseio.com';
  const DB = (() => {
    try { const q = new URLSearchParams(location.search).get('nbdb'); if (q) { localStorage.setItem('nbp_db', q); return q.replace(/\/$/, ''); } } catch (e) { }
    try { const s = localStorage.getItem('nbp_db'); if (s) return s.replace(/\/$/, ''); } catch (e) { }
    return DEFAULT_DB;
  })();
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I, O, 0, 1
  const CODE_LEN = 4, NAME_LEN = 6, NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const HB_MS = 3000, GONE_MS = 12000;
  const TS = { '.sv': 'timestamp' };

  // ---------------------------------------------------------------- REST
  const url = p => DB + '/' + p.replace(/^\/+/, '') + '.json';
  function call(method, path, body, keep) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 10000) : 0;
    return fetch(url(path), { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, keepalive: !!keep })
      .then(r => r.text().then(tx => { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return tx ? JSON.parse(tx) : null; }))
      .catch(e => { clearTimeout(t); throw e; });
  }
  const get = p => call('GET', p);
  const put = (p, v) => call('PUT', p, v);
  const patch = (p, v, keep) => call('PATCH', p, v, keep);
  const del = p => call('DELETE', p);
  function newId(n) {
    const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = '';
    const r = (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(n)) : Array.from({ length: n }, () => Math.random() * 256);
    for (let i = 0; i < n; i++) s += a[r[i] % a.length];
    return s;
  }
  function newCode() {
    const r = (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(CODE_LEN)) : Array.from({ length: CODE_LEN }, () => Math.random() * 256);
    let s = ''; for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[r[i] % CODE_CHARS.length];
    return s;
  }
  // apply a stream event to the local mirror. A 'patch' can carry multi-location keys ("picks/abc").
  function applyAt(root, path, data, merge) {
    if (merge) {
      for (const k in data) root = applyAt(root, path.replace(/\/+$/, '') + '/' + k, data[k], false);
      return root;
    }
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return data;
    root = root && typeof root === 'object' ? root : {};
    let o = root;
    for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if (data === null) delete o[last]; else o[last] = data;
    return root;
  }
  const at = (obj, path) => path.split('/').filter(Boolean).reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, obj);

  // ---------------------------------------------------------------- the room
  // rooms/CODE: { game, host, status: lobby|play, gen, created, players: { pid: { name, order, hb, left } }, g: { ...game data } }
  class Room {
    constructor(code, me, game) {
      this.code = code; this.me = me; this.game = game; this.data = null; this.subs = {}; this.seen = {}; this.hbT = 0; this.es = null; this.closed = false;
      this.lastStatus = null; this.lastGen = null; this.lastHost = null; this.connected = false;
    }
    on(ev, cb) { (this.subs[ev] = this.subs[ev] || []).push(cb); return () => { this.subs[ev] = (this.subs[ev] || []).filter(f => f !== cb); }; }
    emit(ev, a, b) { (this.subs[ev] || []).slice().forEach(f => { try { f(a, b); } catch (e) { console.error(e); } }); }
    path(p) { return 'rooms/' + this.code + (p ? '/' + p : ''); }
    set(p, v) { return put(this.path(p), v).catch(e => { this.emit('error', e); throw e; }); }
    patch(p, v) { return patch(this.path(p), v).catch(e => { this.emit('error', e); throw e; }); }
    del(p) { return del(this.path(p)).catch(e => { this.emit('error', e); throw e; }); }
    get(p) { return at(this.data, p || ''); }
    get host() { return this.data ? this.data.host : null; }
    get isHost() { return !!this.data && this.data.host === this.me; }
    get status() { return this.data ? this.data.status : null; }
    get g() { return (this.data && this.data.g) || {}; }
    // everyone who has joined, in the order they locked in their names
    players() {
      const ps = (this.data && this.data.players) || {}, now = Date.now();
      return Object.keys(ps).map(id => {
        const p = ps[id] || {};
        return { id, name: p.name || '?', order: p.order || 0, left: !!p.left, gone: !!p.left || (id !== this.me && now - (this.seen[id] || now) > GONE_MS), me: id === this.me, host: id === this.data.host };
      }).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    }
    active() { return this.players().filter(p => !p.gone); }
    alive(id) { const p = this.players().find(q => q.id === id); return !!p && !p.gone; }
    nameOf(id) { const p = this.data && this.data.players && this.data.players[id]; return p ? p.name : '?'; }
    open() {
      if (this.es) this.es.close();
      const es = this.es = new EventSource(url(this.path()));
      const onEv = merge => e => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m) return;
        this.data = applyAt(this.data, m.path, m.data, merge);
        this.connected = true;
        this.noteSeen(m.path, m.data);
        this.emit('change', m.path, m.data);
        this.check();
      };
      es.addEventListener('put', onEv(false));
      es.addEventListener('patch', onEv(true));
      es.addEventListener('cancel', () => { this.emit('error', new Error('cancelled')); });
      es.onerror = () => { this.connected = false; };
      this.startHb();
    }
    // a player counts as here while their heartbeat keeps changing
    noteSeen(path, data) {
      const now = Date.now(), ps = (this.data && this.data.players) || {};
      const m = path.match(/^\/players\/([^/]+)/);
      if (m) { this.seen[m[1]] = now; return; }
      if (path === '/' || path === '/players') Object.keys(ps).forEach(id => { if (path === '/players' || !this.seen[id]) this.seen[id] = now; });
    }
    startHb() {
      clearInterval(this.hbT);
      const beat = () => { if (!this.closed && !document.hidden) patch(this.path('players/' + this.me), { hb: TS }).catch(() => { }); this.check(); };
      beat(); this.hbT = setInterval(beat, HB_MS);
    }
    // status / host / player changes, and host failover
    check() {
      if (!this.data || this.closed) return;
      if (!this.data.players || !this.data.players[this.me]) { this.emit('kicked'); return; }
      const ps = this.players(), key = ps.map(p => p.id + (p.gone ? '-' : '+')).join(',');
      if (key !== this.lastKey) { this.lastKey = key; this.emit('players', ps); }
      if (this.data.host !== this.lastHost) { this.lastHost = this.data.host; this.emit('host', this.data.host); }
      if ((this.data.status !== this.lastStatus || this.data.gen !== this.lastGen) && (this.data.status !== 'play' || this.data.g)) {
        const prevStatus = this.lastStatus;
        this.lastStatus = this.data.status; this.lastGen = this.data.gen;
        this.emit('status', this.data.status, prevStatus);
      }
      // the host is gone: the first player who locked in after the host takes over
      const host = ps.find(p => p.id === this.data.host);
      if (!host || host.gone) {
        const hOrder = host ? host.order : -1;
        const next = ps.filter(p => !p.gone && p.order > hOrder)[0] || ps.filter(p => !p.gone)[0];
        if (next && next.id === this.me && this.claimT !== this.data.host) { this.claimT = this.data.host; this.patch('', { host: this.me }).catch(() => { this.claimT = null; }); }
      }
    }
    setHost(id) { return this.patch('', { host: id }); }
    leave() {
      if (this.closed) return Promise.resolve();
      this.closed = true; clearInterval(this.hbT);
      if (this.es) this.es.close();
      if (Party.room === this) Party.room = null;
      return patch(this.path('players/' + this.me), { left: true }, true).catch(() => { });
    }
    // host only: everyone back to the lobby (PLAY AGAIN)
    toLobby() { return this.patch('', { status: 'lobby', g: null }); }
  }

  // ---------------------------------------------------------------- styles
  const CSS = `
#nbq{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;background:rgba(6,0,18,.92);font-family:'Press Start 2P',monospace;color:#fff;-webkit-user-select:none;user-select:none;touch-action:manipulation}
#nbq.on{display:flex}
#nbq *{box-sizing:border-box;margin:0;padding:0;font-family:inherit}
#nbqP{position:absolute;left:50%;top:50%;transform-origin:50% 50%;display:flex;flex-direction:column;align-items:center;gap:24px;padding:40px 50px;background:#0b0620;border:6px solid var(--nbc);box-shadow:0 0 40px var(--nbc),inset 0 0 40px rgba(0,0,0,.6);text-align:center}
#nbqP::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 2px,transparent 2px 5px)}
.nbq-k{font-size:22px;color:#00e5ff;text-shadow:0 0 12px #00e5ff;letter-spacing:2px}
.nbq-h{font-size:46px;color:var(--nbc);text-shadow:0 0 18px var(--nbc);line-height:1.3}
.nbq-code{font-size:96px;color:#ffe14d;text-shadow:0 0 22px #ffb000;letter-spacing:18px}
.nbq-m{font-size:20px;color:#d9d0ff;line-height:1.9}
.nbq-e{font-size:20px;color:#ff4b6e;min-height:24px;line-height:1.6}
.nbq-slots{display:flex;gap:16px;position:relative}
.nbq-slot{display:flex;flex-direction:column;align-items:center;gap:10px}
.nbq-ar{width:96px;height:52px;font-size:24px;background:transparent;color:#8a7bd8;border:4px solid #3a2f78;cursor:pointer}
.nbq-ar:active{background:#3a2f78;color:#fff}
.nbq-ch{width:96px;height:112px;display:flex;align-items:center;justify-content:center;font-size:64px;border:5px solid #3a2f78;background:#120a30;cursor:pointer}
.nbq-ch.cur{border-color:var(--nbc);box-shadow:0 0 24px var(--nbc);animation:nbqb 1s steps(2) infinite}
@keyframes nbqb{50%{color:var(--nbc)}}
#nbqIn{position:absolute;opacity:0;width:1px;height:1px;left:0;top:0;font-size:16px;border:0}
.nbq-row{display:flex;gap:22px;flex-wrap:wrap;justify-content:center}
.nbq-col{display:flex;flex-direction:column;gap:18px;align-items:center}
.nbq-b{font-size:26px;padding:20px 34px;min-width:520px;background:rgba(0,0,0,.4);color:var(--nbc);border:5px solid var(--nbc);cursor:pointer;box-shadow:0 0 16px var(--nbc)}
.nbq-row .nbq-b{min-width:0}
.nbq-b.sel,.nbq-b:hover{background:var(--nbc);color:#0b0620}
.nbq-b.alt{--nbc:#00e5ff}
.nbq-b.off{opacity:.35;pointer-events:none}
.nbq-list{display:flex;flex-direction:column;gap:8px;width:100%;max-width:820px;text-align:left}
.nbq-p{display:grid;grid-template-columns:70px 1fr auto;gap:18px;font-size:28px;line-height:1.9;padding:2px 18px;background:#140a32;border-left:8px solid var(--pc,#3a2f78)}
.nbq-p em{font-style:normal;font-size:15px;color:#ffe14d;align-self:center}
.nbq-p.gone{opacity:.4}
.nbq-p.me{background:#22104e}
.nbq-p.empty{color:#4a3f88;background:transparent;border-left-color:#22184e}
.nbq-link{font-size:15px;color:#9fe3ff;word-break:break-all;line-height:1.7}
.nbq-hint{font-size:16px;color:#7d72b8;line-height:1.9}
.nbq-foc{outline:5px solid #fff;outline-offset:5px}
#nbqP.portrait .nbq-b{min-width:0;width:100%}
`;
  let root, panel;
  function ensureDom() {
    if (root) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'nbq';
    root.innerHTML = '<div id="nbqP"></div>';
    document.body.appendChild(root);
    panel = root.firstChild;
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel', 'contextmenu'].forEach(ev =>
      root.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'touchstart' || ev === 'touchend' || ev === 'wheel' }));
    root.addEventListener('pointerdown', e => setDev(e.pointerType === 'touch' ? 'touch' : 'key'), true);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 200));
  }
  function fit() {
    if (!root || !Party.active) return;
    const vw = window.innerWidth, vh = window.innerHeight, portrait = vh > vw * 1.05;
    const d = portrait ? { w: 760, h: 1240 } : { w: 1280, h: 900 };
    const s = Math.min(vw / d.w, vh / d.h);
    panel.style.width = d.w - 40 + 'px';
    panel.style.maxHeight = d.h - 40 + 'px';
    panel.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
    panel.classList.toggle('portrait', portrait);
  }
  let actx = null;
  function blip(f, d, v) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(v || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (d || 0.07));
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + (d || 0.07) + 0.02);
    } catch (e) { }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- input while the overlay is open
  // Keyboard is captured before the game sees it; games skip their own input while NBParty.active.
  const Ctl = { prev: null, rep: {}, ps: false };
  function firstPad() { const pads = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of pads || []) if (p && p.connected) return p; return null; }
  function padState() {
    const gp = firstPad(); if (!gp) return null;
    const id = gp.id || '';
    Ctl.ps = /054c|dualsense|dualshock|playstation/i.test(id) || (/wireless controller/i.test(id) && !/xbox|045e/i.test(id));
    const b = i => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > 0.5); };
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    return { up: b(12) || ay < -0.5, down: b(13) || ay > 0.5, left: b(14) || ax < -0.5, right: b(15) || ax > 0.5, a: b(0), b: b(1), start: b(9) };
  }
  let devNow = null;
  function setDev(d) { if (devNow === d) return; devNow = d; const h = panel && panel.querySelector('.nbq-hint'); if (h) h.innerHTML = hint(); }
  function dev() { if (devNow) return devNow; if (firstPad()) return 'pad'; return window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'key'; }
  const P = (ps, xb) => Ctl.ps ? ps : xb;
  function hint() {
    const d = dev(), entry = S.mode === 'name' || S.mode === 'code';
    if (entry) {
      if (d === 'touch') return 'TAP &#9650; &#9660; TO PICK LETTERS, OR TAP A LETTER TO TYPE';
      if (d === 'pad') return '&#9650;&#9660; LETTER &middot; &#9664;&#9654; MOVE &middot; ' + P('CROSS', 'A') + ' NEXT &middot; ' + P('CIRCLE', 'B') + ' BACK &middot; ' + P('OPTIONS', 'START') + ' DONE';
      return 'TYPE IT &middot; ENTER = DONE &middot; ESC = BACK';
    }
    if (d === 'touch') return '';
    if (d === 'pad') return '&#9650;&#9660; PICK &middot; ' + P('CROSS', 'A') + ' SELECT &middot; ' + P('CIRCLE', 'B') + ' BACK';
    return '&#9650;&#9660; PICK &middot; ENTER SELECT &middot; ESC BACK';
  }
  function pollPad() {
    const s = padState(); if (!s) { Ctl.prev = null; return; }
    const p = Ctl.prev || s, now = performance.now();
    for (const k in s) {
      if (s[k] && !p[k]) { Ctl.rep[k] = now + 380; setDev('pad'); act(k); }
      else if (s[k] && (k === 'up' || k === 'down' || k === 'left' || k === 'right') && now > (Ctl.rep[k] || 1e15)) { Ctl.rep[k] = now + 110; act(k); }
    }
    Ctl.prev = s;
  }
  let raf = 0;
  function loop() { raf = 0; if (!Party.active) return; pollPad(); if (S.tick) S.tick(); raf = requestAnimationFrame(loop); }
  window.addEventListener('keydown', e => {
    if (!Party.active) return;
    const inp = e.target && e.target.id === 'nbqIn';
    if (inp && e.key !== 'Enter' && e.key !== 'Escape') return;
    const k = e.code, map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'start', NumpadEnter: 'start', Escape: 'b', Backspace: 'bs', Space: 'a', Tab: 'down' };
    let a = map[k];
    if (S.mode === 'name' || S.mode === 'code') {
      if (/^Key[A-Z]$/.test(k) || /^Digit[0-9]$/.test(k) || /^Numpad[0-9]$/.test(k)) a = 'type:' + k.slice(-1);
      if (k === 'Space') a = 'right';
    } else if (k === 'Enter' || k === 'NumpadEnter') a = 'a';
    else if (k === 'KeyW') a = 'up'; else if (k === 'KeyS') a = 'down';
    setDev('key');
    e.preventDefault(); e.stopImmediatePropagation();
    if (a && (!e.repeat || /^(up|down|left|right|bs)$/.test(a))) act(a);
  }, true);
  window.addEventListener('keyup', e => { if (Party.active && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) e.preventDefault(); }, true);

  // ---------------------------------------------------------------- screens
  // S: what the overlay is showing. mode: menu | name | code | busy | lobby | pick | msg
  const S = { mode: null, foc: 0, opt: null };
  function openUI(color) {
    ensureDom();
    root.style.setProperty('--nbc', color || '#ff4bd8');
    root.classList.add('on'); Party.active = true;
    Ctl.prev = padState();
    const unfocus = () => { const a = document.activeElement; if (Party.active && a && a !== document.body && !root.contains(a) && a.blur) a.blur(); };
    unfocus(); setTimeout(unfocus, 60);
    if (!raf) raf = requestAnimationFrame(loop);
    fit();
  }
  function closeUI() {
    if (!root) return;
    root.classList.remove('on'); Party.active = false; S.mode = null; S.tick = null; panel.innerHTML = '';
  }
  // generic button screen: each .nbq-c is focusable in order; a = press, b = S.back()
  function paint() {
    const cs = panel.querySelectorAll('.nbq-c');
    if (S.foc >= cs.length) S.foc = Math.max(0, cs.length - 1);
    cs.forEach((el, i) => { el.classList.toggle('nbq-foc', i === S.foc && dev() !== 'touch'); el.classList.toggle('sel', i === S.foc); });
  }
  function screen(html, opts) {
    S.mode = opts.mode; S.back = opts.back || null; S.tick = opts.tick || null; S.foc = opts.foc || 0;
    panel.innerHTML = html + '<div class="nbq-hint">' + hint() + '</div>';
    panel.querySelectorAll('.nbq-c').forEach((el, i) => {
      el.onclick = () => { if (el.classList.contains('off')) return; S.foc = i; blip(880, 0.06); const f = opts.press && opts.press[el.dataset.k]; if (f) f(); };
      el.onmouseenter = () => { S.foc = i; paint(); };
    });
    paint(); fit();
  }
  function act(a) {
    if (S.mode === 'name' || S.mode === 'code') return actEntry(a);
    if (S.mode === 'busy') return;
    const cs = Array.from(panel.querySelectorAll('.nbq-c')).filter(el => !el.classList.contains('off'));
    const all = Array.from(panel.querySelectorAll('.nbq-c'));
    if (a === 'up' || a === 'left' || a === 'down' || a === 'right') {
      if (!cs.length) return;
      let i = cs.indexOf(all[S.foc]); if (i < 0) i = 0;
      i = (i + (a === 'up' || a === 'left' ? cs.length - 1 : 1)) % cs.length;
      S.foc = all.indexOf(cs[i]); blip(520, 0.04); return paint();
    }
    if (a === 'a' || a === 'start') { const el = all[S.foc]; if (el && !el.classList.contains('off')) el.click(); return; }
    if (a === 'b' && S.back) { blip(420, 0.05); S.back(); }
  }

  // ---- letter entry (names and room codes)
  function entry(o) {
    // o: { kind: name|code, title, sub, len, chars, value, ok, back, err }
    S.entry = o; S.mode = o.kind; S.back = o.back;
    const pre = (o.value || '').padEnd(o.len, ' ').split('').slice(0, o.len);
    o.slots = pre; o.cur = 0; o.fresh = !!o.value; o.err = o.err || '';
    renderEntry();
  }
  function entryNow(o) { return o.slots.join('').replace(/ /g, ''); }
  function renderEntry() {
    const o = S.entry, touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    let slots = '';
    for (let i = 0; i < o.len; i++) slots += '<div class="nbq-slot"><button class="nbq-ar" data-up="' + i + '">&#9650;</button><div class="nbq-ch' + (i === o.cur ? ' cur' : '') + '" data-ch="' + i + '">' + (o.slots[i] === ' ' ? '&middot;' : esc(o.slots[i])) + '</div><button class="nbq-ar" data-dn="' + i + '">&#9660;</button></div>';
    panel.innerHTML = '<div class="nbq-k">' + esc(S.title) + ' &middot; PLAY ONLINE</div><div class="nbq-h">' + esc(o.title) + '</div>' + (o.sub ? '<div class="nbq-m">' + o.sub + '</div>' : '') +
      '<div class="nbq-slots">' + slots + '<input id="nbqIn" maxlength="' + o.len + '" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>' +
      '<div class="nbq-e">' + esc(o.err) + '</div>' +
      '<div class="nbq-row"><button class="nbq-b alt" data-bk="1">BACK</button><button class="nbq-b sel" data-ok="1">' + esc(o.okLabel || 'OK') + '</button></div>' +
      '<div class="nbq-hint">' + hint() + '</div>';
    panel.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { o.cur = +b.dataset.up; cycleEntry(1); });
    panel.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { o.cur = +b.dataset.dn; cycleEntry(-1); });
    const inp = panel.querySelector('#nbqIn');
    panel.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
      o.cur = +b.dataset.ch; renderEntry();
      if (touch) { const i2 = panel.querySelector('#nbqIn'); i2.value = entryNow(o); try { i2.focus({ preventScroll: true }); } catch (e) { i2.focus(); } }
    });
    inp.addEventListener('input', () => {
      const v = filt(o, inp.value); if (inp.value !== v) inp.value = v;
      o.slots = v.padEnd(o.len, ' ').split(''); o.cur = Math.min(v.length, o.len - 1); o.err = ''; o.fresh = false;
      panel.querySelectorAll('[data-ch]').forEach((el, i) => { el.innerHTML = o.slots[i] === ' ' ? '&middot;' : esc(o.slots[i]); el.classList.toggle('cur', i === o.cur); });
      panel.querySelector('.nbq-e').textContent = '';
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); entryDone(); } });
    panel.querySelector('[data-ok]').onclick = entryDone;
    panel.querySelector('[data-bk]').onclick = () => o.back && o.back();
    fit();
  }
  const filt = (o, v) => o.kind === 'code' ? String(v).toUpperCase().split('').filter(c => CODE_CHARS.includes(c) || c === 'O' || c === '0' || c === 'I' || c === '1').map(c => c === 'O' || c === '0' ? 'Q' : c === 'I' || c === '1' ? 'L' : c).join('').slice(0, o.len)
    : String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, o.len);
  function entrySet(o) { return o.kind === 'code' ? ' ' + CODE_CHARS : NAME_CHARS; }
  function cycleEntry(d) {
    const o = S.entry, set = entrySet(o); o.fresh = false; let i = set.indexOf(o.slots[o.cur]); if (i < 0) i = 0;
    o.slots[o.cur] = set[(i + d + set.length) % set.length]; o.err = ''; blip(660, 0.04); renderEntry();
  }
  function actEntry(a) {
    const o = S.entry;
    if (a.indexOf('type:') !== 0 && a !== 'start') o.fresh = false;
    if (a === 'up') return cycleEntry(1);
    if (a === 'down') return cycleEntry(-1);
    if (a === 'left') { o.cur = Math.max(0, o.cur - 1); blip(520, 0.04); return renderEntry(); }
    if (a === 'right') { o.cur = Math.min(o.len - 1, o.cur + 1); blip(520, 0.04); return renderEntry(); }
    if (a === 'a') { if (o.cur === o.len - 1) return entryDone(); o.cur++; blip(520, 0.04); return renderEntry(); }
    if (a === 'bs') { if (o.slots[o.cur] === ' ' && o.cur > 0) o.cur--; o.slots[o.cur] = ' '; return renderEntry(); }
    if (a === 'b') { if (o.cur > 0) { o.cur--; return renderEntry(); } return o.back && o.back(); }
    if (a === 'start') return entryDone();
    if (a.indexOf('type:') === 0) {
      const c = filt(o, a.slice(5)); if (!c) return;
      if (o.fresh) { o.slots = ' '.repeat(o.len).split(''); o.cur = 0; }
      o.fresh = false; o.slots[o.cur] = c; o.err = ''; o.cur = Math.min(o.len - 1, o.cur + 1); blip(700, 0.04); return renderEntry();
    }
  }
  function entryDone() {
    const o = S.entry; if (!o || (S.mode !== 'name' && S.mode !== 'code')) return;
    const v = filt(o, entryNow(o));
    if (o.kind === 'code' && v.length !== CODE_LEN) { o.err = 'ROOM CODES ARE ' + CODE_LEN + ' CHARACTERS'; blip(180, 0.15); return renderEntry(); }
    if (o.kind === 'name') {
      if (!v) { o.err = 'PICK AT LEAST ONE LETTER'; blip(180, 0.15); return renderEntry(); }
      if (window.NBScores && NBScores.blocked && NBScores.blocked(v)) { o.err = 'THAT NAME IS NOT ALLOWED'; blip(180, 0.15); return renderEntry(); }
    }
    blip(880, 0.08);
    o.ok(v);
  }
  function busy(text) {
    S.mode = 'busy'; S.tick = null;
    panel.innerHTML = '<div class="nbq-k">' + esc(S.title) + ' &middot; PLAY ONLINE</div><div class="nbq-h">' + esc(text) + '</div>';
    fit();
  }
  function msg(head, body, then) {
    screen('<div class="nbq-k">' + esc(S.title) + ' &middot; PLAY ONLINE</div><div class="nbq-h">' + esc(head) + '</div><div class="nbq-m">' + body + '</div>' +
      '<div class="nbq-col"><button class="nbq-b nbq-c" data-k="ok">OK</button></div>', { mode: 'msg', back: then, press: { ok: then } });
  }

  // ---------------------------------------------------------------- flows
  const savedName = () => { try { return (localStorage.getItem('nb_name') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NAME_LEN); } catch (e) { return ''; } };
  const saveName = n => { try { localStorage.setItem('nb_name', n); } catch (e) { } };
  const inviteUrl = code => location.origin + location.pathname + '?room=' + code;

  function showMenu() {
    screen('<div class="nbq-k">' + esc(S.title) + '</div><div class="nbq-h">PLAY ONLINE</div>' +
      '<div class="nbq-m">EVERYONE PLAYS ON THEIR OWN PHONE.<br>' + S.opt.min + '&ndash;' + S.opt.max + ' PLAYERS.</div>' +
      '<div class="nbq-col"><button class="nbq-b nbq-c" data-k="host">HOST A GAME</button><button class="nbq-b nbq-c" data-k="join">JOIN A GAME</button><button class="nbq-b alt nbq-c" data-k="back">BACK</button></div>',
    { mode: 'menu', back: cancel, press: { host: hostName, join: () => joinCode(''), back: cancel } });
  }
  function cancel() { closeUI(); const f = S.opt && S.opt.onCancel; S.opt = null; if (f) setTimeout(f, 0); }

  function hostName() {
    entry({ kind: 'name', title: 'YOUR NAME', sub: 'THIS IS THE NAME YOUR SCORES POST UNDER.', len: NAME_LEN, value: savedName(), okLabel: 'HOST', back: showMenu, ok: createRoom });
  }
  function createRoom(name, tries) {
    saveName(name); busy('MAKING A ROOM...');
    const code = newCode(), me = newId(10), game = S.opt.game;
    get('rooms/' + code + '/game').then(ex => {
      if (ex != null) { if ((tries || 0) < 6) return createRoom(name, (tries || 0) + 1); throw new Error('busy'); }
      return put('rooms/' + code, { game, host: me, status: 'lobby', gen: 0, created: TS, players: { [me]: { name, order: TS, hb: TS } } }).then(() => enter(code, me));
    }).catch(() => msg('NO SIGNAL', 'COULDN\'T REACH THE PARTY SERVER.<br>CHECK YOUR CONNECTION AND TRY AGAIN.', showMenu));
  }

  function joinCode(pre, err) {
    entry({ kind: 'code', title: 'ROOM CODE', sub: 'ASK THE HOST FOR THE ' + CODE_LEN + '-CHARACTER CODE.', len: CODE_LEN, value: pre, okLabel: 'NEXT', err, back: S.fromLink ? cancel : showMenu, ok: checkRoom });
  }
  function checkRoom(code) {
    busy('LOOKING FOR ROOM ' + code + '...');
    get('rooms/' + code).then(r => {
      if (!r || !r.players) return joinCode(code, 'NO ROOM WITH THAT CODE');
      if (r.game !== S.opt.game) return joinCode(code, 'THAT ROOM IS PLAYING A DIFFERENT GAME');
      // been here before? (same phone, same room) jump straight back in
      let mine = null; try { mine = localStorage.getItem('nbp_' + code); } catch (e) { }
      if (mine && r.players[mine] && (r.status === 'lobby' || S.opt.rejoin !== false)) return patch('rooms/' + code + '/players/' + mine, { left: null, hb: TS }).then(() => enter(code, mine)).catch(() => joinCode(code, 'NO SIGNAL. TRY AGAIN.'));
      if (r.status !== 'lobby') return joinCode(code, 'THAT GAME HAS ALREADY STARTED');
      const here = Object.keys(r.players).filter(id => !r.players[id].left);
      if (here.length >= S.opt.max) return joinCode(code, 'THAT ROOM IS FULL');
      entry({ kind: 'name', title: 'YOUR NAME', sub: 'THIS IS THE NAME YOUR SCORES POST UNDER.', len: NAME_LEN, value: savedName(), okLabel: 'JOIN', back: () => joinCode(code), ok: name => joinRoom(code, name) });
    }).catch(() => joinCode(code, 'NO SIGNAL. TRY AGAIN.'));
  }
  function joinRoom(code, name) {
    saveName(name); busy('JOINING...');
    get('rooms/' + code).then(r => {
      if (!r || !r.players) return joinCode(code, 'NO ROOM WITH THAT CODE');
      if (r.status !== 'lobby') return joinCode(code, 'THAT GAME HAS ALREADY STARTED');
      const here = Object.keys(r.players).filter(id => !r.players[id].left);
      if (here.length >= S.opt.max) return joinCode(code, 'THAT ROOM IS FULL');
      if (here.some(id => r.players[id].name === name)) return entry({ kind: 'name', title: 'YOUR NAME', len: NAME_LEN, value: name, okLabel: 'JOIN', err: name + ' IS ALREADY IN THIS ROOM', back: () => joinCode(code), ok: n => joinRoom(code, n) });
      const me = newId(10);
      return put('rooms/' + code + '/players/' + me, { name, order: TS, hb: TS }).then(() => enter(code, me));
    }).catch(() => joinCode(code, 'NO SIGNAL. TRY AGAIN.'));
  }

  // we're in: follow the room
  function enter(code, me) {
    try { localStorage.setItem('nbp_' + code, me); } catch (e) { }
    if (Party.room) Party.room.leave();
    const room = Party.room = new Room(code, me, S.opt.game);
    const opt = S.opt;
    busy('CONNECTING...');
    let started = false;
    room.on('status', (st) => {
      if (room.closed) return;
      if (st === 'lobby') { started = false; if (opt.onLobby) opt.onLobby(room); openUI(opt.color); lobby(room); return; }
      if (st === 'play' && !started) {
        started = true;
        const rejoin = room.lastGenSeen === room.data.gen && false;
        if (S.mode === 'lobby' || S.mode === 'busy' || S.mode === 'pick') closeUI();
        room.lastGenSeen = room.data.gen;
        opt.onStart(room, !S.inLobbyAtStart);
      }
    });
    room.on('players', () => { if (S.mode === 'lobby') lobby(room); });
    room.on('host', () => { if (S.mode === 'lobby') lobby(room); });
    room.on('kicked', () => { if (room.closed) return; room.leave(); openUI(opt.color); msg('ROOM CLOSED', 'THAT ROOM IS GONE.', () => { closeUI(); if (opt.onLeave) opt.onLeave(); }); });
    room.open();
    // a room that never answers
    setTimeout(() => { if (!room.data && !room.closed && S.mode === 'busy') { room.leave(); msg('NO SIGNAL', 'COULDN\'T REACH THE PARTY SERVER.', showMenu); } }, 12000);
  }

  function lobby(room) {
    if (!room.data || room.closed) return;
    S.inLobbyAtStart = true;
    const ps = room.players().filter(p => !p.left), max = S.opt.max, min = S.opt.min;
    const here = ps.filter(p => !p.gone);
    let rows = '';
    for (let i = 0; i < max; i++) {
      const p = ps[i];
      rows += p ? '<div class="nbq-p' + (p.gone ? ' gone' : '') + (p.me ? ' me' : '') + '" style="--pc:' + (S.opt.colors ? S.opt.colors[i % S.opt.colors.length] : 'var(--nbc)') + '"><span>' + (i + 1) + '.</span><span>' + esc(p.name) + '</span><em>' + (p.host ? 'HOST' : '') + (p.gone ? ' AWAY' : '') + (p.me ? ' YOU' : '') + '</em></div>'
        : '<div class="nbq-p empty"><span>' + (i + 1) + '.</span><span>&middot;&middot;&middot;</span><em></em></div>';
    }
    const host = room.isHost, can = here.length >= min;
    const share = navigator.share ? 'SHARE INVITE' : 'COPY INVITE LINK';
    const keep = S.mode === 'lobby' ? S.foc : 0;
    screen('<div class="nbq-k">' + esc(S.title) + ' &middot; ROOM CODE</div><div class="nbq-code">' + room.code + '</div>' +
      '<div class="nbq-link">' + esc(inviteUrl(room.code).replace(/^https?:\/\//, '')) + '</div>' +
      '<div class="nbq-list">' + rows + '</div>' +
      '<div class="nbq-m">' + (host ? (can ? 'START WHEN EVERYONE IS IN.' : 'WAITING FOR PLAYERS (' + min + '&ndash;' + max + ').') : 'WAITING FOR ' + esc(room.nameOf(room.host)) + ' TO START.') + '</div>' +
      '<div class="nbq-row">' + (host ? '<button class="nbq-b nbq-c' + (can ? '' : ' off') + '" data-k="start">START</button>' : '') +
      '<button class="nbq-b alt nbq-c" data-k="share">' + share + '</button><button class="nbq-b alt nbq-c" data-k="leave">LEAVE</button></div>',
    { mode: 'lobby', foc: keep, back: () => leaveFlow(room, true), press: { start: () => hostStart(room), share: () => shareInvite(room), leave: () => leaveFlow(room, true) } });
  }
  function shareInvite(room) {
    const u = inviteUrl(room.code), text = 'Join my ' + S.title + ' game! Room ' + room.code;
    if (navigator.share) { navigator.share({ title: S.title, text, url: u }).catch(() => { }); return; }
    const done = ok => { const b = panel.querySelector('[data-k="share"]'); if (b) { b.textContent = ok ? 'LINK COPIED!' : u; setTimeout(() => { if (b.isConnected) b.textContent = 'COPY INVITE LINK'; }, 1800); } };
    try { navigator.clipboard.writeText(u).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  }
  function hostStart(room) {
    if (!room.isHost) return;
    const here = room.active().filter(p => !p.left);
    if (here.length < S.opt.min) return;
    const init = S.opt.init ? S.opt.init(room, here) : {};
    busy('STARTING...');
    room.patch('', { status: 'play', gen: (room.data.gen || 0) + 1, g: init || {} }).catch(() => { msg('NO SIGNAL', 'COULDN\'T START. TRY AGAIN.', () => lobby(room)); });
  }

  // LEAVE: a host with company first picks who takes over
  function leaveFlow(room, fromLobby, done) {
    const others = room.active().filter(p => !p.me && !p.left);
    const finish = () => { room.leave(); closeUI(); const f = done || (S.opt && S.opt.onLeave); if (f) setTimeout(f, 0); };
    if (!room.isHost || !others.length) {
      if (fromLobby) return finish();
      openUI(S.opt.color);
      return screen('<div class="nbq-k">' + esc(S.title) + '</div><div class="nbq-h">LEAVE THE GAME?</div><div class="nbq-m">' + (S.opt.leaveNote || 'YOU CAN\'T COME BACK INTO THIS GAME.') + '</div>' +
        '<div class="nbq-row"><button class="nbq-b alt nbq-c" data-k="stay">STAY</button><button class="nbq-b nbq-c" data-k="go">LEAVE</button></div>',
      { mode: 'pick', back: () => { closeUI(); }, press: { stay: () => closeUI(), go: finish } });
    }
    openUI(S.opt.color);
    let btns = '';
    others.forEach(p => { btns += '<button class="nbq-b nbq-c" data-k="h_' + p.id + '">' + esc(p.name) + '</button>'; });
    const press = { stay: () => fromLobby ? lobby(room) : closeUI() };
    others.forEach(p => { press['h_' + p.id] = () => { room.setHost(p.id).then(finish, finish); }; });
    screen('<div class="nbq-k">' + esc(S.title) + '</div><div class="nbq-h">PICK THE NEW HOST</div><div class="nbq-m">YOU\'RE THE HOST. WHO TAKES OVER?</div>' +
      '<div class="nbq-col">' + btns + '<button class="nbq-b alt nbq-c" data-k="stay">STAY</button></div>',
    { mode: 'pick', back: press.stay, press });
  }

  // closing the tab or leaving the page counts as leaving the room
  window.addEventListener('pagehide', () => { if (Party.room && !Party.room.closed) Party.room.leave(); });
  // a phone that's backgrounded stops its heartbeat, so everyone else sees it as away
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Party.room && !Party.room.closed) Party.room.startHb(); });

  // ---------------------------------------------------------------- public API
  const Party = {
    active: false, room: null, DB, GONE_MS,
    // PARTY MODE -> PLAY ONLINE. opt: { game, title, color, min, max, colors, rejoin (default true), init(room, players) -> g, onStart(room), onLobby(room), onLeave(), onCancel(), leaveNote }
    menu(opt) { S.opt = opt; S.title = opt.title; S.fromLink = false; S.inLobbyAtStart = false; openUI(opt.color); showMenu(); },
    // opened from an invite link (?room=CODE): straight to joining that room. Returns true if it did.
    autoJoin(opt) {
      let code = null; try { code = (new URLSearchParams(location.search).get('room') || '').toUpperCase(); } catch (e) { }
      if (!code || code.length !== CODE_LEN) return false;
      try { const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u.toString()); } catch (e) { }
      S.opt = opt; S.title = opt.title; S.fromLink = true; S.inLobbyAtStart = false; openUI(opt.color); checkRoom(code);
      return true;
    },
    // in-game LEAVE (pause menu / results): host picks a successor first
    leave(done) { const r = Party.room; if (!r) { if (done) done(); return; } leaveFlow(r, false, done); },
    // a full-screen notice with one button (used for "you're out" etc.)
    notice(head, body, label, then) {
      openUI(S.opt ? S.opt.color : null);
      screen('<div class="nbq-k">' + esc(S.title || '') + '</div><div class="nbq-h">' + esc(head) + '</div><div class="nbq-m">' + body + '</div>' +
        '<div class="nbq-col"><button class="nbq-b nbq-c" data-k="ok">' + esc(label || 'OK') + '</button></div>', { mode: 'msg', back: () => { closeUI(); if (then) then(); }, press: { ok: () => { closeUI(); if (then) then(); } } });
    },
    close: closeUI,
    // seeded random numbers (same sequence on every phone)
    rng(seed) { let a = seed >>> 0 || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
    seed() { return (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(1))[0] || 1 : (Math.random() * 4294967296) >>> 0 || 1; },
    _applyAt: applyAt,
  };
  window.NBParty = Party;
})();
/* NB-PARTY END */
