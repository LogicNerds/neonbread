/* NB-SCORES START v1 — Neon Bread Arcade global leaderboards.
   Canonical copy: LogicNerds/neonbread/shared/nb-scores.js. Each game inlines this block
   between the NB-SCORES START / END markers so every game stays one self-contained file.
   Backend: Firestore (project neon-bread-arcade) over its REST API. No sign-in, no SDK. */
(function () {
  'use strict';
  if (window.NBScores) return;
  const PROJECT = 'neon-bread-arcade';
  const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  const GAMES = {
    chonx: { title: "CHONX '26", color: '#39ff6a' },
    yeet: { title: 'YEET THE BABY', color: '#ff6b9d' },
    gta: { title: 'GRANDMA THEFT AUTOMATIC', color: '#ffcc4d' },
    karen: { title: 'BODY THE KAREN', color: '#00e5ff' },
    cheekyops: { title: 'CHONX: CHEEKY OPS', color: '#ff2a3d' },
  };
  const ARCADE_URL = 'https://www.neonbreadent.com/';
  const NAME_LEN = 6;
  const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const NAME_KEY = 'nb_name';

  // ---------------------------------------------------------------- name filter
  // Slurs are blocked; swearing is fine. Checked after undoing common letter swaps (0->O, 1->I ...).
  // The same lists live in the Firestore rules as a second line of defence.
  const SUB = ['nigg', 'nigr', 'niga', 'fagot', 'faggot', 'faggt', 'kike', 'kyke', 'trann', 'trany', 'retard', 'wetbac', 'beaner', 'raghea', 'chink'];
  const EXACT = ['nig', 'fag', 'fags', 'spic', 'spics', 'spick', 'coon', 'coons', 'gook', 'gooks', 'dyke', 'dykes', 'jap', 'japs', 'paki', 'pakis', 'wop', 'wops', 'kkk'];
  const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };
  function norm(s) { return s.toLowerCase().split('').map(c => LEET[c] || c).join(''); }
  function blocked(name) {
    const raw = name.toLowerCase(), n = norm(name), squeezed = n.replace(/(.)\1+/g, '$1');
    return [raw, n, squeezed].some(v => SUB.some(w => v.includes(w)) || EXACT.includes(v));
  }
  function clean(name) { return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NAME_LEN); }

  // ---------------------------------------------------------------- weeks (reset Monday 00:00 Pacific)
  function weekKey(d) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
    const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday] || 0;
    const u = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - back));
    return u.toISOString().slice(0, 10);
  }
  function weekLabel(k) {
    const [y, m, d] = k.split('-').map(Number);
    return 'WEEK OF ' + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1] + ' ' + d;
  }

  // ---------------------------------------------------------------- Firestore REST
  function req(path, body) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 9000) : 0;
    return fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(r => r.json().then(j => {
        clearTimeout(t);
        const err = j && (j.error || (Array.isArray(j) && j[0] && j[0].error));
        if (!r.ok || err) throw new Error((err && err.message) || ('HTTP ' + r.status));
        return j;
      }))
      .catch(e => { clearTimeout(t); throw e; });
  }
  const sv = v => ({ stringValue: v });
  const fEq = (f, v) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: sv(v) } });
  function whereFor(game, scope, above) {
    const fs = [fEq('game', game)];
    if (scope === 'week') fs.push(fEq('week', weekKey()));
    if (above != null) fs.push({ fieldFilter: { field: { fieldPath: 'score' }, op: 'GREATER_THAN', value: { integerValue: String(above) } } });
    return { compositeFilter: { op: 'AND', filters: fs } };
  }
  function newId() {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = '';
    const r = (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(20)) : Array.from({ length: 20 }, () => Math.random() * 256);
    for (let i = 0; i < 20; i++) s += a[r[i] % a.length];
    return s;
  }
  function post(game, name, score) {
    const id = newId();
    return req(':commit', {
      writes: [{
        update: {
          name: 'projects/' + PROJECT + '/databases/(default)/documents/scores/' + id,
          fields: { game: sv(game), name: sv(name), score: { integerValue: String(score) }, week: sv(weekKey()) },
        },
        updateTransforms: [{ fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      }],
    }).then(() => id);
  }
  function top(game, scope, limit) {
    return req(':runQuery', {
      structuredQuery: {
        from: [{ collectionId: 'scores' }], where: whereFor(game, scope),
        orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }], limit: limit || 100,
      },
    }).then(rows => rows.filter(r => r.document).map(r => {
      const f = r.document.fields || {};
      return { id: r.document.name.split('/').pop(), name: (f.name && f.name.stringValue) || '???', score: +((f.score && f.score.integerValue) || 0) };
    }));
  }
  function rank(game, scope, score) {
    return req(':runAggregationQuery', {
      structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'scores' }], where: whereFor(game, scope, score) }, aggregations: [{ alias: 'n', count: {} }] },
    }).then(r => 1 + +(((r[0] || {}).result || {}).aggregateFields || {}).n.integerValue || 0);
  }

  // ---------------------------------------------------------------- styles
  const CSS = `
#nbs{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(6,0,18,.9);font-family:'Press Start 2P',monospace;color:#fff;-webkit-user-select:none;user-select:none;touch-action:manipulation}
#nbs.on{display:flex}
#nbs *{box-sizing:border-box;margin:0;padding:0;font-family:inherit}
#nbsP{position:absolute;left:50%;top:50%;transform-origin:50% 50%;display:flex;flex-direction:column;align-items:center;gap:26px;padding:44px 50px;background:#0b0620;border:6px solid var(--nbc);box-shadow:0 0 40px var(--nbc),inset 0 0 40px rgba(0,0,0,.6);text-align:center}
#nbsP::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 2px,transparent 2px 5px)}
.nbs-k{font-size:22px;color:#00e5ff;text-shadow:0 0 12px #00e5ff;letter-spacing:2px}
.nbs-h{font-size:46px;color:var(--nbc);text-shadow:0 0 18px var(--nbc);line-height:1.3}
.nbs-s{font-size:56px;color:#ffe14d;text-shadow:0 0 18px #ffb000}
.nbs-m{font-size:20px;color:#d9d0ff;line-height:1.9}
.nbs-e{font-size:20px;color:#ff4b6e;min-height:24px}
.nbs-slots{display:flex;gap:16px;position:relative}
.nbs-slot{display:flex;flex-direction:column;align-items:center;gap:10px}
.nbs-ar{width:96px;height:52px;font-size:24px;background:transparent;color:#8a7bd8;border:4px solid #3a2f78;cursor:pointer}
.nbs-ar:active{background:#3a2f78;color:#fff}
.nbs-ch{width:96px;height:112px;display:flex;align-items:center;justify-content:center;font-size:64px;border:5px solid #3a2f78;background:#120a30;cursor:pointer}
.nbs-ch.cur{border-color:var(--nbc);box-shadow:0 0 24px var(--nbc);animation:nbsb 1s steps(2) infinite}
@keyframes nbsb{50%{color:var(--nbc)}}
#nbsIn{position:absolute;opacity:0;width:1px;height:1px;left:0;top:0;font-size:16px;border:0}
.nbs-row{display:flex;gap:22px;flex-wrap:wrap;justify-content:center}
.nbs-b{font-size:26px;padding:20px 34px;background:rgba(0,0,0,.4);color:var(--nbc);border:5px solid var(--nbc);cursor:pointer;box-shadow:0 0 16px var(--nbc)}
.nbs-b.sel,.nbs-b:hover{background:var(--nbc);color:#0b0620}
.nbs-b.alt{--nbc:#00e5ff}
.nbs-tabs{display:flex;gap:14px}
.nbs-tab{font-size:22px;padding:14px 22px;background:transparent;color:#8a7bd8;border:4px solid #3a2f78;cursor:pointer}
.nbs-tab.on{color:#0b0620;background:#00e5ff;border-color:#00e5ff;box-shadow:0 0 18px #00e5ff}
.nbs-list{width:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--nbc) transparent}
.nbs-li{display:grid;grid-template-columns:110px 1fr auto;gap:20px;font-size:26px;line-height:1.95;padding:0 14px;text-align:left}
.nbs-li span:last-child{text-align:right;color:#ffe14d}
.nbs-li.me{background:var(--nbc);color:#0b0620}
.nbs-li.me span:last-child{color:#0b0620}
.nbs-li.r1{color:#ffe14d}.nbs-li.r2{color:#e6e6ff}.nbs-li.r3{color:#ffa45c}
.nbs-hint{font-size:16px;color:#7d72b8;line-height:1.9}
`;
  let root, panel, dims = { w: 1280, h: 820 };
  function ensureDom() {
    if (root) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'nbs';
    root.innerHTML = '<div id="nbsP"></div>';
    document.body.appendChild(root);
    panel = root.firstChild;
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel', 'contextmenu'].forEach(ev =>
      root.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'touchstart' || ev === 'touchend' || ev === 'wheel' }));
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 200));
  }
  function fit() {
    if (!root || !NB.active) return;
    const vw = window.innerWidth, vh = window.innerHeight, portrait = vh > vw * 1.05;
    dims = portrait ? { w: 760, h: 1240 } : { w: 1280, h: 820 };
    const s = Math.min(vw / dims.w, vh / dims.h);
    panel.style.width = dims.w - 40 + 'px';
    panel.style.maxHeight = dims.h - 40 + 'px';
    panel.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
    panel.classList.toggle('portrait', portrait);
    const list = panel.querySelector('.nbs-list');
    if (list) list.style.maxHeight = (portrait ? 640 : 330) + (NB._expanded ? (portrait ? 140 : 40) : 0) + 'px';
  }

  // ---------------------------------------------------------------- tiny sound (optional, uses its own context)
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

  // ---------------------------------------------------------------- input while the overlay is open
  // Keyboard is captured before the game sees it. The game must also skip its own menu input
  // while NBScores.active is true (each game checks it), because games poll the controller themselves.
  const Ctl = { prev: null, held: {}, rep: {} };
  function padState() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads || []) if (p && p.connected) { gp = p; break; }
    if (!gp) return null;
    const b = i => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > 0.5); };
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    return { up: b(12) || ay < -0.5, down: b(13) || ay > 0.5, left: b(14) || ax < -0.5, right: b(15) || ax > 0.5, a: b(0), b: b(1), start: b(9), lb: b(4), rb: b(5), y: b(3) };
  }
  function pollPad() {
    const s = padState();
    if (!s) { Ctl.prev = null; return; }
    const p = Ctl.prev || s; // first poll after opening: anything already held doesn't count
    const now = performance.now();
    for (const k in s) {
      if (s[k] && !p[k]) { Ctl.rep[k] = now + 380; NB._act(k); }
      else if (s[k] && (k === 'up' || k === 'down' || k === 'left' || k === 'right') && now > (Ctl.rep[k] || 1e15)) { Ctl.rep[k] = now + 110; NB._act(k); }
    }
    Ctl.prev = s;
  }
  let raf = 0;
  function loop() { raf = 0; if (!NB.active) return; pollPad(); raf = requestAnimationFrame(loop); }

  window.addEventListener('keydown', e => {
    if (!NB.active) return;
    const inp = e.target && e.target.id === 'nbsIn';
    if (inp && e.key !== 'Enter' && e.key !== 'Escape') return; // phone keyboard typing goes through the input event
    const k = e.code, map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', Enter: 'start', NumpadEnter: 'start', Escape: 'b', Backspace: 'bs', Tab: 'tab', Space: 'a' };
    let act = map[k];
    if (NB._mode === 'enter') {
      if (/^Key[A-Z]$/.test(k) || /^Digit[0-9]$/.test(k) || /^Numpad[0-9]$/.test(k)) act = 'type:' + k.slice(-1);
      if (k === 'KeyW' || k === 'KeyS') act = 'type:' + k.slice(-1);
      if (k === 'Space') act = 'right';
    } else if (k === 'KeyA') act = 'left'; else if (k === 'KeyD') act = 'right';
    e.preventDefault(); e.stopImmediatePropagation();
    if (act && !e.repeat || (act && /^(up|down|left|right|bs)$/.test(act))) NB._act(act);
  }, true);

  // a focused game button behind the overlay must not fire on Space/Enter release
  window.addEventListener('keyup', e => {
    if (NB.active && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && !(e.target && root && root.contains(e.target))) e.preventDefault();
  }, true);

  // ---------------------------------------------------------------- the overlay
  const NB = {
    active: false, _mode: null, _expanded: false,
    GAMES, ARCADE_URL, weekKey, weekLabel, blocked, clean, post, top, rank,
    exitToArcade() { location.href = ARCADE_URL; },

    // After every run: name entry -> post -> board. onClose fires when the player continues.
    submit(opt) {
      const game = opt.game, score = Math.max(0, Math.floor(+opt.score || 0));
      ensureDom(); open(game);
      let last = ''; try { last = clean(localStorage.getItem(NAME_KEY)); } catch (e) { }
      const chars = (last || '').padEnd(NAME_LEN, ' ').split('');
      // last name used on this device is pre-filled; typing a new letter first replaces it
      const st = { game, score, chars, cur: 0, onClose: opt.onClose, err: '', fresh: !!last };
      NB._st = st; NB._mode = 'enter';
      renderEnter();
    },

    // View-only boards (used by the arcade page). onClose optional.
    showBoard(opt) {
      ensureDom(); open(opt.game);
      NB._st = { game: opt.game, score: null, myId: null, onClose: opt.onClose, scope: opt.scope || 'week', ranks: null };
      NB._mode = 'board'; NB._expanded = false;
      renderBoard();
    },

    _act(a) {
      const st = NB._st; if (!st) return;
      if (NB._mode === 'enter') return actEnter(a);
      if (NB._mode === 'board') return actBoard(a);
      if (NB._mode === 'error') return actError(a);
    },
  };
  window.NBScores = NB;

  function open(game) {
    const g = GAMES[game] || { color: '#ff4bd8' };
    root.style.setProperty('--nbc', g.color);
    root.classList.add('on'); NB.active = true; NB._expanded = false;
    Ctl.prev = padState();
    const unfocus = () => { const a = document.activeElement; if (NB.active && a && a !== document.body && !root.contains(a) && a.blur) a.blur(); };
    unfocus(); setTimeout(unfocus, 60); setTimeout(unfocus, 200);
    if (!raf) raf = requestAnimationFrame(loop);
    fit();
  }
  function close() {
    root.classList.remove('on'); NB.active = false; NB._mode = null;
    const cb = NB._st && NB._st.onClose; NB._st = null; panel.innerHTML = '';
    if (cb) setTimeout(cb, 0);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');

  // ---- name entry
  function nameNow(st) { return st.chars.join('').replace(/\s+$/, '').replace(/ /g, ''); }
  function renderEnter() {
    const st = NB._st, g = GAMES[st.game];
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    let slots = '';
    for (let i = 0; i < NAME_LEN; i++) {
      slots += '<div class="nbs-slot"><button class="nbs-ar" data-up="' + i + '">&#9650;</button><div class="nbs-ch' + (i === st.cur ? ' cur' : '') + '" data-ch="' + i + '">' +
        (st.chars[i] === ' ' ? '&middot;' : esc(st.chars[i])) + '</div><button class="nbs-ar" data-dn="' + i + '">&#9660;</button></div>';
    }
    panel.innerHTML =
      '<div class="nbs-k">' + esc(g.title) + ' &middot; GLOBAL HIGH SCORES</div>' +
      '<div class="nbs-h">ENTER YOUR NAME</div>' +
      '<div class="nbs-s">' + fmt(st.score) + '</div>' +
      '<div class="nbs-slots">' + slots + '<input id="nbsIn" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>' +
      '<div class="nbs-e">' + esc(st.err) + '</div>' +
      '<div class="nbs-row"><button class="nbs-b sel" data-ok="1">POST SCORE</button></div>' +
      '<div class="nbs-hint">' + (touch ? 'TAP &#9650; &#9660; TO PICK LETTERS, OR TAP A LETTER TO TYPE'
        : 'TYPE YOUR NAME &middot; ENTER = POST<br>CONTROLLER: &#9650;&#9660; LETTER &middot; &#9664;&#9654; MOVE &middot; A NEXT &middot; B BACK &middot; START POST') + '</div>';
    panel.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { st.cur = +b.dataset.up; cycle(1); });
    panel.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { st.cur = +b.dataset.dn; cycle(-1); });
    const inp = panel.querySelector('#nbsIn');
    panel.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
      st.cur = +b.dataset.ch; renderEnter();
      if (touch) { const i2 = panel.querySelector('#nbsIn'); i2.value = nameNow(st); try { i2.focus({ preventScroll: true }); } catch (e) { i2.focus(); } }
    });
    // phone keyboard: update the letters in place so the input keeps focus (and the keyboard stays up)
    inp.addEventListener('input', () => {
      const v = clean(inp.value); if (inp.value !== v) inp.value = v;
      st.chars = v.padEnd(NAME_LEN, ' ').split(''); st.cur = Math.min(v.length, NAME_LEN - 1); st.err = ''; st.fresh = false;
      panel.querySelectorAll('[data-ch]').forEach((el, i) => { el.innerHTML = st.chars[i] === ' ' ? '&middot;' : esc(st.chars[i]); el.classList.toggle('cur', i === st.cur); });
      panel.querySelector('.nbs-e').textContent = '';
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); submitName(); } });
    panel.querySelector('[data-ok]').onclick = submitName;
    fit();
  }
  function cycle(d) {
    const st = NB._st; st.fresh = false; let i = CHARS.indexOf(st.chars[st.cur]); if (i < 0) i = 0;
    st.chars[st.cur] = CHARS[(i + d + CHARS.length) % CHARS.length]; st.err = ''; blip(660, 0.04); renderEnter();
  }
  function actEnter(a) {
    const st = NB._st;
    if (a.indexOf('type:') !== 0 && a !== 'start') st.fresh = false;
    if (a === 'up') return cycle(1);
    if (a === 'down') return cycle(-1);
    if (a === 'left') { st.cur = Math.max(0, st.cur - 1); blip(520, 0.04); return renderEnter(); }
    if (a === 'right') { st.cur = Math.min(NAME_LEN - 1, st.cur + 1); blip(520, 0.04); return renderEnter(); }
    if (a === 'a') { if (st.cur === NAME_LEN - 1) return submitName(); st.cur++; blip(520, 0.04); return renderEnter(); }
    if (a === 'b' || a === 'bs') {
      if (a === 'bs' && st.chars[st.cur] === ' ' && st.cur > 0) st.cur--;
      if (a === 'bs') st.chars[st.cur] = ' ';
      else st.cur = Math.max(0, st.cur - 1);
      return renderEnter();
    }
    if (a === 'start') return submitName();
    if (a.indexOf('type:') === 0 && st.fresh) { st.chars = ' '.repeat(NAME_LEN).split(''); st.cur = 0; }
    if (a.indexOf('type:') === 0) { st.fresh = false; st.chars[st.cur] = a.slice(5); st.err = ''; st.cur = Math.min(NAME_LEN - 1, st.cur + 1); blip(700, 0.04); return renderEnter(); }
  }
  function submitName() {
    const st = NB._st; if (!st || NB._mode !== 'enter') return;
    const name = clean(nameNow(st));
    if (!name) { st.err = 'PICK AT LEAST ONE LETTER'; blip(180, 0.15); return renderEnter(); }
    if (blocked(name)) { st.err = 'THAT NAME IS NOT ALLOWED'; blip(180, 0.15); return renderEnter(); }
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { }
    st.name = name; doPost();
  }
  function doPost() {
    const st = NB._st;
    NB._mode = 'posting';
    panel.innerHTML = '<div class="nbs-h">POSTING...</div><div class="nbs-m">' + esc(st.name) + ' &middot; ' + fmt(st.score) + '</div>';
    fit(); blip(880, 0.08);
    post(st.game, st.name, st.score).then(id => {
      st.myId = id; st.scope = 'week';
      return Promise.all([rank(st.game, 'week', st.score).catch(() => null), rank(st.game, 'all', st.score).catch(() => null)]);
    }).then(r => {
      if (!NB._st) return;
      st.ranks = { week: r[0], all: r[1] }; NB._mode = 'board'; blip(1040, 0.12);
      renderBoard();
    }).catch(err => {
      if (!NB._st) return;
      NB._mode = 'error'; st.errMsg = String(err && err.message || err);
      panel.innerHTML = '<div class="nbs-h">NO SIGNAL</div><div class="nbs-m">COULDN\'T REACH THE LEADERBOARD.<br>YOUR SCORE WASN\'T POSTED.</div>' +
        '<div class="nbs-row"><button class="nbs-b sel" data-r="1">TRY AGAIN</button><button class="nbs-b alt" data-c="1">CONTINUE</button></div>';
      panel.querySelector('[data-r]').onclick = doPost;
      panel.querySelector('[data-c]').onclick = close;
      st.errSel = 0; fit();
    });
  }
  function actError(a) {
    const st = NB._st, bs = panel.querySelectorAll('.nbs-b');
    if (a === 'left' || a === 'right' || a === 'up' || a === 'down' || a === 'tab') { st.errSel = 1 - (st.errSel || 0); bs.forEach((b, i) => b.classList.toggle('sel', i === st.errSel)); }
    if (a === 'a' || a === 'start') bs[st.errSel || 0].click();
    if (a === 'b') close();
  }

  // ---- boards
  function renderBoard() {
    const st = NB._st, g = GAMES[st.game];
    const posted = st.score != null;
    let rk = '';
    if (posted && st.ranks) rk = 'YOU PLACED ' + (st.ranks.week ? '#' + st.ranks.week : '?') + ' THIS WEEK &middot; ' + (st.ranks.all ? '#' + st.ranks.all : '?') + ' ALL-TIME';
    panel.innerHTML =
      '<div class="nbs-k">' + esc(g.title) + '</div>' +
      '<div class="nbs-h">HIGH SCORES</div>' +
      (rk ? '<div class="nbs-m">' + rk + '</div>' : '') +
      '<div class="nbs-tabs"><button class="nbs-tab' + (st.scope === 'week' ? ' on' : '') + '" data-t="week">THIS WEEK</button><button class="nbs-tab' + (st.scope === 'all' ? ' on' : '') + '" data-t="all">ALL-TIME</button></div>' +
      '<div class="nbs-m" style="font-size:16px;color:#7d72b8">' + (st.scope === 'week' ? weekLabel(weekKey()) + ' &middot; RESETS MONDAY' : 'SINCE THE DOORS OPENED') + '</div>' +
      '<div class="nbs-list"><div class="nbs-m">LOADING...</div></div>' +
      '<div class="nbs-row"><button class="nbs-b alt" data-x="1">' + (NB._expanded ? 'TOP 10' : 'SHOW TOP 100') + '</button><button class="nbs-b sel" data-c="1">CONTINUE</button></div>' +
      '<div class="nbs-hint">&#9664;&#9654; / LB RB: WEEK OR ALL-TIME &middot; &#9650;&#9660; SCROLL &middot; A / ENTER: CONTINUE &middot; Y / TAB: TOP 100</div>';
    panel.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.scope = b.dataset.t; renderBoard(); });
    panel.querySelector('[data-x]').onclick = () => { NB._expanded = !NB._expanded; renderBoard(); };
    panel.querySelector('[data-c]').onclick = close;
    fit();
    const want = st.scope, n = NB._expanded ? 100 : 10;
    top(st.game, want, n).then(rows => {
      if (!NB._st || NB._mode !== 'board' || st.scope !== want) return;
      const list = panel.querySelector('.nbs-list');
      if (!rows.length) { list.innerHTML = '<div class="nbs-m">NO SCORES YET. BE THE FIRST.</div>'; return; }
      list.innerHTML = rows.map((r, i) => '<div class="nbs-li' + (r.id === st.myId ? ' me' : i < 3 ? ' r' + (i + 1) : '') + '"><span>' + (i + 1) + '.</span><span>' + esc(r.name) + '</span><span>' + fmt(r.score) + '</span></div>').join('');
      const me = list.querySelector('.me'); if (me) me.scrollIntoView({ block: 'nearest' });
    }).catch(() => {
      if (!NB._st || NB._mode !== 'board') return;
      panel.querySelector('.nbs-list').innerHTML = '<div class="nbs-m">COULDN\'T LOAD SCORES.</div>';
    });
  }
  function actBoard(a) {
    const st = NB._st;
    if (a === 'left' || a === 'right' || a === 'lb' || a === 'rb') { st.scope = st.scope === 'week' ? 'all' : 'week'; blip(520, 0.04); return renderBoard(); }
    if (a === 'up' || a === 'down') { const l = panel.querySelector('.nbs-list'); if (l) l.scrollTop += a === 'down' ? 120 : -120; return; }
    if (a === 'tab' || a === 'y') { NB._expanded = !NB._expanded; return renderBoard(); }
    if (a === 'a' || a === 'start' || a === 'b') return close();
  }
})();
/* NB-SCORES END */
