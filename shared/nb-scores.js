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
    pedxing: { title: 'PED X-ING', color: '#d4ff00' },
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
  function rowsOf(res) {
    return res.filter(r => r.document).map(r => {
      const f = r.document.fields || {};
      return { id: r.document.name.split('/').pop(), ref: r.document.name, name: (f.name && f.name.stringValue) || '???', score: +((f.score && f.score.integerValue) || 0) };
    });
  }
  function top(game, scope, limit) {
    return req(':runQuery', {
      structuredQuery: {
        from: [{ collectionId: 'scores' }], where: whereFor(game, scope),
        orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }], limit: limit || 100,
      },
    }).then(rowsOf);
  }
  // Every all-time score, PAGE at a time. `after` is the last row of the previous page (cursor, so skipped rows aren't billed).
  const PAGE = 100;
  function page(game, after) {
    const q = {
      from: [{ collectionId: 'scores' }], where: whereFor(game, 'all'),
      orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
      limit: PAGE,
    };
    if (after) q.startAt = { values: [{ integerValue: String(after.score) }, { referenceValue: after.ref }], before: false };
    return req(':runQuery', { structuredQuery: q }).then(rowsOf);
  }
  function rank(game, scope, score) {
    return req(':runAggregationQuery', {
      structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'scores' }], where: whereFor(game, scope, score) }, aggregations: [{ alias: 'n', count: {} }] },
    }).then(r => 1 + +(((r[0] || {}).result || {}).aggregateFields || {}).n.integerValue || 0);
  }

  // ---------------------------------------------------------------- tickets
  // One wallet per device, shared by every game on neonbreadent.com (they all share localStorage).
  // A run pays score / rate (aiming for ~20-40 on an average run, min 5, max 150) plus bonuses.
  // Party mode never calls submit(), so party runs earn nothing.
  const TK_KEY = 'nb_tickets_v1';
  const TK_RATE = { chonx: 1000, cheekyops: 2000, yeet: 600, gta: 1500, karen: 400, pedxing: 1500 };
  const TK = { min: 5, max: 150, best: 25, top10: 50, firstToday: 10, golden: 500, goldenOdds: 1 / 40 };
  function pacificDay(d) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function tkBlank() { return { v: 1, bal: 0, earned: 0, spent: 0, best: {}, day: {}, owned: {}, equip: {}, golden: 0, runs: 0 }; }
  function tkLoad() {
    try { const w = JSON.parse(localStorage.getItem(TK_KEY) || 'null'); if (w && typeof w.bal === 'number') return Object.assign(tkBlank(), w); } catch (e) { }
    return tkBlank();
  }
  function tkSave(w) { try { localStorage.setItem(TK_KEY, JSON.stringify(w)); } catch (e) { } tkFire(w); }
  const tkListeners = [];
  function tkFire(w) { tkListeners.forEach(f => { try { f(w); } catch (e) { } }); }
  // other tabs (the arcade open in one tab, a game in another) see changes too
  window.addEventListener('storage', e => { if (e.key === TK_KEY) tkFire(tkLoad()); });
  const Tickets = {
    rates: TK_RATE, rules: TK, today: pacificDay,
    wallet: tkLoad,
    balance() { return tkLoad().bal; },
    onChange(f) { tkListeners.push(f); },
    add(n) { const w = tkLoad(); n = Math.max(0, Math.floor(n)); w.bal += n; w.earned += n; tkSave(w); return w.bal; },
    spend(n) { const w = tkLoad(); n = Math.max(0, Math.floor(n)); if (w.bal < n) return false; w.bal -= n; w.spent += n; tkSave(w); return true; },
    owns(id) { return !!tkLoad().owned[id]; },
    // buy a prize: takes the tickets and records it in one save
    buy(id, price) { const w = tkLoad(); if (w.owned[id] || w.bal < price) return false; w.bal -= price; w.spent += price; w.owned[id] = Date.now(); tkSave(w); return true; },
    equipped(game, slot) { const e = tkLoad().equip[game] || {}; return slot ? e[slot] || null : e; },
    setEquip(game, slot, id) { const w = tkLoad(); w.equip[game] = w.equip[game] || {}; if (id) w.equip[game][slot] = id; else delete w.equip[game][slot]; tkSave(w); },
    // work out what a finished run pays (doesn't save)
    quote(game, score, ranks, feats) {
      const w = tkLoad(), lines = [];
      const base = Math.max(TK.min, Math.min(TK.max, Math.round(score / (TK_RATE[game] || 1000))));
      lines.push({ t: 'RUN PAYOUT', n: base });
      if (score > 0 && score > (w.best[game] || 0)) lines.push({ t: 'NEW PERSONAL BEST', n: TK.best });
      if (ranks && ranks.week && ranks.week <= 10) lines.push({ t: 'WEEKLY TOP 10', n: TK.top10 });
      if (w.day[game] !== pacificDay()) lines.push({ t: 'FIRST RUN TODAY', n: TK.firstToday });
      (feats || []).forEach(f => { if (f && f.n > 0) lines.push({ t: String(f.t), n: Math.floor(f.n) }); });
      if (Math.random() < TK.goldenOdds) lines.push({ t: 'GOLDEN TICKET!', n: TK.golden, gold: true });
      return { lines, total: lines.reduce((a, l) => a + l.n, 0) };
    },
    // pay it out: one save, so closing the page during the animation loses nothing
    payRun(game, score, q) {
      const w = tkLoad();
      w.bal += q.total; w.earned += q.total; w.runs++;
      w.best[game] = Math.max(w.best[game] || 0, score); w.day[game] = pacificDay();
      if (q.lines.some(l => l.gold)) w.golden++;
      tkSave(w); return w.bal;
    },
  };
  // ---- prize catalog (prices approved Nov 25 2026). Later stages add game cosmetics, cheat cards and seasonal items.
  // shelf: junk | collect | top. Every item here can be bought at the counter.
  Tickets.catalog = [
    { id: 'junk.spider', shelf: 'junk', name: 'SPIDER RING', price: 10 },
    { id: 'junk.trap', shelf: 'junk', name: 'FINGER TRAP', price: 15 },
    { id: 'junk.ball', shelf: 'junk', name: 'BOUNCY BALL', price: 20 },
    { id: 'junk.candy', shelf: 'junk', name: 'CANDY NECKLACE', price: 25 },
    { id: 'junk.pencil', shelf: 'junk', name: '"WORLD\'S OK-EST GAMER" PENCIL', price: 30 },
    { id: 'junk.sticky', shelf: 'junk', name: 'STICKY HAND', price: 35 },
    { id: 'junk.kazoo', shelf: 'junk', name: 'KAZOO', price: 40 },
    { id: 'junk.whoopee', shelf: 'junk', name: 'WHOOPEE CUSHION', price: 50 },
    { id: 'junk.slap', shelf: 'junk', name: 'SLAP BRACELET', price: 60 },
    { id: 'junk.mood', shelf: 'junk', name: 'MOOD RING', price: 75 },
    { id: 'junk.clanker', shelf: 'junk', name: 'MINI CLANKER KEYCHAIN', price: 120 },
    { id: 'junk.rat', shelf: 'junk', name: '6-7 RAT SQUISHY', price: 150 },
    { id: 'col.grandma', shelf: 'collect', name: 'GRANDMA KEYCHAIN', price: 400 },
    { id: 'col.brain', shelf: 'collect', name: 'BRAYN BRAIN STRESS BALL', price: 500 },
    { id: 'col.babybob', shelf: 'collect', name: 'BABY BOBBLEHEAD', price: 600 },
    { id: 'col.karenbob', shelf: 'collect', name: 'KAREN BOBBLEHEAD', price: 600 },
    { id: 'col.chonx', shelf: 'collect', name: 'CHONX PLUSH', price: 800 },
    { id: 'col.gerb', shelf: 'collect', name: 'GERB PLUSH', price: 900 },
    { id: 'col.mittens', shelf: 'collect', name: 'CHAIRMAN MITTENS PLUSH', price: 1200 },
    { id: 'top.giant', shelf: 'top', name: 'GIANT CHONX PLUSH', price: 10000 },
    { id: 'top.token', shelf: 'top', name: 'GOLD ARCADE TOKEN', price: 25000 },
  ];
  // game cosmetics: shelf = game id, slot = where it goes (one item per slot)
  const add = (game, slot, list) => list.forEach(([key, name, price]) => Tickets.catalog.push({ id: game + '.' + slot + '.' + key, shelf: game, game, slot, name, price }));
  add('yeet', 'hat', [['party', 'PARTY HAT', 150], ['beanie', 'PROPELLER BEANIE', 200], ['cap', 'BACKWARDS CAP', 200], ['helmet', 'BIKE HELMET', 250], ['chef', 'CHEF HAT', 300], ['cowboy', 'COWBOY HAT', 300], ['viking', 'VIKING HELMET', 600], ['crown', 'CROWN', 1000]]);
  add('yeet', 'face', [['shades', 'SUNGLASSES', 250], ['stache', 'FAKE MUSTACHE', 300], ['goggles', 'AVIATOR GOGGLES', 400], ['paci', 'BLING PACIFIER', 500]]);
  add('yeet', 'outfit', [['tutu', 'TUTU', 300], ['floaties', 'FLOATIES', 350], ['camo', 'CAMO DIAPER', 400], ['cape', 'SUPERHERO CAPE', 700], ['gold', 'GOLD DIAPER', 1500]]);
  add('yeet', 'trail', [['glitter', 'GLITTER TRAIL', 500], ['tp', 'TOILET-PAPER STREAMER', 600], ['rainbow', 'RAINBOW TRAIL', 800], ['fire', 'FIRE TRAIL', 1200]]);
  Tickets.shelves = { junk: 'JUNK', collect: 'COLLECTIBLES', top: 'TOP SHELF', chonx: "CHONX '26", cheekyops: 'CHEEKY OPS', yeet: 'YEET THE BABY', gta: 'GRANDMA THEFT AUTO', karen: 'BODY THE KAREN', pedxing: 'PED X-ING' };
  Tickets.slots = { yeet: { hat: 'HATS', face: 'FACE', outfit: 'OUTFIT', trail: 'FLIGHT TRAIL' } };
  Tickets.item = id => Tickets.catalog.find(i => i.id === id) || null;
  // ---- prize icons: 16x16 pixel art drawn in code (shown at the counter and in each game's PRIZES menu)
  class IPX {
    constructor(w, h) { this.w = w; this.h = h; this.p = new Array(w * h).fill(null); }
    set(x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = c; return this; }
    get(x, y) { return (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.p[y * this.w + x] : null; }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
    ell(cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) { const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry; if (dx * dx + dy * dy <= 1) this.set(x, y, c); } return this; }
    line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) this.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); return this; }
    outline(c) { const a = []; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { if (this.get(x, y) !== null) continue; if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) a.push([x, y]); } a.forEach(([x, y]) => this.set(x, y, c)); return this; }
    canvas() { const c = document.createElement('canvas'); c.width = this.w; c.height = this.h; const x = c.getContext('2d'), img = x.createImageData(this.w, this.h); for (let i = 0; i < this.p.length; i++) { const col = this.p[i]; if (!col) continue; let r = col.slice(1); if (r.length === 3) r = r[0] + r[0] + r[1] + r[1] + r[2] + r[2]; const v = parseInt(r, 16); img.data[i * 4] = v >> 16; img.data[i * 4 + 1] = (v >> 8) & 255; img.data[i * 4 + 2] = v & 255; img.data[i * 4 + 3] = 255; } x.putImageData(img, 0, 0); return c; }
  }
  Tickets.PX = IPX;
  const ICONS = {}, ICON_ART = {};
  Tickets.icon = id => {
    if (ICONS[id]) return ICONS[id];
    const p = new IPX(16, 16), f = ICON_ART[id];
    if (f) f(p); else { p.rect(3, 3, 10, 10, '#00e5ff'); p.rect(6, 6, 4, 4, '#ff2bd6'); }
    p.outline('#1a0f08');
    return (ICONS[id] = p.canvas());
  };
  Object.assign(ICON_ART, {
    'junk.spider': p => { p.ell(8, 11, 4, 3, '#2b2b2b'); p.ell(8, 11, 2.2, 1.4, null); p.ell(8, 5, 2.5, 2, '#111'); for (let k = 0; k < 3; k++) { p.line(5, 4 + k * 2, 2, 2 + k * 2, '#111'); p.line(11, 4 + k * 2, 14, 2 + k * 2, '#111'); } p.set(7, 4, '#ff2a2a'); p.set(9, 4, '#ff2a2a'); },
    'junk.trap': p => { p.rect(1, 6, 14, 5, '#ffe14d'); for (let k = 0; k < 14; k += 3) p.line(1 + k, 10, 3 + k, 6, '#ff2a3d'); },
    'junk.ball': p => { p.ell(8, 8, 6, 6, '#ff2bd6'); p.rect(2, 7, 12, 2, '#ffe14d'); p.ell(6, 5, 1.5, 1.2, '#ffd3f6'); },
    'junk.candy': p => { const cols = ['#ff9fb0', '#9fe3ff', '#ffe14d', '#b8ff9f', '#d9b8ff']; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; p.ell(8 + Math.cos(a) * 5.5, 8 + Math.sin(a) * 5.5, 1.3, 1.3, cols[k % 5]); } },
    'junk.pencil': p => { for (let k = 0; k < 11; k++) p.rect(2 + k, 12 - k, 2, 2, '#ffe14d'); p.rect(1, 13, 2, 2, '#ff9fb0'); p.rect(13, 2, 2, 2, '#f6c98a'); p.set(15, 1, '#333'); },
    'junk.sticky': p => { p.line(2, 2, 6, 7, '#5fe0b7'); p.ell(10, 10, 3.5, 3.5, '#39ff6a'); for (let k = 0; k < 4; k++) p.rect(8 + k * 1.5, 4, 1, 4, '#39ff6a'); p.ell(9, 10, 1, 1, '#b8ffcf'); },
    'junk.kazoo': p => { p.rect(2, 7, 11, 3, '#ff2a3d'); p.rect(12, 6, 3, 5, '#ff2a3d'); p.rect(6, 5, 3, 2, '#ffe14d'); p.rect(2, 8, 1, 1, '#222'); },
    'junk.whoopee': p => { p.ell(7, 9, 6, 4.5, '#ff6f8f'); p.rect(12, 7, 3, 3, '#ff6f8f'); p.ell(6, 7, 2, 1, '#ffb3c4'); },
    'junk.slap': p => { for (let k = 0; k < 14; k++) p.rect(1 + k, 6 + Math.round(Math.sin(k / 2) * 2), 1, 4, ['#00e5ff', '#ff2bd6', '#ffe14d'][k % 3]); },
    'junk.mood': p => { p.ell(8, 11, 4, 3.4, '#cfd4de'); p.ell(8, 11, 2.3, 1.8, null); p.ell(8, 5, 3, 3, '#7a3cc9'); p.ell(7, 4, 1, 1, '#d9b8ff'); },
    'junk.clanker': p => { p.ell(8, 4, 2, 2, '#cfd4de'); p.ell(8, 4, 1, 1, null); p.rect(4, 6, 8, 8, '#858c99'); p.rect(5, 8, 2, 2, '#ff2a2a'); p.rect(9, 8, 2, 2, '#ff2a2a'); p.rect(6, 12, 4, 1, '#2b2b2b'); },
    'junk.rat': p => { p.ell(8, 10, 6, 4, '#8a8f99'); p.ell(12.5, 7, 2, 2, '#8a8f99'); p.ell(4, 6, 1.5, 1.5, '#8a8f99'); p.set(12, 7, '#ff2a2a'); p.line(1, 12, 2, 10, '#c98aa0'); },
    'col.grandma': p => { p.ell(8, 3, 1.6, 1.6, '#cfd4de'); p.ell(8, 3, .7, .7, null); p.ell(8, 9, 5, 5, '#f2c39a'); p.ell(8, 6, 5.5, 3, '#e6e3ef'); p.rect(5, 9, 2, 1, '#2a1f2e'); p.rect(9, 9, 2, 1, '#2a1f2e'); p.rect(7, 12, 2, 1, '#c4001d'); },
    'col.brain': p => { p.ell(8, 8, 6.5, 5, '#ff9fc0'); p.line(8, 3, 8, 13, '#d9608a'); p.line(4, 6, 6, 8, '#d9608a'); p.line(11, 6, 12, 9, '#d9608a'); p.line(4, 10, 6, 11, '#d9608a'); },
    'col.babybob': p => { p.rect(5, 13, 6, 2, '#333'); p.rect(7, 10, 2, 3, '#4ecdc4'); p.ell(8, 6, 5, 4.6, '#f6c48f'); p.set(6, 6, '#111'); p.set(10, 6, '#111'); p.rect(7, 8, 2, 1, '#ff8fa8'); p.set(8, 1, '#5a3a2a'); },
    'col.karenbob': p => { p.rect(5, 13, 6, 2, '#333'); p.rect(7, 10, 2, 3, '#7fd1ff'); p.ell(8, 6, 4.6, 4.2, '#f2c39a'); p.ell(8, 4, 6, 3.4, '#ffe08a'); p.rect(3, 4, 2, 5, '#ffe08a'); p.set(6, 6, '#111'); p.set(10, 6, '#111'); p.rect(7, 8, 3, 1, '#d1002a'); },
    'col.chonx': p => { p.ell(8, 10, 6, 5, '#d9893b'); p.ell(8, 11, 3, 3, '#f6c98a'); p.ell(3.5, 3.5, 1.8, 1.8, '#d9893b'); p.ell(12.5, 3.5, 1.8, 1.8, '#d9893b'); p.ell(8, 6, 5, 4, '#d9893b'); p.set(6, 6, '#111'); p.set(10, 6, '#111'); p.set(8, 8, '#ff6f8f'); p.rect(3, 12, 10, 2, '#7a3cc9'); },
    'col.gerb': p => { p.ell(8, 10, 5.5, 5, '#a88a6a'); p.ell(8, 6, 4.5, 4, '#a88a6a'); p.ell(4.5, 2.8, 1.5, 1.5, '#a88a6a'); p.ell(11.5, 2.8, 1.5, 1.5, '#a88a6a'); p.rect(5, 4, 3, 1, '#4a3a2a'); p.rect(9, 4, 3, 1, '#4a3a2a'); p.set(6, 6, '#111'); p.set(10, 6, '#111'); p.set(8, 8, '#ff9fb0'); },
    'col.mittens': p => { p.ell(8, 10, 6, 5, '#f4f4f8'); p.ell(8, 6, 5, 4, '#f4f4f8'); p.rect(3, 2, 2, 3, '#f4f4f8'); p.rect(11, 2, 2, 3, '#f4f4f8'); p.set(6, 6, '#3a9a3a'); p.ell(10, 6, 1.6, 1.6, '#ffd23a'); p.set(10, 6, '#3a9a3a'); p.line(11, 7, 12, 11, '#ffd23a'); p.set(8, 8, '#ff9fb0'); },
    'top.giant': p => { p.ell(8, 10, 7, 6, '#d9893b'); p.ell(8, 11, 3.6, 3.6, '#f6c98a'); p.ell(3, 3, 2.2, 2.2, '#d9893b'); p.ell(13, 3, 2.2, 2.2, '#d9893b'); p.set(3, 3, '#ff9fb0'); p.set(13, 3, '#ff9fb0'); p.ell(8, 6, 5.5, 4.5, '#d9893b'); p.rect(5, 6, 2, 2, '#111'); p.rect(9, 6, 2, 2, '#111'); p.rect(7, 9, 2, 1, '#ff6f8f'); p.rect(2, 13, 12, 2, '#7a3cc9'); p.rect(7, 13, 2, 2, '#2ee6d6'); },
    'top.token': p => { p.ell(8, 8, 7, 7, '#ffcc00'); p.ell(8, 8, 5, 5, '#ffe680'); p.rect(7, 4, 2, 8, '#b38600'); p.rect(5, 5, 6, 1, '#b38600'); p.ell(5, 4, 1, 1, '#fff6c2'); },
  });
  // Yeet The Baby: a baby head wearing the item, or the item on its own
  const BSK = '#f6c48f';
  const babyHead = p => { p.ell(8, 10, 5, 4.6, BSK); p.set(10, 10, '#111'); p.set(12, 10, '#111'); p.set(12, 12, '#ff8fa8'); };
  Tickets.yeetHat = (p, key, ox, oy) => { // draws a hat whose brim sits at row oy, centred on ox (shared with the game)
    const R = (x, y, w, h, c) => p.rect(ox + x, oy + y, w, h, c), L = (a, b, c2, d, c) => p.line(ox + a, oy + b, ox + c2, oy + d, c), S = (x, y, c) => p.set(ox + x, oy + y, c);
    if (key === 'party') { for (let r = 0; r < 6; r++) R(-2 + Math.floor(r / 3), -r, 5 - Math.floor(r / 3) * 2, 1, r % 2 ? '#ffe14d' : '#ff2bd6'); R(0, -7, 1, 1, '#ffffff'); R(-1, -6, 3, 1, '#ffffff'); }
    else if (key === 'beanie') { R(-4, -1, 9, 2, '#e53935'); R(-3, -2, 7, 1, '#1e88e5'); R(-2, -3, 5, 1, '#fdd835'); R(0, -5, 1, 2, '#555'); R(-3, -5, 7, 1, '#43a047'); }
    else if (key === 'cap') { R(-3, -2, 7, 3, '#1e88e5'); R(-7, 0, 4, 1, '#1565c0'); S(0, -3, '#1565c0'); }
    else if (key === 'helmet') { R(-4, -2, 9, 3, '#00bcd4'); R(-3, -3, 7, 1, '#00bcd4'); R(-2, -3, 1, 2, '#006978'); R(1, -3, 1, 2, '#006978'); R(4, 0, 2, 1, '#006978'); }
    else if (key === 'chef') { R(-3, -1, 7, 2, '#ffffff'); R(-4, -5, 9, 4, '#ffffff'); R(-3, -6, 3, 1, '#ffffff'); R(1, -6, 3, 1, '#ffffff'); R(-3, -1, 7, 1, '#dcdcdc'); }
    else if (key === 'cowboy') { R(-6, 0, 13, 1, '#8d5524'); R(-3, -3, 7, 3, '#a0692f'); R(-3, -1, 7, 1, '#3e2723'); R(-1, -4, 3, 1, '#a0692f'); }
    else if (key === 'viking') { R(-4, -2, 9, 3, '#9aa3ad'); R(-3, -3, 7, 1, '#9aa3ad'); R(0, -3, 1, 4, '#d4af37'); L(-5, -1, -7, -5, '#fff3c4'); L(5, -1, 7, -5, '#fff3c4'); }
    else if (key === 'crown') { R(-3, -2, 7, 3, '#ffcc00'); S(-3, -3, '#ffcc00'); S(0, -4, '#ffcc00'); S(0, -3, '#ffcc00'); S(3, -3, '#ffcc00'); S(0, -1, '#e53935'); S(-2, -1, '#1e88e5'); S(2, -1, '#1e88e5'); }
  };
  ['party', 'beanie', 'cap', 'helmet', 'chef', 'cowboy', 'viking', 'crown'].forEach(k => ICON_ART['yeet.hat.' + k] = p => { babyHead(p); Tickets.yeetHat(p, k, 8, 6); });
  Object.assign(ICON_ART, {
    'yeet.face.shades': p => { babyHead(p); p.rect(4, 9, 10, 1, '#111'); p.rect(9, 9, 3, 2, '#111'); p.rect(12, 9, 2, 2, '#111'); },
    'yeet.face.stache': p => { babyHead(p); p.rect(9, 12, 5, 1, '#4e2a12'); p.set(8, 13, '#4e2a12'); p.set(14, 13, '#4e2a12'); },
    'yeet.face.goggles': p => { babyHead(p); p.rect(3, 9, 11, 1, '#6d4c41'); p.rect(9, 8, 2, 3, '#4dd0e1'); p.rect(12, 8, 2, 3, '#4dd0e1'); },
    'yeet.face.paci': p => { babyHead(p); p.rect(11, 12, 3, 2, '#ff8fc0'); p.ell(14.5, 13, 1.5, 1.5, '#ffcc00'); },
    'yeet.outfit.tutu': p => { for (let k = 0; k < 14; k++) p.rect(1 + k, 8 + (k % 2), 1, 4 - (k % 2), '#ff8fc0'); p.rect(3, 6, 10, 2, '#f6c48f'); },
    'yeet.outfit.floaties': p => { p.ell(5, 8, 3.5, 3, '#ff9800'); p.ell(5, 8, 1.4, 1.2, null); p.ell(11, 8, 3.5, 3, '#ff9800'); p.ell(11, 8, 1.4, 1.2, null); },
    'yeet.outfit.camo': p => { p.ell(8, 9, 6.5, 5, '#5d7a3a'); p.ell(5, 8, 2, 1.5, '#3e5226'); p.ell(10, 11, 2, 1.4, '#8a6a3a'); p.ell(11, 6, 1.5, 1, '#3e5226'); },
    'yeet.outfit.cape': p => { for (let r = 0; r < 12; r++) p.rect(6 - Math.floor(r / 3), 2 + r, 5 + Math.floor(r / 2), 1, '#e53935'); p.rect(6, 2, 5, 1, '#ffcc00'); },
    'yeet.outfit.gold': p => { p.ell(8, 9, 6.5, 5, '#ffcc00'); p.ell(6, 7, 2, 1, '#fff3a0'); p.rect(3, 6, 10, 1, '#d4a800'); },
    'yeet.trail.glitter': p => { [[2, 12, '#ff2bd6'], [5, 9, '#00e5ff'], [8, 11, '#ffe14d'], [10, 6, '#ffffff'], [13, 4, '#ff2bd6'], [12, 9, '#00e5ff'], [6, 4, '#ffe14d']].forEach(([x, y, c]) => { p.set(x, y, c); p.set(x - 1, y, c); p.set(x + 1, y, c); p.set(x, y - 1, c); p.set(x, y + 1, c); }); },
    'yeet.trail.tp': p => { for (let k = 0; k < 14; k++) p.rect(1 + k, 9 + Math.round(Math.sin(k / 2) * 3), 1, 3, '#ffffff'); p.ell(13, 4, 2.5, 2.5, '#ffffff'); p.ell(13, 4, 1, 1, '#cfcfcf'); },
    'yeet.trail.rainbow': p => { ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((c, i) => p.rect(1, 4 + i * 2, 14, 2, c)); },
    'yeet.trail.fire': p => { p.ell(8, 11, 6, 4, '#ff5722'); p.ell(8, 9, 4, 4, '#ff9800'); p.ell(8, 9, 2, 2.5, '#ffeb3b'); p.set(5, 4, '#ff9800'); p.set(11, 3, '#ff5722'); p.set(8, 2, '#ffeb3b'); },
  });
  window.NBTickets = Tickets;

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
.nbs-foc{outline:5px solid #fff;outline-offset:5px}
.nbs-more{font-size:18px;color:#7d72b8;text-align:center;line-height:2.4}
.nbt-wrap{display:flex;gap:44px;align-items:flex-start;justify-content:center;width:100%}
.nbt-mach{display:flex;flex-direction:column;align-items:center;width:250px}
.nbt-slot{width:230px;height:34px;background:#05010e;border:6px solid #3a2f78;border-radius:8px;box-shadow:inset 0 6px 10px #000}
.nbt-strip{width:150px;height:0;overflow:hidden;margin-top:-10px;position:relative;border-left:4px dotted #06010d;border-right:4px dotted #06010d;
  background:repeating-linear-gradient(180deg,#ff8a2b 0 54px,#06010d 54px 56px,#ff8a2b 56px 60px)}
.nbt-strip span{display:block;height:60px;line-height:56px;font-size:13px;color:#5a1f00;letter-spacing:1px;text-align:center}
.nbt-strip.gold{background:repeating-linear-gradient(180deg,#ffe14d 0 54px,#06010d 54px 56px,#ffe14d 56px 60px)}
.nbt-side{display:flex;flex-direction:column;gap:18px;min-width:520px;text-align:left}
.nbt-count{font-size:84px;color:#ffe14d;text-shadow:0 0 22px #ffb000;text-align:left}
.nbt-lines{display:flex;flex-direction:column;gap:12px;min-height:260px}
.nbt-l{display:flex;justify-content:space-between;gap:24px;font-size:22px;color:#d9d0ff;opacity:0;transform:translateX(-20px);transition:opacity .2s,transform .2s}
.nbt-l.on{opacity:1;transform:none}
.nbt-l b{color:#ffe14d;font-weight:normal}
.nbt-l.gold{color:#ffe14d;text-shadow:0 0 14px #ffb000;font-size:26px}
.nbt-bal{font-size:20px;color:#00e5ff}
.nbp-list{width:100%;max-height:520px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:18px;text-align:left;scrollbar-width:thin;scrollbar-color:var(--nbc) transparent}
.nbp-t{font-size:18px;color:#00e5ff;margin-bottom:10px}
.nbp-items{display:flex;flex-wrap:wrap;gap:12px}
.nbp-i{display:flex;flex-direction:column;align-items:center;gap:8px;width:170px;padding:12px 8px;background:#140a32;border:4px solid #3a2f78;color:#e6deff;cursor:pointer;font-size:11px;line-height:1.6;text-align:center}
.nbp-i canvas{width:64px;height:64px;image-rendering:pixelated;image-rendering:crisp-edges}
.nbp-i.on{border-color:#5fe0b7;background:#10302a}
.nbp-i b{font-weight:normal;font-size:10px;color:#5fe0b7}
#nbsP.portrait .nbp-list{max-height:820px}
#nbsP.portrait .nbt-wrap{flex-direction:column;align-items:center;gap:24px}
#nbsP.portrait .nbt-side{min-width:0;width:100%}
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
    root.addEventListener('pointerdown', e => setDev(e.pointerType === 'touch' ? 'touch' : 'key'), true);
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
    if (list) list.style.maxHeight = (portrait ? 700 : 360) + (panel.querySelector('.nbs-rk') ? 0 : (portrait ? 60 : 50)) + 'px';
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
  const Ctl = { prev: null, held: {}, rep: {}, ps: false };
  function firstPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads || []) if (p && p.connected) return p;
    return null;
  }
  function padState() {
    const gp = firstPad();
    if (!gp) return null;
    const id = gp.id || ''; // DualShock 4 reports just "Wireless Controller", but so does "Xbox Wireless Controller"
    Ctl.ps = /054c|dualsense|dualshock|playstation/i.test(id) || (/wireless controller/i.test(id) && !/xbox|045e/i.test(id));
    const b = i => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > 0.5); };
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    return { up: b(12) || ay < -0.5, down: b(13) || ay > 0.5, left: b(14) || ax < -0.5, right: b(15) || ax > 0.5, a: b(0), b: b(1), x: b(2), y: b(3), start: b(9), lb: b(4), rb: b(5) };
  }
  // which input the hints describe: the last one used, else a connected controller, else touch/keyboard
  function setDev(d) { if (NB._dev === d) return; NB._dev = d; const h = panel && panel.querySelector('.nbs-hint'); if (h) h.innerHTML = hintFor(NB._mode); }
  function dev() {
    if (NB._dev) return NB._dev;
    if (firstPad()) return 'pad';
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'key';
  }
  // button names: PlayStation names on a PS controller, Xbox letters on anything else
  const P = (ps, xb) => Ctl.ps ? ps : xb;
  function hintFor(mode) {
    const d = dev();
    if (mode === 'enter') {
      if (d === 'touch') return 'TAP &#9650; &#9660; TO PICK LETTERS, OR TAP A LETTER TO TYPE';
      if (d === 'pad') return '&#9650;&#9660; LETTER &middot; &#9664;&#9654; MOVE &middot; ' + P('CROSS', 'A') + ' NEXT &middot; ' + P('CIRCLE', 'B') + ' BACK &middot; ' + P('OPTIONS', 'START') + ' POST';
      return 'TYPE YOUR NAME &middot; ENTER = POST';
    }
    if (mode === 'board') {
      if (d === 'touch') return 'TAP A TAB OR BUTTON &middot; SWIPE THE LIST TO SCROLL';
      if (d === 'pad') return '&#9664;&#9654; PICK &middot; ' + P('CROSS', 'A') + ' PRESS &middot; &#9650;&#9660; SCROLL &middot; ' + P('L1 R1', 'LB RB') + ' TABS<br>' +
        P('TRIANGLE', 'Y') + ' ALL SCORES &middot; ' + P('CIRCLE', 'B') + ' BACK &middot; ' + P('OPTIONS', 'START') + ' CONTINUE';
      return '&#9664;&#9654; PICK &middot; ENTER PRESS &middot; &#9650;&#9660; SCROLL<br>TAB ALL SCORES &middot; ESC BACK';
    }
    return '';
  }
  function pollPad() {
    const s = padState();
    if (!s) { Ctl.prev = null; return; }
    const p = Ctl.prev || s; // first poll after opening: anything already held doesn't count
    const now = performance.now();
    for (const k in s) {
      if (s[k] && !p[k]) { Ctl.rep[k] = now + 380; setDev('pad'); NB._act(k); }
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
    if ((NB._mode === 'board' || NB._mode === 'prizes') && (k === 'Enter' || k === 'NumpadEnter')) act = 'a'; // Enter presses the highlighted button
    setDev('key');
    e.preventDefault(); e.stopImmediatePropagation();
    if (act && !e.repeat || (act && /^(up|down|left|right|bs)$/.test(act))) NB._act(act);
  }, true);

  // a focused game button behind the overlay must not fire on Space/Enter release
  window.addEventListener('keyup', e => {
    if (NB.active && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && !(e.target && root && root.contains(e.target))) e.preventDefault();
  }, true);

  // ---------------------------------------------------------------- the overlay
  const NB = {
    active: false, _mode: null, _dev: null, _cache: {},
    GAMES, ARCADE_URL, weekKey, weekLabel, blocked, clean, post, top, page, rank, tickets: Tickets,
    exitToArcade() { location.href = ARCADE_URL; },

    // After every run: name entry -> post -> board. onClose fires when the player continues.
    submit(opt) {
      const game = opt.game, score = Math.max(0, Math.floor(+opt.score || 0));
      ensureDom(); open(game);
      let last = ''; try { last = clean(localStorage.getItem(NAME_KEY)); } catch (e) { }
      const chars = (last || '').padEnd(NAME_LEN, ' ').split('');
      // last name used on this device is pre-filled; typing a new letter first replaces it
      const st = { game, score, chars, cur: 0, onClose: opt.onClose, err: '', fresh: !!last, tk: opt.tickets !== false, feats: opt.feats || [] };
      NB._st = st; NB._mode = 'enter';
      renderEnter();
    },

    // A game's PRIZES menu: what you own for this game, by slot. Cross equips; again removes.
    prizes(opt) {
      ensureDom(); open(opt.game);
      NB._st = { game: opt.game, onClose: opt.onClose, foc: 0, prizes: true };
      NB._mode = 'prizes';
      renderPrizes();
    },

    // View-only boards (used by the arcade page). onClose optional.
    showBoard(opt) {
      ensureDom(); open(opt.game);
      NB._st = { game: opt.game, score: null, myId: null, onClose: opt.onClose, scope: opt.scope || 'week', ranks: null };
      NB._mode = 'board';
      renderBoard();
    },

    _act(a) {
      const st = NB._st; if (!st) return;
      if (NB._mode === 'enter') return actEnter(a);
      if (NB._mode === 'board') return actBoard(a);
      if (NB._mode === 'error') return actError(a);
      if (NB._mode === 'tickets') return actTickets(a);
      if (NB._mode === 'prizes') return actPrizes(a);
    },
  };
  window.NBScores = NB;

  function open(game) {
    const g = GAMES[game] || { color: '#ff4bd8' };
    root.style.setProperty('--nbc', g.color);
    root.classList.add('on'); NB.active = true; NB._cache = {};
    Ctl.prev = padState();
    const unfocus = () => { const a = document.activeElement; if (NB.active && a && a !== document.body && !root.contains(a) && a.blur) a.blur(); };
    unfocus(); setTimeout(unfocus, 60); setTimeout(unfocus, 200);
    if (!raf) raf = requestAnimationFrame(loop);
    fit();
  }
  function close() {
    const s0 = NB._st;
    if (s0 && s0.tk && !s0.tkShown && s0.score != null) { s0.tkShown = true; return showTickets(); }
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
      '<div class="nbs-hint">' + hintFor('enter') + '</div>';
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
      st.myId = id; st.scope = 'week'; st.view = 'top'; NB._cache = {};
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
  // Both tabs show the top 100. ALL SCORES lists every all-time score, 100 more each time the list nears the bottom.
  // Lists are kept for as long as the overlay is open, so flipping tabs doesn't re-read them.
  // Controls in highlight order: THIS WEEK, ALL-TIME, ALL SCORES / TOP 100, CONTINUE.
  function renderBoard() {
    const st = NB._st, g = GAMES[st.game];
    st.view = st.view || 'top'; if (st.foc == null) st.foc = 3;
    const posted = st.score != null, every = st.view === 'every';
    let rk = '';
    if (posted && st.ranks) rk = 'YOU PLACED ' + (st.ranks.week ? '#' + st.ranks.week : '?') + ' THIS WEEK &middot; ' + (st.ranks.all ? '#' + st.ranks.all : '?') + ' ALL-TIME';
    const sub = st.scope === 'week' ? weekLabel(weekKey()) + ' &middot; TOP 100 &middot; RESETS MONDAY'
      : every ? 'EVERY SCORE &middot; SINCE THE DOORS OPENED' : 'TOP 100 &middot; SINCE THE DOORS OPENED';
    panel.innerHTML =
      '<div class="nbs-k">' + esc(g.title) + '</div>' +
      '<div class="nbs-h">HIGH SCORES</div>' +
      (rk ? '<div class="nbs-m nbs-rk">' + rk + '</div>' : '') +
      '<div class="nbs-tabs"><button class="nbs-tab nbs-c' + (st.scope === 'week' ? ' on' : '') + '" data-t="week">THIS WEEK</button><button class="nbs-tab nbs-c' + (st.scope === 'all' ? ' on' : '') + '" data-t="all">ALL-TIME</button></div>' +
      '<div class="nbs-m" style="font-size:16px;color:#7d72b8">' + sub + '</div>' +
      '<div class="nbs-list"><div class="nbs-m">LOADING...</div></div>' +
      '<div class="nbs-row"><button class="nbs-b alt nbs-c" data-x="1">' + (every ? 'TOP 100' : 'ALL SCORES') + '</button><button class="nbs-b nbs-c" data-c="1">CONTINUE</button></div>' +
      '<div class="nbs-hint">' + hintFor('board') + '</div>';
    panel.querySelectorAll('[data-t]').forEach((b, i) => b.onclick = () => { st.foc = i; pickTab(b.dataset.t); });
    panel.querySelector('[data-x]').onclick = () => { st.foc = 2; toggleEvery(); };
    panel.querySelector('[data-c]').onclick = close;
    const list = panel.querySelector('.nbs-list');
    list.addEventListener('scroll', maybeMore, { passive: true });
    paintFoc(); fit();
    loadList();
  }
  function paintFoc() {
    const st = NB._st;
    panel.querySelectorAll('.nbs-c').forEach((el, i) => { el.classList.toggle('nbs-foc', i === st.foc); if (el.classList.contains('nbs-b')) el.classList.toggle('sel', i === st.foc); });
  }
  function pickTab(scope) { const st = NB._st; st.scope = scope; st.view = 'top'; blip(520, 0.04); renderBoard(); }
  function toggleEvery() {
    const st = NB._st; blip(620, 0.05);
    if (st.view === 'every') st.view = 'top'; else { st.view = 'every'; st.scope = 'all'; }
    renderBoard();
  }
  function rowHtml(r, i) {
    const st = NB._st;
    return '<div class="nbs-li' + (r.id === st.myId ? ' me' : i < 3 ? ' r' + (i + 1) : '') + '"><span>' + (i + 1) + '.</span><span>' + esc(r.name) + '</span><span>' + fmt(r.score) + '</span></div>';
  }
  function current() { const st = NB._st; return st.view === 'every' ? 'every' : st.scope; }
  function loadList() {
    const st = NB._st, key = current(), C = NB._cache;
    if (key === 'every') {
      const E = C.every = C.every || { rows: [], done: false, loading: false, err: false };
      if (E.rows.length || E.done) return drawList(true);
      return more();
    }
    if (C[key]) return drawList(true);
    top(st.game, key, 100).then(rows => {
      C[key] = rows;
      if (NB._st === st && NB._mode === 'board' && current() === key) drawList(true);
    }).catch(() => {
      if (NB._st !== st || NB._mode !== 'board' || current() !== key) return;
      panel.querySelector('.nbs-list').innerHTML = '<div class="nbs-m">COULDN\'T LOAD SCORES.</div>';
    });
  }
  function drawList(first) {
    const st = NB._st, key = current(), list = panel.querySelector('.nbs-list'); if (!list) return;
    const every = key === 'every', E = NB._cache.every;
    const rows = every ? E.rows : NB._cache[key] || [];
    if (!rows.length && (!every || E.done)) { list.innerHTML = '<div class="nbs-m">NO SCORES YET. BE THE FIRST.</div>'; return; }
    const keep = list.scrollTop;
    let foot = '';
    if (every) foot = '<div class="nbs-more">' + (E.loading ? 'LOADING MORE...' : E.err ? 'COULDN\'T LOAD MORE &middot; SCROLL TO RETRY' : E.done ? 'END OF LIST &middot; ' + fmt(rows.length) + ' SCORES' : '&#9660; MORE BELOW') + '</div>';
    list.innerHTML = rows.map(rowHtml).join('') + foot;
    if (first) { list.scrollTop = 0; const me = list.querySelector('.me'); if (me) me.scrollIntoView({ block: 'nearest' }); }
    else list.scrollTop = keep;
  }
  function more() {
    const st = NB._st, E = NB._cache.every;
    if (!E || E.loading || E.done) return;
    E.loading = true; E.err = false;
    if (E.rows.length) drawList(false); else panel.querySelector('.nbs-list').innerHTML = '<div class="nbs-m">LOADING...</div>';
    page(st.game, E.rows[E.rows.length - 1]).then(rows => {
      if (NB._cache.every !== E) return;
      E.loading = false; E.rows = E.rows.concat(rows); if (rows.length < PAGE) E.done = true;
      if (NB._st === st && NB._mode === 'board' && current() === 'every') { drawList(E.rows.length === rows.length); maybeMore(); }
    }).catch(() => {
      if (NB._cache.every !== E) return;
      E.loading = false; E.err = true;
      if (NB._st !== st || NB._mode !== 'board' || current() !== 'every') return;
      if (E.rows.length) drawList(false); else panel.querySelector('.nbs-list').innerHTML = '<div class="nbs-m">COULDN\'T LOAD SCORES.</div>';
    });
  }
  // load the next 100 once the list is scrolled near its bottom (or is too short to scroll)
  function maybeMore() {
    if (!NB._st || NB._mode !== 'board' || current() !== 'every') return;
    const l = panel.querySelector('.nbs-list'); if (!l) return;
    if (l.scrollTop + l.clientHeight >= l.scrollHeight - 260) more();
  }
  function actBoard(a) {
    const st = NB._st;
    if (a === 'left' || a === 'right') { st.foc = (st.foc + (a === 'right' ? 1 : 3)) % 4; blip(520, 0.04); return paintFoc(); }
    if (a === 'lb' || a === 'rb') return pickTab(st.scope === 'week' ? 'all' : 'week');
    if (a === 'up' || a === 'down') { const l = panel.querySelector('.nbs-list'); if (l) { l.scrollTop += a === 'down' ? 120 : -120; maybeMore(); } return; }
    if (a === 'tab' || a === 'y' || a === 'x') return toggleEvery();
    if (a === 'a') { const c = panel.querySelectorAll('.nbs-c')[st.foc]; if (c) c.click(); return; }
    if (a === 'b') { if (st.view === 'every') return toggleEvery(); return close(); }
    if (a === 'start') return close();
  }

  // ---- PRIZES (equip) menu
  function prizeRows(game) {
    const w = Tickets.wallet(), slots = (Tickets.slots[game] || {}), rows = [];
    Object.keys(slots).forEach(sl => {
      const items = Tickets.catalog.filter(i => i.game === game && i.slot === sl && w.owned[i.id]);
      if (items.length) rows.push({ slot: sl, title: slots[sl], items });
    });
    return rows;
  }
  function renderPrizes() {
    const st = NB._st, g = GAMES[st.game] || { title: '' }, rows = prizeRows(st.game), eq = Tickets.equipped(st.game);
    st.flat = []; rows.forEach(r => r.items.forEach(i => st.flat.push(i)));
    if (st.foc > st.flat.length) st.foc = st.flat.length;
    let n = 0;
    const body = rows.length ? rows.map(r => '<div class="nbp-row"><div class="nbp-t">' + r.title + '</div><div class="nbp-items">' +
      r.items.map(i => '<button class="nbp-i nbp-c' + (eq[r.slot] === i.id ? ' on' : '') + '" data-k="' + (n++) + '"><canvas width="16" height="16" data-icon="' + i.id + '"></canvas><span>' + esc(i.name) + '</span>' + (eq[r.slot] === i.id ? '<b>EQUIPPED</b>' : '') + '</button>').join('') +
      '</div></div>').join('')
      : '<div class="nbs-m">NOTHING HERE YET.<br>TRADE YOUR TICKETS FOR ' + esc(g.title) + ' PRIZES<br>AT THE PRIZE COUNTER IN THE ARCADE.</div>';
    panel.innerHTML = '<div class="nbs-k">' + esc(g.title) + '</div><div class="nbs-h">PRIZES</div>' +
      '<div class="nbp-list">' + body + '</div>' +
      '<div class="nbs-row"><button class="nbs-b nbp-c" data-k="' + st.flat.length + '">DONE</button></div>' +
      '<div class="nbs-hint">' + (dev() === 'pad' ? '&#9664;&#9650;&#9660;&#9654; PICK &middot; ' + P('CROSS', 'A') + ' EQUIP / REMOVE &middot; ' + P('CIRCLE', 'B') + ' DONE' : dev() === 'touch' ? 'TAP A PRIZE TO EQUIP OR REMOVE IT' : 'ARROWS PICK &middot; ENTER EQUIP / REMOVE &middot; ESC DONE') + '</div>';
    panel.querySelectorAll('canvas[data-icon]').forEach(c => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(Tickets.icon(c.dataset.icon), 0, 0); });
    panel.querySelectorAll('.nbp-c').forEach(b => b.onclick = () => { st.foc = +b.dataset.k; prizePress(); });
    paintPrizes(); fit();
  }
  function paintPrizes() {
    const st = NB._st;
    panel.querySelectorAll('.nbp-c').forEach(b => { const on = +b.dataset.k === st.foc; b.classList.toggle('nbs-foc', on); if (b.classList.contains('nbs-b')) b.classList.toggle('sel', on); if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); });
  }
  function prizePress() {
    const st = NB._st;
    if (st.foc >= st.flat.length) return close();
    const it = st.flat[st.foc], cur = Tickets.equipped(st.game, it.slot);
    Tickets.setEquip(st.game, it.slot, cur === it.id ? null : it.id);
    blip(cur === it.id ? 420 : 880, 0.07);
    renderPrizes();
  }
  function actPrizes(a) {
    const st = NB._st, n = st.flat.length + 1;
    if (a === 'left' || a === 'up') { st.foc = (st.foc + n - 1) % n; blip(520, 0.04); return paintPrizes(); }
    if (a === 'right' || a === 'down') { st.foc = (st.foc + 1) % n; blip(520, 0.04); return paintPrizes(); }
    if (a === 'a') return prizePress();
    if (a === 'b' || a === 'start') return close();
  }

  // ---- ticket payout: a strip pours out of the slot while the counter ticks up
  function tkSound(kind) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      if (kind === 'tick') { // printer: a short burst of filtered noise
        const len = Math.floor(actx.sampleRate * 0.035), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
        f.type = 'bandpass'; f.frequency.value = 2400; g.gain.value = 0.09; src.buffer = buf;
        src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
      } else {
        const seq = kind === 'gold' ? [784, 988, 1175, 1568, 1976] : kind === 'done' ? [880, 1319] : [1047];
        seq.forEach((fr, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = fr; g.gain.setValueAtTime(0.05, t + i * 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.14); o.connect(g); g.connect(actx.destination); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.16); });
      }
    } catch (e) { }
  }
  function showTickets() {
    const st = NB._st;
    let q;
    try { q = Tickets.quote(st.game, st.score, st.ranks, st.feats); } catch (e) { st.tk = false; return close(); }
    const before = Tickets.balance();
    Tickets.payRun(st.game, st.score, q);
    const gold = q.lines.some(l => l.gold);
    st.tq = { q, before, shown: 0, line: 0, t0: performance.now(), done: false };
    NB._mode = 'tickets';
    panel.innerHTML =
      '<div class="nbs-k">' + esc((GAMES[st.game] || {}).title || '') + '</div>' +
      '<div class="nbs-h">TICKETS!</div>' +
      '<div class="nbt-wrap"><div class="nbt-mach"><div class="nbt-slot"></div><div class="nbt-strip' + (gold ? ' gold' : '') + '"></div></div>' +
      '<div class="nbt-side"><div class="nbt-count">0</div><div class="nbt-lines">' +
      q.lines.map(l => '<div class="nbt-l' + (l.gold ? ' gold' : '') + '"><span>' + esc(l.t) + '</span><b>+' + fmt(l.n) + '</b></div>').join('') +
      '</div><div class="nbt-bal">TICKETS ON THIS DEVICE: ' + fmt(before) + '</div></div></div>' +
      '<div class="nbs-row"><button class="nbs-b sel" data-c="1">SKIP</button></div>' +
      '<div class="nbs-hint">' + tkHint() + '</div>';
    const strip = panel.querySelector('.nbt-strip');
    strip.innerHTML = Array.from({ length: 40 }, () => '<span>NEON BREAD</span>').join('');
    panel.querySelector('[data-c]').onclick = () => actTickets('a');
    fit(); tkSound('start');
    requestAnimationFrame(tkStep);
  }
  function tkHint() { const d = dev(); return d === 'pad' ? P('CROSS', 'A') + ' SKIP / CONTINUE' : d === 'touch' ? 'TAP TO SKIP / CONTINUE' : 'ENTER SKIP / CONTINUE'; }
  // lines appear one after another; the counter runs up to the running total of the lines shown so far
  function tkStep(now) {
    const st = NB._st; if (!st || NB._mode !== 'tickets' || !st.tq || st.tq.done) return;
    const tq = st.tq, lines = tq.q.lines, el = panel.querySelectorAll('.nbt-l');
    const per = 650, k = Math.max(0, (now - tq.t0) / per);  // a frame's timestamp can be a hair before t0
    const li = Math.min(lines.length, Math.floor(k) + 1);
    for (let i = 0; i < li; i++) if (!el[i].classList.contains('on')) { el[i].classList.add('on'); if (lines[i].gold) tkSound('gold'); }
    let target = 0; for (let i = 0; i < li; i++) target += lines[i].n;
    const prevTarget = target - lines[li - 1].n, frac = Math.min(1, (k - (li - 1)) * 1.6);
    const val = Math.round(prevTarget + (target - prevTarget) * frac);
    if (val !== tq.shown) { if (now - (tq.tick || 0) > 45) { tq.tick = now; tkSound('tick'); } tq.shown = val; tkPaint(val); }
    if (li === lines.length && frac >= 1) return tkFinish();
    requestAnimationFrame(tkStep);
  }
  function tkPaint(val) {
    const st = NB._st, c = panel.querySelector('.nbt-count'), strip = panel.querySelector('.nbt-strip');
    if (c) c.textContent = fmt(val);
    if (strip) strip.style.height = Math.min(480, 12 + val * 6) + 'px';
  }
  function tkFinish() {
    const st = NB._st, tq = st.tq; tq.done = true;
    panel.querySelectorAll('.nbt-l').forEach(e => e.classList.add('on'));
    tkPaint(tq.q.total);
    const bal = panel.querySelector('.nbt-bal'); if (bal) bal.textContent = 'TICKETS ON THIS DEVICE: ' + fmt(tq.before + tq.q.total);
    const b = panel.querySelector('[data-c]'); if (b) b.textContent = 'CONTINUE';
    tkSound('done');
  }
  function actTickets(a) {
    const st = NB._st; if (!st || !st.tq) return;
    if (!(a === 'a' || a === 'start' || a === 'b')) return;
    if (!st.tq.done) return tkFinish();
    close();
  }
})();
/* NB-SCORES END */
