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
    fiveo: { title: 'CHONX FIVE O', color: '#2b6bff' },
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
  function post(game, name, score, cheat) {
    const id = newId(), fields = { game: sv(game), name: sv(name), score: { integerValue: String(score) }, week: sv(weekKey()) };
    if (cheat) fields.cheat = { booleanValue: true };
    return req(':commit', {
      writes: [{
        update: {
          name: 'projects/' + PROJECT + '/databases/(default)/documents/scores/' + id,
          fields,
        },
        updateTransforms: [{ fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      }],
    }).then(() => id);
  }
  function rowsOf(res) {
    return res.filter(r => r.document).map(r => {
      const f = r.document.fields || {};
      return { id: r.document.name.split('/').pop(), ref: r.document.name, name: (f.name && f.name.stringValue) || '???', score: +((f.score && f.score.integerValue) || 0), cheat: !!(f.cheat && f.cheat.booleanValue) };
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
  const TK_RATE = { chonx: 1000, cheekyops: 2000, yeet: 600, gta: 1500, karen: 400, pedxing: 1500, fiveo: 1000 };
  const TK = { min: 5, max: 150, best: 25, top10: 50, firstToday: 10, golden: 500, goldenOdds: 1 / 40 };
  function pacificDay(d) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function tkBlank() { return { v: 1, bal: 0, earned: 0, spent: 0, best: {}, day: {}, owned: {}, equip: {}, cheats: {}, chal: {}, golden: 0, runs: 0 }; }
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
    buy(id, price) { const w = tkLoad(), it = Tickets.item(id); if (w.owned[id] || w.bal < price || (it && !Tickets.inSeason(it))) return false; w.bal -= price; w.spent += price; w.owned[id] = Date.now(); tkSave(w); return true; },
    equipped(game, slot) { const e = tkLoad().equip[game] || {}; return slot ? e[slot] || null : e; },
    setEquip(game, slot, id) { const w = tkLoad(); w.equip[game] = w.equip[game] || {}; if (id) w.equip[game][slot] = id; else delete w.equip[game][slot]; tkSave(w); },
    // ---- cheat cards: codes live in w.owned like any prize; w.cheats[id] = switched on
    cheatsFor(game) { return Tickets.catalog.filter(i => i.cheat && i.game === game); },
    envelopeLeft(game) { const w = tkLoad(); return Tickets.cheatsFor(game).filter(i => !i.perk && !w.owned[i.id]).length; },
    // buy an envelope: takes the tickets and reveals one code you don't have yet, at random
    openEnvelope(game) {
      const w = tkLoad(), env = Tickets.item('env.' + game), left = Tickets.cheatsFor(game).filter(i => !i.perk && !w.owned[i.id]);
      if (!env || !left.length || w.bal < env.price) return null;
      const got = left[Math.floor(Math.random() * left.length)];
      w.bal -= env.price; w.spent += env.price; w.owned[got.id] = Date.now(); tkSave(w); return got;
    },
    cheatOn(game, key) {
      const id = 'cheat.' + game + '.' + key, w = tkLoad();
      if (w.owned[id] && w.cheats && w.cheats[id]) return true;
      const it = Tickets.item(id); return !!(it && it.freeDay && it.freeDay === pacificDay());   // free for everyone that day
    },
    setCheat(id, on) {
      const w = tkLoad(), it = Tickets.item(id); w.cheats = w.cheats || {};
      if (on && it && it.group) Tickets.catalog.forEach(o => { if (o.group === it.group && o.id !== id) delete w.cheats[o.id]; });   // one of a group at a time (Five O starting guns)
      if (on) w.cheats[id] = 1; else delete w.cheats[id]; tkSave(w);
    },
    // a run with any gameplay (T) code switched on is tagged on the leaderboard
    tagged(game) { return Tickets.cheatsFor(game).some(i => i.tag && Tickets.cheatOn(game, i.id.split('.')[2])); },
    // work out what a finished run pays (doesn't save). A tagged run can't set a personal best.
    quote(game, score, ranks, feats, tagged, stats) {
      const w = tkLoad(), lines = [];
      const base = Math.max(TK.min, Math.min(TK.max, Math.round(score / (TK_RATE[game] || 1000))));
      lines.push({ t: 'RUN PAYOUT', n: base });
      if (!tagged && score > 0 && score > (w.best[game] || 0)) lines.push({ t: 'NEW PERSONAL BEST', n: TK.best });
      if (ranks && ranks.week && ranks.week <= 10) lines.push({ t: 'WEEKLY TOP 10', n: TK.top10 });
      if (w.day[game] !== pacificDay()) lines.push({ t: 'FIRST RUN TODAY', n: TK.firstToday });
      (feats || []).forEach(f => { if (f && f.n > 0) lines.push({ t: String(f.t), n: Math.floor(f.n) }); });
      const ch = Tickets.challenge(game);
      if (ch && !ch.done && !tagged) { let ok = false; try { ok = !!ch.ok(Object.assign({ score }, stats || {})); } catch (e) { } if (ok) lines.push({ t: 'DAILY CHALLENGE: ' + ch.t, n: ch.n, chal: true }); }
      if (Math.random() < TK.goldenOdds) lines.push({ t: 'GOLDEN TICKET!', n: TK.golden, gold: true });
      return { lines, total: lines.reduce((a, l) => a + l.n, 0) };
    },
    // pay it out: one save, so closing the page during the animation loses nothing
    payRun(game, score, q, tagged) {
      const w = tkLoad();
      w.bal += q.total; w.earned += q.total; w.runs++;
      if (!tagged) w.best[game] = Math.max(w.best[game] || 0, score); w.day[game] = pacificDay();
      if (q.lines.some(l => l.gold)) w.golden++;
      if (q.lines.some(l => l.chal)) w.chal[game] = pacificDay();
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
    { id: 'col.badge', shelf: 'collect', name: 'CHONX BADGE PIN', price: 450 },
    { id: 'col.mangebob', shelf: 'collect', name: 'MANGE BOBBLEHEAD', price: 700 },
    { id: 'top.giant', shelf: 'top', name: 'GIANT CHONX PLUSH', price: 10000 },
    { id: 'top.token', shelf: 'top', name: 'GOLD ARCADE TOKEN', price: 25000 },
  ];
  // game cosmetics: shelf = game id, slot = where it goes (one item per slot)
  const add = (game, slot, list) => list.forEach(([key, name, price]) => Tickets.catalog.push({ id: game + '.' + slot + '.' + key, shelf: game, game, slot, name, price }));
  add('yeet', 'hat', [['party', 'PARTY HAT', 150], ['beanie', 'PROPELLER BEANIE', 200], ['cap', 'BACKWARDS CAP', 200], ['helmet', 'BIKE HELMET', 250], ['chef', 'CHEF HAT', 300], ['cowboy', 'COWBOY HAT', 300], ['viking', 'VIKING HELMET', 600], ['crown', 'CROWN', 1000]]);
  add('yeet', 'face', [['shades', 'SUNGLASSES', 250], ['stache', 'FAKE MUSTACHE', 300], ['goggles', 'AVIATOR GOGGLES', 400], ['paci', 'BLING PACIFIER', 500]]);
  add('yeet', 'outfit', [['tutu', 'TUTU', 300], ['floaties', 'FLOATIES', 350], ['camo', 'CAMO DIAPER', 400], ['cape', 'SUPERHERO CAPE', 700], ['gold', 'GOLD DIAPER', 1500]]);
  add('yeet', 'trail', [['glitter', 'GLITTER TRAIL', 500], ['tp', 'TOILET-PAPER STREAMER', 600], ['rainbow', 'RAINBOW TRAIL', 800], ['fire', 'FIRE TRAIL', 1200]]);
  add('gta', 'hat', [['curlers', 'CURLERS', 200], ['visor', 'SUN VISOR', 200], ['helmet', 'BIKE HELMET', 250], ['church', 'FLOWERED CHURCH HAT', 300], ['tiara', 'TIARA', 800]]);
  add('gta', 'eyes', [['cateye', 'CAT-EYE GLASSES', 250]]);
  add('gta', 'feet', [['slippers', 'FUZZY SLIPPERS', 200]]);
  add('gta', 'neck', [['pearls', 'PEARLS', 300]]);
  add('gta', 'bag', [['handbag', 'GIANT HANDBAG', 350]]);
  add('gta', 'walker', [['tennis', 'TENNIS-BALL WALKER', 400], ['flame', 'FLAME-DECAL WALKER', 700]]);
  add('gta', 'body', [['leopard', 'LEOPARD CARDIGAN', 500]]);
  add('gta', 'livery', [['wood', 'WOOD-PANEL VAN', 500], ['bingo', '"BINGO EXPRESS" CHURCH BUS', 600], ['icecream', 'ICE CREAM TRUCK', 700], ['flames', 'FLAMES VAN', 800]]);
  add('gta', 'horn', [['goose', 'GOOSE-HONK HORN', 300], ['bell', 'CHURCH-BELL HORN', 400]]);
  // Karen: each special throwable takes one regular item's place, with that item's damage
  [['cone', 'TRAFFIC CONE', 400, 'bottle'], ['dentures', "GRANDMA'S DENTURES", 400, 'pencil'], ['clanker', 'CLANKER HEAD', 500, 'laptop'],
   ['casserole', "GRANDMA'S CASSEROLE DISH", 600, 'pan'], ['review', '"ONE-STAR REVIEW" NEWSPAPER', 600, 'book'], ['rat', '6-7 RAT', 700, 'shoe'],
   ['plush', 'CHONX PLUSH', 800, 'pizza'], ['brain', "BRAYN'S BRAIN", 900, 'sandwich'], ['monocle', "CHAIRMAN MITTENS' MONOCLE", 1000, 'phone'], ['baby', 'THE BABY', 1500, 'bat']]
    .forEach(([key, name, price, rep]) => Tickets.catalog.push({ id: 'karen.' + key + '.' + key, shelf: 'karen', game: 'karen', slot: key, name, price, replaces: rep, note: 'TAKES THE ' + rep.toUpperCase() + "'S PLACE" }));
  add('karen', 'band', [['rainbow', 'RAINBOW BAND', 400]]);
  add('karen', 'pouch', [['paw', 'HAMSTER-PAW POUCH', 500]]);
  add('karen', 'frame', [['gold', 'GOLD SLINGSHOT', 1000]]);
  add('chonx', 'skin', [['pajama', 'PAJAMA CHONX', 600], ['green', 'HANDHELD-GREEN CHONX', 700], ['retro', 'RETRO 2025 CHONX', 800], ['ghost', 'GHOST CHONX', 900], ['tactical', 'TACTICAL CHONX', 1000], ['golden', 'GOLDEN CHONX', 3000]]);
  add('chonx', 'shots', [['rainbow', 'RAINBOW PELLETS', 300]]);
  add('cheekyops', 'reticle', [['paw', 'HAMSTER-PAW RETICLE', 300], ['heart', 'HEART RETICLE', 300], ['skull', 'SKULL RETICLE', 400], ['sixseven', '"6 7" RETICLE', 400], ['gold', 'GOLD RETICLE', 800]]);
  add('cheekyops', 'rifle', [['camo', 'CAMO RIFLE', 400], ['wood', 'WOOD-STOCK RIFLE', 500], ['neon', 'NEON RIFLE', 600], ['gold', 'GOLD RIFLE', 2500]]);
  add('cheekyops', 'outfit', [['tux', 'SPY TUXEDO', 1200]]);
  add('fiveo', 'outfit', [['trench', 'DETECTIVE TRENCH COAT', 800], ['riot', 'RIOT HELMET', 900], ['swat', 'SWAT GEAR', 1000], ['moto', 'MOTORCYCLE COP', 1000], ['miami', 'MIAMI PASTEL SUIT', 1200]]);
  add('fiveo', 'gun', [['wood', 'WOOD-GRIP PISTOL', 300], ['chrome', 'CHROME PISTOL', 400], ['neon', 'NEON PISTOL', 600], ['gold', 'GOLD PISTOL', 1500]]);
  add('fiveo', 'reticle', [['badge', 'BADGE CROSSHAIR', 300], ['donut', 'DONUT CROSSHAIR', 300], ['star', 'STAR CROSSHAIR', 300], ['skull', 'SKULL CROSSHAIR', 400]]);
  add('fiveo', 'flash', [['blue', 'BLUE MUZZLE FLASH', 250], ['green', 'GREEN MUZZLE FLASH', 250], ['pink', 'PINK MUZZLE FLASH', 250], ['rainbow', 'RAINBOW MUZZLE FLASH', 600]]);
  add('pedxing', 'livery', [['student', 'STUDENT DRIVER', 300], ['stripes', 'RACING STRIPES', 400], ['camo', 'CAMO', 400], ['checker', 'CHECKERBOARD', 500], ['wood', 'WOOD PANEL', 500], ['pizza', 'PIZZA DELIVERY', 500], ['flames', 'FLAMES', 600], ['neonbread', 'NEON BREAD DELIVERY', 700], ['chrome', 'CHROME', 2000], ['gold', 'GOLD', 5000]]);
  add('pedxing', 'horn', [['duck', 'DUCK-QUACK HORN', 250], ['clown', 'CLOWN HONK', 300], ['goose', 'GOOSE HORN', 300], ['train', 'TRAIN HORN', 600]]);
  add('pedxing', 'dash', [['dice', 'FUZZY DICE', 150], ['bobble', 'CHONX DASHBOARD BOBBLE', 300]]);
  // cheat cards: one envelope per game, 3 codes in each. C = cosmetic, T = gameplay (tags the run)
  const KAREN_REPLACES = { cone: 'bottle', dentures: 'pencil', clanker: 'laptop', casserole: 'pan', review: 'book', rat: 'shoe', plush: 'pizza', brain: 'sandwich', monocle: 'phone', baby: 'bat' };
  const CHEATS = {
    yeet: [['chonx', 'CHONX BABY', 'C'], ['bighead', 'BIG HEAD BABY', 'C'], ['moon', 'MOON GRAVITY', 'T']],
    pedxing: [['chonx', 'CHONX CROSSING', 'C'], ['clown', 'CLOWN CAR', 'C'], ['turbohorn', 'TURBO HORN', 'T']],
    karen: [['bighead', 'BIG HEAD KAREN', 'T'], ['brayn', 'KAREN BECOMES BRAYN', 'C'], ['manager', 'CHONX IS THE MANAGER', 'C']],
    chonx: [['bighead', 'BIG HEAD MODE', 'C'], ['paintball', 'PAINTBALL MODE', 'C'], ['jetpack', 'INFINITE JETPACK', 'T']],
    cheekyops: [['hats', 'PARTY HATS', 'C'], ['confetti', 'CONFETTI INSTEAD OF GORE', 'C'], ['nosway', 'NO SWAY', 'T']],
    gta: [['hamster', 'HAMSTER GRANNIES', 'C'], ['monster', 'MONSTER VAN', 'C'], ['turbo', 'TURBO VAN', 'T']],
    fiveo: [['bighead', 'BIG HEAD STRAYS', 'C'], ['donut', 'DONUT AMMO', 'C'], ['bottomless', 'BOTTOMLESS MAG', 'T']],
  };
  const CHEAT_NOTES = { 'pedxing.chonx': 'HIDDEN CHONX PEDESTRIANS', 'chonx.bighead': 'LOOKS ONLY', 'fiveo.bighead': 'LOOKS ONLY', 'fiveo.donut': 'SPRINKLES INSTEAD OF GORE' };
  Tickets.CHEAT_PRICE = 750;
  Object.keys(CHEATS).forEach(game => {
    Tickets.catalog.push({ id: 'env.' + game, shelf: 'cheats', game, envelope: true, name: GAMES[game].title + ' CHEATS', note: '1 OF 3 CODES, AT RANDOM', price: Tickets.CHEAT_PRICE });
    CHEATS[game].forEach(([key, name, kind]) => Tickets.catalog.push({ id: 'cheat.' + game + '.' + key, shelf: 'codes', game, cheat: true, tag: kind === 'T', name, price: 0,
      note: kind === 'T' ? 'TAGS YOUR SCORE' : (CHEAT_NOTES[game + '.' + key] || '') }));
  });
  // ---- Five O loadout: bought outright at the counter (not in the envelope), switched ON/OFF in the game's PRIZES menu.
  // They change the game, so a run with any of them on is tagged, like a T cheat code. Starting guns: one at a time.
  [['armor', 'START WITH BODY ARMOR', 1500], ['shotgun', 'START WITH A SHOTGUN', 1000, 'gun'], ['smg', 'START WITH AN SMG', 1000, 'gun'], ['magnum', 'START WITH A MAGNUM', 1200, 'gun'],
   ['medkit', 'EXTRA MED KIT EVERY ZONE', 1200], ['mag8', 'EXTENDED MAG (8 ROUNDS)', 800], ['reload', 'FAST RELOAD', 800]]
    .forEach(([key, name, price, grp]) => Tickets.catalog.push({ id: 'cheat.fiveo.' + key, shelf: 'fiveo', game: 'fiveo', cheat: true, perk: true, tag: true, group: grp ? 'fiveo.' + grp : undefined, name, price, note: 'TAGS YOUR SCORE' }));
  // ---- seasonal: sold only in their window (Pacific dates, from the device clock), kept forever, equipped like anything else
  const SEASONS = {
    holidays: ['2026-12-01', '2026-12-31', 'HOLIDAYS'], newyear: ['2026-12-31', '2027-01-02', "NEW YEAR'S"],
    valentines: ['2027-02-01', '2027-02-14', "VALENTINE'S"], lunar: ['2027-02-06', '2027-02-12', 'LUNAR NEW YEAR'],
    stpats: ['2027-03-10', '2027-03-17', "ST. PATRICK'S"], easter: ['2027-03-21', '2027-04-04', 'EASTER'],
    fools: ['2027-04-01', '2027-04-01', 'APRIL FOOLS'], mothers: ['2027-05-03', '2027-05-09', "MOTHER'S DAY"],
    summer: ['2027-05-28', '2027-08-31', 'SUMMER'], fathers: ['2027-06-14', '2027-06-20', "FATHER'S DAY"],
    july4: ['2027-07-01', '2027-07-07', 'FOURTH OF JULY'],
  };
  Tickets.SEASONS = SEASONS;
  // [season, game, slot, key, name, price]. Karen throwables use the slot of the regular special that
  // replaces the same item, so the two can't both be equipped (and they copy that item's damage).
  [['holidays', 'yeet', 'hat', 'santa', 'SANTA HAT', 300], ['holidays', 'gta', 'hat', 'elf', 'ELF HAT', 300], ['holidays', 'chonx', 'skin', 'sweater', 'UGLY SWEATER CHONX', 600],
   ['holidays', 'karen', 'cone', 'giftbox', 'GIFT BOX', 400], ['holidays', 'cheekyops', 'reticle', 'candycane', 'CANDY-CANE RETICLE', 300],
   ['holidays', 'pedxing', 'livery', 'lights', 'STRING LIGHTS', 500], ['holidays', 'gta', 'horn', 'sleigh', 'SLEIGH-BELL HORN', 300],
   ['newyear', 'yeet', 'face', 'y2027', '"2027" GLASSES', 250], ['newyear', 'pedxing', 'horn', 'partyhorn', 'PARTY HORN', 250], ['newyear', 'yeet', 'trail', 'confetti', 'CONFETTI TRAIL', 400],
   ['valentines', 'yeet', 'outfit', 'wings', 'CUPID WINGS', 500], ['valentines', 'yeet', 'face', 'hearts', 'HEART SHADES', 250],
   ['valentines', 'karen', 'review', 'chocolate', 'BOX OF CHOCOLATES', 400], ['valentines', 'cheekyops', 'reticle', 'cupid', "CUPID'S-ARROW RETICLE", 300],
   ['lunar', 'yeet', 'trail', 'lantern', 'LANTERN TRAIL', 400], ['lunar', 'pedxing', 'livery', 'redgold', 'RED AND GOLD', 500],
   ['stpats', 'yeet', 'hat', 'leprechaun', 'LEPRECHAUN HAT', 300], ['stpats', 'pedxing', 'livery', 'shamrock', 'SHAMROCK', 400], ['stpats', 'karen', 'casserole', 'potgold', "POT O' GOLD", 500],
   ['easter', 'yeet', 'hat', 'bunny', 'BUNNY EARS', 250], ['easter', 'karen', 'dentures', 'egg', 'EASTER EGG', 300], ['easter', 'pedxing', 'livery', 'pastel', 'PASTEL', 400], ['easter', 'gta', 'hat', 'bonnet', 'EASTER BONNET', 300],
   ['mothers', 'gta', 'neck', 'corsage', 'CORSAGE', 250], ['mothers', 'gta', 'body', 'sash', '"WORLD\'S BEST GRANDMA" SASH', 300],
   ['summer', 'gta', 'hat', 'sunhat', 'SUN HAT', 250], ['summer', 'yeet', 'face', 'sunscreen', 'SUNSCREEN NOSE', 200], ['summer', 'karen', 'clanker', 'noodle', 'POOL NOODLE', 400],
   ['summer', 'karen', 'plush', 'beachball', 'BEACH BALL', 400], ['summer', 'cheekyops', 'reticle', 'watergun', 'WATER-GUN RETICLE', 300], ['summer', 'pedxing', 'livery', 'icecream', 'ICE CREAM TRUCK', 600],
   ['fathers', 'yeet', 'hat', 'dadcap', 'DAD CAP', 200], ['fathers', 'karen', 'brain', 'tongs', 'GRILL TONGS', 400], ['fathers', 'pedxing', 'horn', 'dad', 'DAD HORN', 300],
   ['july4', 'yeet', 'face', 'flag', 'FLAG SHADES', 250], ['july4', 'yeet', 'trail', 'firework', 'FIREWORK TRAIL', 500], ['july4', 'karen', 'monocle', 'sparkler', 'SPARKLER', 400],
   ['july4', 'pedxing', 'livery', 'stars', 'STARS AND STRIPES', 600]]
    .forEach(([season, game, slot, key, name, price]) => {
      const se = SEASONS[season], it = { id: game + '.' + slot + '.' + key, shelf: 'seasonal', game, slot, name, price, season, from: se[0], to: se[1] };
      if (game === 'karen') { it.replaces = KAREN_REPLACES[slot]; it.note = 'TAKES THE ' + it.replaces.toUpperCase() + "'S PLACE"; }
      Tickets.catalog.push(it);
    });
  // April Fools: a box of nothing, 1 ticket. And Chonx Baby works in Yeet for everyone that day.
  Tickets.catalog.push({ id: 'junk.nothing', shelf: 'seasonal', name: 'A BOX OF NOTHING', price: 1, season: 'fools', from: SEASONS.fools[0], to: SEASONS.fools[1], note: 'IT\'S EMPTY. WE CHECKED.' });
  Tickets.catalog.find(i => i.id === 'cheat.yeet.chonx').freeDay = SEASONS.fools[0];
  Tickets.inSeason = it => !it.season || (pacificDay() >= it.from && pacificDay() <= it.to);
  Tickets.seasonLabel = it => { if (!it.season) return ''; const f = d => ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][+d.slice(5, 7) - 1] + ' ' + +d.slice(8); return SEASONS[it.season][2] + ' &middot; ' + (it.from === it.to ? f(it.from) : f(it.from) + '-' + f(it.to)); };

  // ---- daily challenges: one per game, the same for everyone that day (picked from the date), reset midnight Pacific.
  // Each checks the run's score and the stats the game hands to submit(). Tagged runs can't complete them.
  const CHALLENGES = {
    yeet: [['THROW 500 FT', 75, s => s.longest >= 500], ['THROW 750 FT', 100, s => s.longest >= 750], ['THROW 1,000 FT', 150, s => s.longest >= 1000],
      ['SCORE 20,000', 75, s => s.score >= 20000], ['SCORE 30,000', 125, s => s.score >= 30000], ['EVERY THROW OVER 200 FT', 100, s => s.shortest >= 200]],
    chonx: [['BEAT A MINI-BOSS', 75, s => s.bosses >= 1], ['BEAT 2 MINI-BOSSES', 125, s => s.bosses >= 2], ['40 KILLS IN ONE RUN', 75, s => s.kills >= 40],
      ['SCORE 30,000', 75, s => s.score >= 30000], ['SCORE 60,000', 125, s => s.score >= 60000], ['BEAT BRAYN', 150, s => s.victory]],
    cheekyops: [['FINISH 3 MISSIONS', 75, s => s.missions >= 3], ['FINISH 5 MISSIONS', 100, s => s.missions >= 5], ['3 HEADSHOTS', 75, s => s.heads >= 3],
      ['6 HEADSHOTS', 125, s => s.heads >= 6], ['SCORE 60,000', 100, s => s.score >= 60000], ['GET THE GOOD ENDING', 150, s => s.good]],
    gta: [['SCORE 40,000', 75, s => s.score >= 40000], ['SCORE 70,000', 125, s => s.score >= 70000], ['FILL 60 SEATS', 100, s => s.seats >= 60],
      ['FILL 80 SEATS', 125, s => s.seats >= 80], ['BEAT BIG BERTHA', 150, s => s.bertha], ['FILL ALL 100 SEATS', 150, s => s.seats >= 100]],
    karen: [['CLEAR 2 STORES', 75, s => s.stores >= 2], ['CLEAR 3 STORES', 100, s => s.stores >= 3], ['3 HEADSHOTS', 75, s => s.heads >= 3],
      ['6 HEADSHOTS', 125, s => s.heads >= 6], ['SCORE 12,000', 75, s => s.score >= 12000], ['CLEAR ALL 5 STORES', 150, s => s.stores >= 5]],
    pedxing: [['x3 COMBO', 50, s => s.combo >= 3], ['x4 COMBO', 75, s => s.combo >= 4], ['x5 COMBO', 125, s => s.combo >= 5],
      ['A CLEAN SHIFT', 100, s => s.clean], ['SCORE 40,000', 75, s => s.score >= 40000], ['SCORE 70,000', 125, s => s.score >= 70000]],
    fiveo: [['CLEAR A CALL', 75, s => s.stages >= 1], ['CLEAR 2 CALLS', 125, s => s.stages >= 2], ['40 TAKEDOWNS', 75, s => s.kills >= 40],
      ['15 HEADSHOTS', 100, s => s.heads >= 15], ['SCORE 40,000', 100, s => s.score >= 40000], ['PUT MANGE IN CUFFS', 150, s => s.mange]],
  };
  Tickets.challenge = (game, day) => {
    const list = CHALLENGES[game]; if (!list) return null;
    const d = day || pacificDay(); let h = 2166136261;
    for (const ch of d + game) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const [t, n, ok] = list[h % list.length];
    return { t, n, ok, done: tkLoad().chal[game] === d };
  };
  Tickets.shelves = { seasonal: 'SEASONAL', cheats: 'CHEAT CARDS', junk: 'JUNK', collect: 'COLLECTIBLES', top: 'TOP SHELF', chonx: "CHONX '26", cheekyops: 'CHEEKY OPS', yeet: 'YEET THE BABY', gta: 'GRANDMA THEFT AUTO', karen: 'BODY THE KAREN', pedxing: 'PED X-ING', fiveo: 'CHONX FIVE O' };
  Tickets.slots = {
    yeet: { hat: 'HATS', face: 'FACE', outfit: 'OUTFIT', trail: 'FLIGHT TRAIL' },
    chonx: { skin: 'SKINS', shots: 'SHOTS' },
    cheekyops: { reticle: 'SCOPE RETICLE', rifle: 'RIFLE', outfit: 'OUTFIT' },
    karen: { cone: 'THROWABLES', dentures: 'THROWABLES', clanker: 'THROWABLES', casserole: 'THROWABLES', review: 'THROWABLES', rat: 'THROWABLES', plush: 'THROWABLES', brain: 'THROWABLES', monocle: 'THROWABLES', baby: 'THROWABLES', band: 'SLINGSHOT', pouch: 'SLINGSHOT', frame: 'SLINGSHOT' },
    gta: { hat: 'GRANDMA: HATS', eyes: 'GRANDMA: GLASSES', neck: 'GRANDMA: NECK', body: 'GRANDMA: CARDIGAN', bag: 'GRANDMA: HANDBAG', feet: 'GRANDMA: SLIPPERS', walker: 'GRANDMA: WALKER', livery: 'VAN: LIVERY', horn: 'VAN: HORN' },
    pedxing: { livery: 'LIVERY', horn: 'HORN', dash: 'DASHBOARD' },
    fiveo: { outfit: 'OUTFIT', gun: 'PISTOL', reticle: 'CROSSHAIR', flash: 'MUZZLE FLASH' },
  };
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
  Object.keys(CHEATS).forEach(game => {
    const col = (GAMES[game] && GAMES[game].color) || '#ff2bd6';
    ICON_ART['env.' + game] = p => { p.rect(1, 3, 14, 10, '#f4ead2'); p.line(1, 3, 8, 9, '#c9b98f'); p.line(15, 3, 8, 9, '#c9b98f'); p.ell(8, 9, 2.6, 2.6, col); p.set(8, 9, '#ffffff'); };
    CHEATS[game].forEach(([key, , kind]) => {
      ICON_ART['cheat.' + game + '.' + key] = p => { p.rect(3, 1, 10, 14, kind === 'T' ? '#ff2bd6' : '#2bf3ff'); p.rect(4, 2, 8, 12, '#140a32'); p.rect(6, 4, 4, 1, col); p.rect(9, 5, 1, 2, col); p.rect(7, 7, 2, 1, col); p.rect(7, 8, 1, 2, col); p.rect(7, 11, 1, 1, col); };
    });
  });
  // the raw art (no outline) for games that draw a prize in-world
  Tickets.iconPX = id => { const p = new IPX(16, 16), f = ICON_ART[id]; if (f) f(p); return p; };
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
    else if (key === 'santa') { R(-4, -1, 9, 2, '#ffffff'); R(-3, -3, 7, 2, '#e53935'); R(-1, -4, 5, 1, '#e53935'); R(2, -5, 3, 1, '#e53935'); R(4, -4, 2, 2, '#ffffff'); }
    else if (key === 'leprechaun') { R(-5, 0, 11, 1, '#1b5e20'); R(-3, -5, 7, 5, '#2e9d4a'); R(-3, -2, 7, 1, '#111'); R(0, -2, 1, 1, '#ffcc00'); }
    else if (key === 'bunny') { R(-4, -1, 9, 1, '#ff8fc0'); R(-3, -7, 2, 6, '#ffffff'); R(2, -7, 2, 6, '#ffffff'); S(-2, -5, '#ff8fc0'); S(-2, -4, '#ff8fc0'); S(3, -5, '#ff8fc0'); S(3, -4, '#ff8fc0'); }
    else if (key === 'dadcap') { R(-3, -2, 7, 3, '#f4f4f4'); R(-3, -2, 7, 1, '#1e3a8a'); R(4, 0, 4, 1, '#1e3a8a'); S(0, -1, '#e53935'); }
    else if (key === 'crown') { R(-3, -2, 7, 3, '#ffcc00'); S(-3, -3, '#ffcc00'); S(0, -4, '#ffcc00'); S(0, -3, '#ffcc00'); S(3, -3, '#ffcc00'); S(0, -1, '#e53935'); S(-2, -1, '#1e88e5'); S(2, -1, '#1e88e5'); }
  };
  ['party', 'beanie', 'cap', 'helmet', 'chef', 'cowboy', 'viking', 'crown', 'santa', 'leprechaun', 'bunny', 'dadcap'].forEach(k => ICON_ART['yeet.hat.' + k] = p => { babyHead(p); Tickets.yeetHat(p, k, 8, 6); });
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
  // Grandma Theft Automatic: a grandma head / van, with the item
  const granHead = p => { p.ell(8, 10, 4.6, 4.4, '#f2c39a'); p.ell(8, 7, 5, 3, '#e6e3ef'); p.set(6, 10, '#2a1f2e'); p.set(10, 10, '#2a1f2e'); p.rect(7, 12, 2, 1, '#e06a7a'); };
  const carBack = (p, col) => { p.rect(4, 2, 8, 6, '#2a3646'); p.rect(5, 3, 6, 4, '#16202e'); p.rect(2, 7, 12, 6, col); p.rect(2, 13, 12, 1, '#2a2a2a'); p.rect(3, 14, 3, 2, '#111'); p.rect(10, 14, 3, 2, '#111'); p.set(2, 8, '#ff3b3b'); p.set(13, 8, '#ff3b3b'); };
  const vanTop = (p, Y, W, R) => { p.rect(4, 1, 8, 14, Y); p.rect(5, 2, 6, 2, '#9fe3ff'); p.rect(5, 5, 6, 9, W); p.rect(5, 8, 6, 1, R); p.rect(5, 12, 6, 1, R); p.rect(3, 3, 1, 2, '#1c1820'); p.rect(12, 3, 1, 2, '#1c1820'); p.rect(3, 11, 1, 2, '#1c1820'); p.rect(12, 11, 1, 2, '#1c1820'); };
  Object.assign(ICON_ART, {
    'gta.hat.curlers': p => { granHead(p); [[4, 5], [7, 3], [10, 3], [12, 5]].forEach(([x, y]) => p.rect(x, y, 2, 2, '#ff8fc0')); },
    'gta.hat.visor': p => { granHead(p); p.rect(3, 6, 10, 2, '#43a047'); p.rect(9, 8, 6, 1, '#2e7d32'); },
    'gta.hat.helmet': p => { granHead(p); p.ell(8, 6, 6, 3.5, '#1e88e5'); p.rect(6, 3, 1, 3, '#0d47a1'); p.rect(9, 3, 1, 3, '#0d47a1'); },
    'gta.hat.church': p => { granHead(p); p.rect(1, 6, 14, 2, '#7a3cc9'); p.rect(4, 2, 8, 4, '#7a3cc9'); p.ell(11, 3, 1.6, 1.6, '#ff8fc0'); p.set(11, 3, '#ffe14d'); },
    'gta.hat.tiara': p => { granHead(p); p.rect(5, 5, 6, 1, '#cfd4de'); p.set(5, 4, '#cfd4de'); p.set(8, 3, '#cfd4de'); p.set(8, 4, '#cfd4de'); p.set(11, 4, '#cfd4de'); p.set(8, 5, '#ff2bd6'); },
    'gta.eyes.cateye': p => { granHead(p); p.rect(4, 9, 4, 2, '#111'); p.rect(9, 9, 4, 2, '#111'); p.set(3, 8, '#111'); p.set(13, 8, '#111'); p.set(5, 9, '#ff8fc0'); p.set(10, 9, '#ff8fc0'); },
    'gta.feet.slippers': p => { p.ell(5, 11, 4, 2.5, '#ff8fc0'); p.ell(11, 11, 4, 2.5, '#ff8fc0'); p.ell(4, 9, 2.5, 1.6, '#ffffff'); p.ell(10, 9, 2.5, 1.6, '#ffffff'); },
    'gta.neck.pearls': p => { for (let k = 0; k < 9; k++) { const a = Math.PI * (0.1 + k / 10); p.ell(8 + Math.cos(a) * 6, 5 + Math.sin(a) * 6, 1.1, 1.1, '#f8f4ec'); } },
    'gta.bag.handbag': p => { p.rect(3, 6, 10, 8, '#7a3b2a'); p.rect(4, 7, 8, 1, '#c0763c'); p.line(5, 6, 6, 2, '#5a2a1a'); p.line(10, 6, 9, 2, '#5a2a1a'); p.rect(6, 2, 4, 1, '#5a2a1a'); p.rect(7, 9, 2, 2, '#ffcc00'); },
    'gta.walker.tennis': p => { p.rect(3, 3, 10, 1, '#cfd4de'); p.rect(3, 3, 1, 10, '#cfd4de'); p.rect(12, 3, 1, 10, '#cfd4de'); p.ell(3.5, 13, 1.8, 1.8, '#c6ff00'); p.ell(12.5, 13, 1.8, 1.8, '#c6ff00'); },
    'gta.walker.flame': p => { p.rect(3, 3, 10, 1, '#cfd4de'); p.rect(3, 3, 1, 11, '#ff5722'); p.rect(12, 3, 1, 11, '#ff5722'); p.set(3, 6, '#ffeb3b'); p.set(12, 8, '#ffeb3b'); p.set(3, 10, '#ffeb3b'); p.set(12, 12, '#ffeb3b'); },
    'gta.body.leopard': p => { p.rect(3, 3, 10, 11, '#d6a35c'); p.rect(7, 3, 2, 11, '#e06a7a'); [[4, 5], [5, 9], [4, 12], [11, 4], [10, 8], [11, 11]].forEach(([x, y]) => { p.set(x, y, '#3a2410'); p.set(x + 1, y, '#3a2410'); }); },
    'gta.livery.wood': p => { vanTop(p, '#ffcc4d', '#8d5524', '#5d3a1a'); p.rect(5, 6, 6, 1, '#a0692f'); p.rect(5, 10, 6, 1, '#a0692f'); },
    'gta.livery.bingo': p => { vanTop(p, '#f4f4f4', '#c62828', '#ffcc00'); },
    'gta.livery.icecream': p => { vanTop(p, '#ff8fc0', '#ffffff', '#5fd3f3'); p.set(6, 6, '#ff2bd6'); p.set(9, 7, '#43a047'); p.set(7, 10, '#1e88e5'); p.set(10, 11, '#ffcc00'); },
    'gta.livery.flames': p => { vanTop(p, '#212121', '#212121', '#ff5722'); p.rect(5, 9, 6, 1, '#ff9800'); p.set(6, 7, '#ffeb3b'); p.set(9, 6, '#ff9800'); p.set(7, 6, '#ff5722'); },
    'pedxing.livery.student': p => { carBack(p, '#5fa8ff'); p.rect(5, 9, 6, 3, '#ffd600'); p.rect(6, 10, 4, 1, '#111'); },
    'pedxing.livery.stripes': p => { carBack(p, '#1e5bd6'); p.rect(6, 3, 1, 10, '#f4f4f4'); p.rect(9, 3, 1, 10, '#f4f4f4'); },
    'pedxing.livery.camo': p => { carBack(p, '#5b6b2e'); p.rect(3, 9, 3, 2, '#3b4520'); p.rect(8, 10, 3, 2, '#8a7a4a'); p.rect(11, 8, 2, 2, '#3b4520'); },
    'pedxing.livery.checker': p => { carBack(p, '#f4f4f4'); for (let y = 8; y < 13; y++) for (let x = 2; x < 14; x++) if (((x >> 1) + (y >> 1)) % 2) p.set(x, y, '#111'); },
    'pedxing.livery.wood': p => { carBack(p, '#8d5524'); p.rect(3, 8, 10, 4, '#a0692f'); p.rect(3, 9, 10, 1, '#7a4a1c'); p.rect(3, 11, 10, 1, '#7a4a1c'); },
    'pedxing.livery.pizza': p => { carBack(p, '#d32f2f'); p.rect(2, 9, 12, 2, '#f4f4f4'); p.rect(7, 8, 3, 4, '#ffcc4d'); p.set(8, 9, '#c62828'); },
    'pedxing.livery.flames': p => { carBack(p, '#1c1c1c'); [3, 6, 9, 12].forEach((x, i) => { p.rect(x, 12 - 2 - i % 2, 2, 2 + i % 2, '#ff5722'); p.set(x, 12 - i % 2, '#ffc107'); }); },
    'pedxing.livery.neonbread': p => { carBack(p, '#1a1030'); p.rect(2, 9, 12, 1, '#ff2bd6'); p.rect(2, 11, 12, 1, '#2bf3ff'); p.rect(6, 9, 4, 3, '#e0a050'); },
    'pedxing.livery.chrome': p => { carBack(p, '#b9c3cc'); p.rect(3, 8, 2, 5, '#ffffff'); p.rect(11, 8, 1, 5, '#7d8892'); },
    'pedxing.livery.gold': p => { carBack(p, '#e8b923'); p.rect(3, 8, 2, 5, '#fff3b0'); p.rect(11, 8, 1, 5, '#a8820f'); },
    'pedxing.horn.duck': p => { p.ell(8, 10, 5, 4, '#ffd600'); p.ell(5, 5, 3, 3, '#ffd600'); p.rect(1, 5, 2, 2, '#ff9800'); p.set(5, 4, '#111'); p.line(13, 3, 15, 1, '#2bf3ff'); p.line(13, 6, 15, 6, '#2bf3ff'); },
    'pedxing.horn.clown': p => { p.ell(4, 8, 3.5, 3.5, '#e53935'); p.rect(7, 7, 2, 2, '#ffd600'); p.line(9, 8, 12, 5, '#ffd600'); p.line(9, 8, 12, 11, '#ffd600'); p.rect(12, 5, 2, 7, '#ffd600'); },
    'pedxing.horn.goose': p => { p.ell(9, 10, 5, 4, '#9e9e9e'); p.rect(4, 3, 2, 7, '#212121'); p.ell(5, 3, 2, 1.5, '#212121'); p.rect(1, 3, 2, 1, '#111'); p.rect(4, 6, 2, 1, '#f4f4f4'); p.line(13, 3, 15, 1, '#ffe14d'); },
    'pedxing.horn.train': p => { p.rect(2, 7, 12, 3, '#c0c6cc'); p.rect(2, 6, 3, 5, '#90979e'); p.rect(6, 5, 3, 7, '#90979e'); p.rect(10, 4, 3, 9, '#90979e'); p.rect(7, 12, 2, 3, '#555'); },
    'pedxing.dash.dice': p => { p.line(5, 1, 5, 4, '#ddd'); p.line(10, 1, 10, 6, '#ddd'); p.rect(2, 5, 6, 6, '#ff4fa3'); p.set(3, 6, '#fff'); p.set(6, 9, '#fff'); p.rect(8, 7, 6, 6, '#f4f4f4'); p.set(10, 9, '#111'); p.set(12, 11, '#111'); p.set(11, 10, '#111'); },
    'pedxing.dash.bobble': p => { p.rect(5, 12, 6, 3, '#555'); p.rect(7, 9, 2, 3, '#777'); p.ell(8, 6, 5, 4, '#e0a060'); p.ell(4, 2.5, 1.5, 1.5, '#e0a060'); p.ell(12, 2.5, 1.5, 1.5, '#e0a060'); p.ell(8, 7, 3, 2.5, '#fff1dc'); p.set(6, 5, '#111'); p.set(10, 5, '#111'); p.set(8, 7, '#ff8fb0'); },
    'gta.horn.goose': p => { p.ell(9, 10, 5, 4, '#f4f4f4'); p.rect(4, 3, 2, 7, '#f4f4f4'); p.ell(5, 3, 2, 1.5, '#f4f4f4'); p.rect(1, 3, 2, 1, '#ff9800'); p.set(5, 2, '#111'); p.line(13, 3, 15, 1, '#ffe14d'); p.line(13, 6, 15, 6, '#ffe14d'); },
    'gta.horn.bell': p => { p.ell(8, 9, 5, 5, '#ffcc00'); p.rect(3, 9, 10, 4, '#ffcc00'); p.rect(2, 12, 12, 1, '#d4a800'); p.rect(7, 2, 2, 2, '#d4a800'); p.ell(8, 14, 1.4, 1.2, '#8a6a00'); },
  });
  // Body The Karen: the special throwables and slingshot parts
  Object.assign(ICON_ART, {
    'karen.cone.cone': p => { for (let r = 0; r < 11; r++) p.rect(8 - Math.floor(r / 2), 2 + r, 1 + Math.floor(r / 2) * 2, 1, '#ff6d00'); p.rect(5, 7, 6, 2, '#ffffff'); p.rect(2, 13, 12, 2, '#ff6d00'); },
    'karen.dentures.dentures': p => { p.ell(8, 7, 6, 3, '#ff8fa8'); p.ell(8, 11, 6, 3, '#ff8fa8'); for (let k = 0; k < 5; k++) { p.rect(3 + k * 2, 7, 1, 2, '#ffffff'); p.rect(3 + k * 2, 10, 1, 2, '#ffffff'); } },
    'karen.clanker.clanker': p => { p.rect(3, 4, 10, 10, '#858c99'); p.rect(4, 7, 3, 2, '#ff2a2a'); p.rect(9, 7, 3, 2, '#ff2a2a'); p.rect(5, 11, 6, 1, '#2b2b2b'); p.rect(7, 1, 2, 3, '#cfd4de'); p.set(8, 0, '#ff2a2a'); },
    'karen.casserole.casserole': p => { p.rect(2, 8, 12, 5, '#3f7fd6'); p.rect(0, 9, 2, 2, '#3f7fd6'); p.rect(14, 9, 2, 2, '#3f7fd6'); p.ell(8, 8, 6, 2, '#bfe0ff'); p.rect(7, 5, 2, 1, '#3f7fd6'); p.set(5, 3, '#ffffff'); p.set(10, 2, '#ffffff'); },
    'karen.review.review': p => { p.rect(2, 4, 12, 8, '#e0e0e0'); p.rect(2, 4, 12, 1, '#bdbdbd'); p.ell(5, 8, 2, 2, '#ffcc00'); for (let k = 0; k < 3; k++) p.rect(8, 6 + k * 2, 5, 1, '#757575'); },
    'karen.rat.rat': p => { p.ell(8, 10, 6, 4, '#8a8f99'); p.ell(12.5, 7, 2, 2, '#8a8f99'); p.ell(4, 6, 1.5, 1.5, '#8a8f99'); p.set(12, 7, '#ff2a2a'); p.line(1, 12, 2, 10, '#c98aa0'); },
    'karen.plush.plush': p => { p.ell(8, 10, 6, 5, '#d9893b'); p.ell(8, 11, 3, 3, '#f6c98a'); p.ell(3.5, 3.5, 1.8, 1.8, '#d9893b'); p.ell(12.5, 3.5, 1.8, 1.8, '#d9893b'); p.ell(8, 6, 5, 4, '#d9893b'); p.set(6, 6, '#111'); p.set(10, 6, '#111'); p.rect(3, 12, 10, 2, '#7a3cc9'); },
    'karen.brain.brain': p => { p.ell(8, 8, 6.5, 5, '#ff9fc0'); p.line(8, 3, 8, 13, '#d9608a'); p.line(4, 6, 6, 8, '#d9608a'); p.line(11, 6, 12, 9, '#d9608a'); },
    'karen.monocle.monocle': p => { p.ell(7, 7, 5, 5, '#ffd23a'); p.ell(7, 7, 3.4, 3.4, '#cfefff'); p.line(11, 10, 14, 15, '#ffd23a'); },
    'karen.baby.baby': p => { p.ell(9, 6, 4.5, 4.4, '#f6c48f'); p.ell(7, 12, 4, 3, '#f6c48f'); p.ell(7, 13, 3.6, 2.4, '#ffffff'); p.set(10, 5, '#111'); p.set(12, 5, '#111'); p.rect(11, 8, 2, 1, '#c0392b'); p.set(9, 1, '#c98a3a'); },
    'karen.band.rainbow': p => { ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((c, i) => p.rect(1 + i * 2, 6 + Math.round(Math.sin(i) * 2), 2, 3, c)); p.rect(1, 3, 2, 10, '#8b5a2b'); p.rect(13, 3, 2, 10, '#8b5a2b'); },
    'karen.pouch.paw': p => { p.ell(8, 9, 6, 5, '#d9893b'); p.ell(8, 10, 3, 2.4, '#ff9fb0'); p.ell(4, 5, 1.4, 1.4, '#ff9fb0'); p.ell(7, 4, 1.4, 1.4, '#ff9fb0'); p.ell(10, 4, 1.4, 1.4, '#ff9fb0'); p.ell(13, 5, 1.4, 1.4, '#ff9fb0'); },
    'karen.frame.gold': p => { p.rect(7, 7, 3, 9, '#ffcc00'); p.line(8, 8, 2, 1, '#ffcc00'); p.line(9, 8, 14, 1, '#ffcc00'); p.line(8, 9, 3, 2, '#d4a800'); p.line(9, 9, 13, 2, '#d4a800'); p.set(8, 12, '#fff3a0'); },
  });
  // Chonx '26: a little Chonx in each skin
  const miniChonx = (p, c) => { p.ell(8, 11, 5, 4.6, c.fur); p.rect(3, 9, 10, 5, c.hood); p.rect(3, 9, 2, 5, c.hoodD); p.rect(3, 13, 10, 1, c.teal); p.ell(9, 6, 4.4, 4, c.fur); p.ell(10.6, 7.6, 2, 1.6, c.furL); p.ell(6, 2.4, 1.3, 1.4, c.fur); p.ell(11, 2.2, 1.3, 1.4, c.fur); p.set(10, 5, c.eye || '#111'); p.set(13, 7, c.nose || '#ff6f8f'); };
  const CH = { fur: '#d9893b', furL: '#f6c98a', hood: '#7a3cc9', hoodD: '#5a2a99', teal: '#2ee6d6' };
  Object.assign(ICON_ART, {
    'chonx.skin.pajama': p => { miniChonx(p, Object.assign({}, CH, { hood: '#9fd3ff', hoodD: '#6fa8d6', teal: '#ffffff' })); p.set(5, 11, '#ffffff'); p.set(8, 12, '#ffffff'); p.set(11, 10, '#ffffff'); for (let r = 0; r < 4; r++) p.rect(7 - r, 1 + r, 2 + r, 1, '#9fd3ff'); p.set(10, 0, '#ffffff'); },
    'chonx.skin.green': p => { miniChonx(p, { fur: '#8bac0f', furL: '#9bbc0f', hood: '#306230', hoodD: '#0f380f', teal: '#9bbc0f', eye: '#0f380f', nose: '#306230' }); },
    'chonx.skin.retro': p => { miniChonx(p, Object.assign({}, CH, { hood: '#d9893b', hoodD: '#b06a26', teal: '#d9893b' })); p.rect(5, 9, 8, 2, '#e53935'); p.rect(4, 11, 2, 3, '#e53935'); },
    'chonx.skin.ghost': p => { miniChonx(p, { fur: '#dfe9f5', furL: '#ffffff', hood: '#c9d8ee', hoodD: '#a9bdd8', teal: '#ffffff', eye: '#5a6f8a', nose: '#c9d8ee' }); },
    'chonx.skin.tactical': p => { miniChonx(p, Object.assign({}, CH, { hood: '#4b5320', hoodD: '#353b17', teal: '#1d1d1d' })); p.rect(5, 4, 9, 1, '#1d1d1d'); p.rect(9, 3, 4, 2, '#3fae1f'); },
    'chonx.skin.golden': p => { miniChonx(p, { fur: '#e0a800', furL: '#fff3a0', hood: '#ffcc00', hoodD: '#d4a800', teal: '#fff3a0', nose: '#d4a800' }); p.set(4, 4, '#ffffff'); p.set(14, 9, '#ffffff'); },
    'chonx.shots.rainbow': p => { ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((c, i) => p.rect(1 + i * 2.4, 6, 2, 4, c)); },
  });
  // Cheeky Ops: reticles, rifles, the tux
  const scopeRing = (p, line) => { p.ell(8, 8, 7.5, 7.5, '#0a0a0a'); p.ell(8, 8, 6.5, 6.5, '#9fd3c7'); p.rect(1, 8, 14, 1, line || '#0a0a0a'); p.rect(8, 1, 1, 14, line || '#0a0a0a'); };
  const rifleArt = (p, body, stock, accent) => { p.rect(1, 7, 14, 2, body); p.rect(0, 7, 4, 4, stock); p.rect(8, 9, 2, 3, body); p.rect(6, 5, 5, 2, accent || body); p.set(15, 7, body); };
  Object.assign(ICON_ART, {
    'cheekyops.reticle.paw': p => { scopeRing(p); p.ell(8, 9, 2, 1.6, '#ff9fb0'); p.set(6, 6, '#ff9fb0'); p.set(8, 5, '#ff9fb0'); p.set(10, 6, '#ff9fb0'); },
    'cheekyops.reticle.heart': p => { scopeRing(p); p.rect(6, 6, 2, 2, '#ff2a3d'); p.rect(9, 6, 2, 2, '#ff2a3d'); p.rect(6, 7, 5, 2, '#ff2a3d'); p.rect(7, 9, 3, 1, '#ff2a3d'); p.set(8, 10, '#ff2a3d'); },
    'cheekyops.reticle.skull': p => { scopeRing(p); p.ell(8, 7.5, 2.6, 2.4, '#ffffff'); p.rect(7, 10, 3, 1, '#ffffff'); p.set(7, 7, '#0a0a0a'); p.set(9, 7, '#0a0a0a'); },
    'cheekyops.reticle.sixseven': p => { scopeRing(p); [[3, 5], [3, 6], [3, 7], [4, 7], [3, 8], [4, 9], [3, 9], [4, 5]].forEach(([x, y]) => p.set(x, y, '#ff2bd6')); [[11, 5], [12, 5], [13, 5], [13, 6], [12, 7], [12, 8], [12, 9]].forEach(([x, y]) => p.set(x, y, '#ff2bd6')); },
    'cheekyops.reticle.gold': p => { scopeRing(p, '#ffcc00'); p.set(8, 8, '#ff2a3d'); },
    'cheekyops.rifle.camo': p => { rifleArt(p, '#5d7a3a', '#3e5226', '#8a6a3a'); p.set(4, 7, '#8a6a3a'); p.set(11, 8, '#3e5226'); },
    'cheekyops.rifle.wood': p => { rifleArt(p, '#2a2d36', '#8d5524', '#2a2d36'); },
    'cheekyops.rifle.neon': p => { rifleArt(p, '#ff2bd6', '#00e5ff', '#00e5ff'); },
    'cheekyops.rifle.gold': p => { rifleArt(p, '#ffcc00', '#d4a800', '#fff3a0'); },
    'cheekyops.outfit.tux': p => { p.rect(3, 3, 10, 12, '#111111'); p.rect(7, 3, 2, 12, '#ffffff'); p.rect(6, 3, 4, 2, '#e53935'); p.set(8, 7, '#111'); p.set(8, 10, '#111'); p.line(4, 3, 7, 8, '#2a2a2a'); p.line(12, 3, 9, 8, '#2a2a2a'); },
  });
  // ---- Chonx Five O
  const chonxBack = (p, cap, shirt, ear = true) => { p.ell(8, 15, 7, 4, shirt); p.ell(8, 9, 5, 4.6, '#d9893b'); if (ear) { p.ell(3.5, 7, 1.4, 1.6, '#d9893b'); p.ell(12.5, 7, 1.4, 1.6, '#d9893b'); } if (cap) cap(p); };
  const pistolArt = (p, a, b) => { p.rect(2, 6, 10, 3, a); p.rect(2, 6, 10, 1, b); p.rect(9, 9, 3, 5, a); p.rect(10, 10, 1, 3, b); p.rect(6, 9, 2, 2, a); };
  const xhair = (p, c) => { p.ell(8, 8, 6, 6, c); p.ell(8, 8, 4.8, 4.8, null); p.rect(8, 0, 1, 4, c); p.rect(8, 13, 1, 3, c); p.rect(0, 8, 4, 1, c); p.rect(13, 8, 3, 1, c); };
  const flashArt = (p, c1, c2) => { for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4, r = a % 2 ? 4 : 7; p.line(8, 8, 8 + Math.cos(ang) * r, 8 + Math.sin(ang) * r, c1); } p.ell(8, 8, 2.5, 2.5, c2); };
  Object.assign(ICON_ART, {
    'fiveo.outfit.trench': p => chonxBack(p, p => { p.rect(3, 3, 10, 2, '#5a4632'); p.rect(1, 5, 14, 1, '#5a4632'); p.rect(3, 4, 10, 1, '#2a2018'); }, '#b89a6a'),
    'fiveo.outfit.riot': p => chonxBack(p, p => { p.ell(8, 7, 6, 5.5, '#1a2550'); p.rect(2, 8, 12, 3, '#9ac0e0'); p.rect(2, 8, 12, 1, '#d8ecff'); }, '#1a2550', false),
    'fiveo.outfit.swat': p => { chonxBack(p, p => { p.ell(8, 6, 5.5, 4, '#1a1a1e'); p.rect(3, 7, 10, 1, '#3a3a40'); }, '#1a1a1e', false); p.rect(3, 13, 10, 3, '#1a1a1e'); [[4, '1110'], [7, '1011'], [10, '1110']].forEach(([x]) => p.rect(x, 13, 2, 2, '#e8e8e8')); },
    'fiveo.outfit.moto': p => chonxBack(p, p => { p.ell(8, 6, 6, 5, '#f4f4f4'); p.rect(2, 7, 12, 2, '#1a2550'); p.set(8, 2, '#ffd23a'); }, '#6a3a1e', false),
    'fiveo.outfit.miami': p => { chonxBack(p, null, '#ff9ad0'); p.rect(6, 12, 4, 4, '#7af0e0'); p.ell(8, 6, 4.6, 2, '#a8621f'); },
    'fiveo.gun.wood': p => pistolArt(p, '#2a2d36', '#5a606c') || p.rect(9, 9, 3, 5, '#8d5524'),
    'fiveo.gun.chrome': p => pistolArt(p, '#c8ccd4', '#ffffff'),
    'fiveo.gun.neon': p => pistolArt(p, '#ff2bd6', '#2bf3ff'),
    'fiveo.gun.gold': p => pistolArt(p, '#ffcc00', '#fff3a0'),
    'fiveo.reticle.badge': p => { xhair(p, '#ffffff'); p.ell(8, 8, 2.6, 2.8, '#ffd23a'); p.set(8, 8, '#2b6bff'); },
    'fiveo.reticle.donut': p => { p.ell(8, 8, 6.5, 6.5, '#e8a860'); p.ell(8, 8, 5.5, 5.5, '#ff8ac8'); p.ell(8, 8, 2, 2, null); [[5, 4, '#2bf3ff'], [11, 5, '#ffe14d'], [4, 10, '#ffffff'], [11, 11, '#7dff4a'], [8, 3, '#ff2a3d']].forEach(([x, y, c]) => p.set(x, y, c)); },
    'fiveo.reticle.star': p => { xhair(p, '#ffffff'); p.rect(7, 6, 3, 5, '#ffd23a'); p.rect(6, 7, 5, 2, '#ffd23a'); },
    'fiveo.reticle.skull': p => { xhair(p, '#ffffff'); p.ell(8, 7.5, 2.4, 2.2, '#ffffff'); p.rect(7, 9, 3, 1, '#ffffff'); p.set(7, 7, '#111'); p.set(9, 7, '#111'); },
    'fiveo.flash.blue': p => flashArt(p, '#2b6bff', '#bfe0ff'),
    'fiveo.flash.green': p => flashArt(p, '#39ff6a', '#d8ffd8'),
    'fiveo.flash.pink': p => flashArt(p, '#ff2bd6', '#ffd3f6'),
    'fiveo.flash.rainbow': p => { ['#ff3b3b', '#ff9a1f', '#ffe14d', '#3ddc5a', '#2f8cff', '#9b4bff', '#ff2bd6', '#2bf3ff'].forEach((c, a) => { const ang = a * Math.PI / 4, r = a % 2 ? 4 : 7; p.line(8, 8, 8 + Math.cos(ang) * r, 8 + Math.sin(ang) * r, c); }); p.ell(8, 8, 2.5, 2.5, '#ffffff'); },
    'cheat.fiveo.armor': p => { p.rect(3, 2, 10, 12, '#2a3a6a'); p.rect(3, 2, 3, 3, null); p.rect(10, 2, 3, 3, null); p.rect(5, 6, 6, 6, '#3a4e8a'); p.rect(7, 7, 2, 3, '#ffd23a'); p.rect(3, 13, 10, 1, '#1a2550'); },
    'cheat.fiveo.shotgun': p => { p.rect(1, 6, 14, 2, '#3a3e46'); p.rect(1, 5, 9, 1, '#6a707c'); p.rect(10, 6, 5, 4, '#8a5a2a'); p.rect(6, 8, 3, 2, '#5a3a1a'); },
    'cheat.fiveo.smg': p => { p.rect(3, 5, 10, 4, '#26282e'); p.rect(3, 5, 10, 1, '#5a606c'); p.rect(7, 9, 2, 5, '#26282e'); p.rect(11, 9, 2, 3, '#26282e'); p.rect(0, 6, 3, 2, '#3a3e46'); },
    'cheat.fiveo.magnum': p => { p.rect(1, 6, 9, 3, '#c8ccd4'); p.rect(1, 6, 9, 1, '#ffffff'); p.ell(10, 7.5, 2.5, 2.5, '#9aa0aa'); p.rect(11, 9, 3, 5, '#5a3a1a'); },
    'cheat.fiveo.medkit': p => { p.rect(2, 4, 12, 10, '#f4f4f4'); p.rect(6, 2, 4, 2, '#a0a0a0'); p.rect(7, 6, 2, 6, '#e8202a'); p.rect(5, 8, 6, 2, '#e8202a'); },
    'cheat.fiveo.mag8': p => { p.rect(5, 2, 6, 13, '#3a3e46'); p.rect(5, 2, 6, 1, '#6a707c'); for (let k = 0; k < 4; k++) p.rect(6, 4 + k * 3, 4, 2, '#e8c040'); },
    'cheat.fiveo.reload': p => { p.rect(5, 4, 6, 11, '#3a3e46'); p.rect(6, 6, 4, 2, '#e8c040'); p.line(1, 2, 4, 2, '#2bf3ff'); p.line(0, 5, 3, 5, '#2bf3ff'); p.line(12, 9, 15, 9, '#2bf3ff'); },
    'col.badge': p => { p.ell(8, 8, 6, 7, '#ffd23a'); p.ell(8, 8, 4, 5, '#e8a800'); p.ell(8, 8, 2, 2.4, '#2b6bff'); p.rect(7, 1, 2, 2, '#ffd23a'); },
    'col.mangebob': p => { p.rect(5, 13, 6, 2, '#333'); p.rect(7, 10, 2, 3, '#2a2a30'); p.ell(8, 6, 5, 4.6, '#6e6e74'); p.ell(3, 4, 1.6, 2.6, '#48484e'); p.ell(13, 4, 1.6, 2.6, '#48484e'); p.rect(5, 5, 3, 2, '#111'); p.set(10, 5, '#111'); p.ell(8, 8, 2.4, 1.6, '#9a9aa2'); p.set(8, 7, '#111'); p.rect(6, 10, 4, 1, '#2a2a2a'); },
  });
  // ---- seasonal icons
  const heart = (p, x, y, c) => { p.rect(x, y, 2, 2, c); p.rect(x + 3, y, 2, 2, c); p.rect(x, y + 1, 5, 2, c); p.rect(x + 1, y + 3, 3, 1, c); p.set(x + 2, y + 4, c); };
  Object.assign(ICON_ART, {
    'gta.hat.elf': p => { granHead(p); p.rect(3, 6, 10, 2, '#e53935'); for (let r = 0; r < 5; r++) p.rect(4 + r, 5 - r, 7 - r, 1, '#2e9d4a'); p.ell(13, 2, 1.5, 1.5, '#ffe14d'); },
    'gta.hat.bonnet': p => { granHead(p); p.ell(8, 6, 7, 3, '#ffe9a8'); p.rect(2, 7, 12, 1, '#ff8fc0'); p.set(4, 5, '#9fe3ff'); p.set(12, 5, '#c8a8ff'); p.set(8, 4, '#ff8fc0'); },
    'gta.hat.sunhat': p => { granHead(p); p.ell(8, 6.5, 7.5, 2, '#f2d38a'); p.ell(8, 4.5, 4, 2.5, '#f2d38a'); p.rect(4, 5, 8, 1, '#e53935'); },
    'gta.horn.sleigh': p => { [[4, 9], [8, 6], [12, 9]].forEach(([x, y]) => { p.ell(x, y, 2.6, 2.6, '#ffcc00'); p.set(x, y + 1, '#8a6a00'); }); p.line(1, 9, 15, 9, '#c62828'); p.rect(1, 9, 14, 1, '#c62828'); },
    'gta.neck.corsage': p => { p.ell(8, 8, 4, 4, '#ff8fc0'); p.ell(8, 8, 2, 2, '#ffe14d'); p.ell(4, 11, 2.5, 1.5, '#43a047'); p.ell(12, 11, 2.5, 1.5, '#43a047'); },
    'gta.body.sash': p => { p.rect(3, 3, 10, 12, '#9b6bd6'); for (let k = 0; k < 12; k++) p.rect(3 + Math.floor(k * 0.8), 3 + k, 3, 1, '#ffcc00'); p.set(8, 8, '#e53935'); },
    'yeet.face.y2027': p => { babyHead(p); p.rect(3, 8, 11, 3, '#ffcc00'); p.set(4, 9, '#111'); p.set(6, 9, '#111'); p.set(10, 9, '#111'); p.set(12, 9, '#111'); },
    'yeet.face.hearts': p => { babyHead(p); heart(p, 4, 8, '#ff2a3d'); heart(p, 10, 8, '#ff2a3d'); },
    'yeet.face.sunscreen': p => { babyHead(p); p.rect(11, 9, 3, 3, '#ffffff'); p.set(12, 10, '#dff6ff'); },
    'yeet.face.flag': p => { babyHead(p); p.rect(3, 8, 5, 3, '#1e3a8a'); p.rect(9, 8, 5, 3, '#c62828'); p.rect(9, 9, 5, 1, '#ffffff'); p.set(4, 9, '#ffffff'); p.set(6, 9, '#ffffff'); },
    'yeet.outfit.wings': p => { p.ell(4, 8, 3.5, 5, '#ffffff'); p.ell(12, 8, 3.5, 5, '#ffffff'); p.ell(4, 9, 2, 3, '#ffe0ef'); p.ell(12, 9, 2, 3, '#ffe0ef'); heart(p, 6, 3, '#ff2a3d'); },
    'yeet.trail.confetti': p => { [[2, 12, '#ff2bd6'], [5, 8, '#2bf3ff'], [8, 11, '#ffe14d'], [10, 5, '#7dff4a'], [13, 3, '#ff2bd6'], [12, 9, '#ff7a1a'], [6, 3, '#2bf3ff']].forEach(([x, y, c]) => p.rect(x, y, 2, 1, c)); },
    'yeet.trail.lantern': p => { p.line(8, 0, 8, 3, '#ffcc00'); p.ell(8, 8, 5, 5, '#e53935'); p.rect(4, 4, 9, 1, '#ffcc00'); p.rect(4, 12, 9, 1, '#ffcc00'); p.ell(8, 8, 2, 2.5, '#ff7a1a'); p.line(8, 13, 8, 15, '#ffcc00'); },
    'yeet.trail.firework': p => { for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; p.line(8, 7, 8 + Math.round(Math.cos(a) * 6), 7 + Math.round(Math.sin(a) * 6), k % 2 ? '#2bf3ff' : '#ff2bd6'); } p.set(8, 7, '#ffffff'); p.line(8, 10, 8, 15, '#ffe14d'); },
    'chonx.skin.sweater': p => { miniChonx(p, Object.assign({}, CH, { hood: '#c62828', hoodD: '#8e1b1b', teal: '#ffffff' })); p.set(5, 11, '#ffffff'); p.set(8, 10, '#2e9d4a'); p.set(11, 11, '#ffffff'); p.set(7, 12, '#ffffff'); },
    'cheekyops.reticle.candycane': p => { scopeRing(p); p.rect(8, 6, 1, 6, '#ffffff'); p.set(8, 7, '#e53935'); p.set(8, 9, '#e53935'); p.set(8, 11, '#e53935'); p.set(9, 5, '#e53935'); p.set(10, 6, '#ffffff'); p.set(10, 7, '#e53935'); },
    'cheekyops.reticle.cupid': p => { scopeRing(p); p.line(4, 12, 12, 4, '#ffcc00'); p.rect(11, 3, 2, 2, '#ff2a3d'); p.set(4, 12, '#ffffff'); p.set(3, 11, '#ffffff'); },
    'cheekyops.reticle.watergun': p => { scopeRing(p); p.ell(8, 8, 2.4, 2.4, '#2bf3ff'); p.set(8, 4, '#2bf3ff'); p.set(8, 12, '#2bf3ff'); p.set(4, 8, '#2bf3ff'); p.set(12, 8, '#2bf3ff'); },
    'pedxing.livery.lights': p => { carBack(p, '#2e7d32'); p.line(2, 8, 13, 8, '#111'); [[3, '#e53935'], [6, '#ffe14d'], [9, '#2bf3ff'], [12, '#ff2bd6']].forEach(([x, c]) => p.rect(x, 9, 1, 2, c)); },
    'pedxing.livery.redgold': p => { carBack(p, '#c62828'); p.rect(2, 9, 12, 1, '#ffcc00'); p.rect(2, 11, 12, 1, '#ffcc00'); p.rect(7, 8, 2, 4, '#ffcc00'); },
    'pedxing.livery.shamrock': p => { carBack(p, '#2e9d4a'); p.ell(7, 9, 1.3, 1.3, '#a5f28a'); p.ell(9, 9, 1.3, 1.3, '#a5f28a'); p.ell(8, 8, 1.3, 1.3, '#a5f28a'); p.set(8, 11, '#a5f28a'); },
    'pedxing.livery.pastel': p => { carBack(p, '#ffc8e6'); p.rect(2, 9, 12, 1, '#b8f0d8'); p.rect(2, 11, 12, 1, '#c8d8ff'); p.ell(8, 10, 1.5, 2, '#fff3a0'); },
    'pedxing.livery.icecream': p => { carBack(p, '#ffffff'); p.rect(2, 8, 12, 1, '#ff8fc0'); p.rect(7, 9, 3, 2, '#ff8fc0'); p.rect(8, 11, 1, 2, '#e0a050'); p.set(4, 10, '#5fd3f3'); p.set(12, 10, '#ffcc00'); },
    'pedxing.livery.stars': p => { carBack(p, '#c62828'); p.rect(2, 7, 5, 3, '#1e3a8a'); p.set(3, 8, '#ffffff'); p.set(5, 8, '#ffffff'); p.rect(7, 9, 7, 1, '#ffffff'); p.rect(2, 11, 12, 1, '#ffffff'); },
    'pedxing.horn.partyhorn': p => { p.line(2, 12, 10, 4, '#ff2bd6'); p.line(3, 12, 11, 4, '#ffe14d'); p.ell(12, 3, 2.5, 2.5, '#2bf3ff'); p.line(13, 8, 15, 10, '#ffe14d'); },
    'pedxing.horn.dad': p => { p.rect(3, 6, 4, 5, '#555'); for (let r = 0; r < 6; r++) p.rect(7 + r, 6 - Math.floor(r / 2), 1, 5 + Math.floor(r / 2) * 2, '#8a8f99'); p.rect(4, 3, 3, 2, '#1e88e5'); },
    'karen.cone.giftbox': p => { p.rect(3, 5, 10, 9, '#e53935'); p.rect(7, 5, 2, 9, '#ffcc00'); p.rect(3, 8, 10, 2, '#ffcc00'); p.ell(6, 3.5, 2, 1.5, '#ffcc00'); p.ell(10, 3.5, 2, 1.5, '#ffcc00'); },
    'karen.review.chocolate': p => { heart(p, 3, 4, '#c62828'); p.rect(3, 5, 10, 6, '#c62828'); p.rect(4, 11, 8, 1, '#c62828'); p.rect(6, 12, 4, 1, '#c62828'); p.rect(5, 6, 2, 2, '#5d3a1a'); p.rect(9, 6, 2, 2, '#5d3a1a'); p.rect(7, 9, 2, 2, '#5d3a1a'); },
    'karen.casserole.potgold': p => { p.ell(8, 10, 6, 4.5, '#212121'); p.rect(2, 7, 12, 2, '#3a3a3a'); p.ell(8, 6, 5, 2.4, '#ffcc00'); p.set(6, 5, '#fff3a0'); p.set(10, 6, '#fff3a0'); },
    'karen.dentures.egg': p => { p.ell(8, 8.5, 4.6, 6, '#c8a8ff'); p.rect(4, 7, 9, 1, '#ffe14d'); p.rect(4, 10, 9, 1, '#7dff4a'); p.set(6, 5, '#ffffff'); },
    'karen.clanker.noodle': p => { p.line(2, 14, 13, 2, '#ff8f2b'); p.line(3, 14, 14, 2, '#ff8f2b'); p.line(2, 13, 13, 1, '#ff8f2b'); p.line(4, 14, 14, 3, '#ffb36b'); },
    'karen.plush.beachball': p => { p.ell(8, 8, 6, 6, '#ffffff'); p.rect(2, 7, 12, 2, '#e53935'); p.rect(7, 2, 2, 12, '#1e88e5'); p.ell(8, 8, 1.4, 1.4, '#ffcc00'); },
    'karen.brain.tongs': p => { p.line(2, 14, 12, 2, '#cfd4de'); p.line(4, 14, 14, 4, '#cfd4de'); p.rect(1, 12, 4, 3, '#212121'); p.set(12, 1, '#9aa3ad'); p.set(15, 4, '#9aa3ad'); },
    'karen.monocle.sparkler': p => { p.line(3, 14, 10, 6, '#9aa3ad'); [[11, 3], [13, 5], [10, 2], [14, 7], [12, 1], [9, 4], [12, 4]].forEach(([x, y], i) => p.set(x, y, i % 2 ? '#ffe14d' : '#ffffff')); p.set(11, 5, '#ff7a1a'); },
    'junk.nothing': p => { p.rect(2, 6, 12, 8, '#c9a46a'); p.rect(2, 6, 12, 1, '#a07c44'); p.rect(4, 8, 8, 5, '#3a2a14'); p.line(2, 6, 5, 2, '#c9a46a'); p.line(14, 6, 11, 2, '#c9a46a'); },
  });
  window.NBTickets = Tickets;


  // ---------------------------------------------------------------- accounts (optional sign-in: Google or an emailed link)
  // A signed-in player's ticket wallet, leaderboard name and each game's progress live in players/{uid}.
  // Guests never load the Firebase SDK. Every write to a synced localStorage key (from any game) schedules a sync.
  // Merge rules (Elijah, Nov 27): the first sign-in on a device ADDS that device's tickets and prizes to the account and keeps
  // the furthest-along game saves; after that the device mirrors the account. Best scores always keep the higher one.
  // Signing out clears the synced data from the device. Sound and gore settings stay per device.
  const FBCFG = { apiKey: 'AIzaSyBXZXXveAqers-aoMH_y-itAESHTt-0Ym0', authDomain: 'neon-bread-arcade.firebaseapp.com', projectId: PROJECT, appId: '1:873176739130:web:bb531384997bf4efff7403' };
  const SDK_URL = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const SYNC_KEYS = [TK_KEY, NAME_KEY, 'chonx26_save_v1', 'cheekyops_save_v1', 'gta-week', 'cheekyops_best', 'fiveo_best', 'bodykaren26_best', 'yeet26_best', 'gta-bestweek', 'pedxing_best', 'pedxing_cash', 'pedxing_cars', 'pedxing_car', 'pedxing_paint'];
  const BEST_KEYS = ['cheekyops_best', 'fiveo_best', 'bodykaren26_best', 'yeet26_best', 'gta-bestweek', 'pedxing_best'];
  const PROGRESS = { chonx26_save_v1: s => +s.level || 0, cheekyops_save_v1: s => (s.missions || []).filter(m => m && (m.done || m.locked)).length, 'gta-week': s => +s.dayIdx || 0 };
  // keys that only make sense together: on the first sign-in the whole group comes from whichever side is further along
  const GROUPS = [{ keys: ['pedxing_cash', 'pedxing_cars', 'pedxing_car', 'pedxing_paint'], score: g => { const c = pj(g.pedxing_cars); return (Array.isArray(c) ? c.length : 0) * 1e9 + (+g.pedxing_cash || 0); } }];
  const UID_KEY = 'nb_sync_uid', BASE_KEY = 'nb_sync_base', PEND_KEY = 'nb_email_pending';
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsPut = (k, v) => { try { if (v == null) rawRemove.call(localStorage, k); else rawSet.call(localStorage, k, v); } catch (e) { } };
  const pj = v => { try { return JSON.parse(v); } catch (e) { return null; } };
  const pw = v => { const w = pj(v); return w && typeof w.bal === 'number' ? Object.assign(tkBlank(), w) : tkBlank(); };
  const Acct = { auth: null, user: null, init: null, status: 'out', busy: null, again: false, timer: 0, lastMerge: null, listeners: [] };
  function acctFire() { Acct.listeners.forEach(f => { try { f(Acct); } catch (e) { } }); if (NB && NB._mode === 'menu' && NB._st && NB._st.live) NB._st.live(); }
  function setStatus(st) { Acct.status = st; acctFire(); }
  // any game writing a synced key schedules a sync (our own writes use the raw setter, so they don't loop)
  try {
    Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (Acct.user && SYNC_KEYS.indexOf(k) >= 0) markDirty(); };
    Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (Acct.user && SYNC_KEYS.indexOf(k) >= 0) markDirty(); };
  } catch (e) { }
  function markDirty(ms) { clearTimeout(Acct.timer); Acct.timer = setTimeout(() => sync(), ms || 1500); }
  // ---- Firestore REST with the player's ID token
  const DOC = uid => BASE + '/players/' + uid;
  async function authed(url, opt) {
    const t = await Acct.user.getIdToken();
    const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}) }));
    if (r.status === 404) return null;
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
    return j;
  }
  async function fsGet(uid) {
    const j = await authed(DOC(uid)); if (!j) return null;
    const f = j.fields || {}, sf = (f.saves && f.saves.mapValue && f.saves.mapValue.fields) || {}, saves = {};
    for (const k in sf) saves[k] = 'stringValue' in sf[k] ? sf[k].stringValue : null;
    return { wallet: (f.wallet && f.wallet.stringValue) || null, saves, rev: +((f.rev && f.rev.integerValue) || 0) };
  }
  function fsPut(uid, d) {
    const sf = {}; for (const k in d.saves) if (d.saves[k] != null) sf[k] = { stringValue: d.saves[k] };
    return authed(DOC(uid), { method: 'PATCH', body: JSON.stringify({ fields: { wallet: { stringValue: d.wallet }, saves: { mapValue: { fields: sf } }, rev: { integerValue: String(d.rev) }, updated: { timestampValue: new Date().toISOString() } } }) });
  }
  const fsDel = uid => authed(DOC(uid), { method: 'DELETE' });
  // ---- merging
  function localSnap() { const saves = {}; SYNC_KEYS.forEach(k => { if (k !== TK_KEY) saves[k] = lsGet(k); }); return { wallet: lsGet(TK_KEY), saves }; }
  // local changes since `b` (what this device last synced) land on top of `c` (the cloud copy)
  function mergeWallet(c, l, b) {
    const o = JSON.parse(JSON.stringify(c));
    ['bal', 'earned', 'spent', 'runs', 'golden'].forEach(k => { o[k] = Math.max(0, (c[k] || 0) + (l[k] || 0) - (b[k] || 0)); });
    o.owned = Object.assign({}, c.owned); for (const k in l.owned) if (!o.owned[k]) o.owned[k] = l.owned[k];
    if (JSON.stringify(l.equip || {}) !== JSON.stringify(b.equip || {})) o.equip = l.equip || {};
    if (JSON.stringify(l.cheats || {}) !== JSON.stringify(b.cheats || {})) o.cheats = l.cheats || {};
    ['best', 'day', 'chal'].forEach(f => { o[f] = Object.assign({}, c[f]); for (const g in (l[f] || {})) if (!(g in o[f]) || l[f][g] > o[f][g]) o[f][g] = l[f][g]; });
    return o;
  }
  function mergeSaves(c, l, b, first) {
    const o = {}, v = (m, k) => (m && m[k] != null ? m[k] : null), done = {};
    if (first) GROUPS.forEach(g => {
      const pick = (g.score(l || {}) > g.score(c || {})) || !g.keys.some(k => v(c, k) != null) ? l : c;
      g.keys.forEach(k => { o[k] = v(pick, k); done[k] = 1; });
    });
    SYNC_KEYS.forEach(k => {
      if (k === TK_KEY || done[k]) return;
      const cv = v(c, k), lv = v(l, k);
      if (BEST_KEYS.indexOf(k) >= 0) { const n = Math.max(+cv || 0, +lv || 0); o[k] = n ? String(n) : (cv != null ? cv : lv); return; }
      if (first) {
        if (PROGRESS[k]) { const pc = pj(cv), pl = pj(lv); let a = 0, z = 0; try { a = pc ? PROGRESS[k](pc) : -1; z = pl ? PROGRESS[k](pl) : -1; } catch (e) { } o[k] = z > a ? lv : (cv != null ? cv : lv); }
        else o[k] = cv ? cv : lv;
        return;
      }
      o[k] = lv !== v(b, k) ? lv : cv;
    });
    return o;
  }
  const sameSaves = (a, b) => SYNC_KEYS.every(k => k === TK_KEY || ((a && a[k] != null ? a[k] : null) === (b && b[k] != null ? b[k] : null)));
  // ---- one sync: pull, merge, push, write back. Never overlaps itself.
  function sync() {
    if (!Acct.user) return Promise.resolve(false);
    if (Acct.busy) { Acct.again = true; return Acct.busy; }
    Acct.busy = (async () => {
      const uid = Acct.user.uid; let ok = false;
      setStatus('syncing');
      try {
        const cloud = (await fsGet(uid)) || { wallet: null, saves: {}, rev: 0 };
        const local = localSnap(), mine = lsGet(UID_KEY) === uid;
        const base = mine ? (pj(lsGet(BASE_KEY)) || { wallet: null, saves: {} }) : { wallet: null, saves: {} };
        const cw = pw(cloud.wallet), lw = pw(local.wallet);
        const mw = mergeWallet(cw, lw, pw(base.wallet));
        if (!mine && cloud.wallet) { if (Object.keys(cw.equip || {}).length) mw.equip = cw.equip; if (Object.keys(cw.cheats || {}).length) mw.cheats = cw.cheats; }
        const ms = mergeSaves(cloud.saves, local.saves, base.saves, !mine);
        const out = { wallet: JSON.stringify(mw), saves: ms, rev: (cloud.rev || 0) + 1 };
        if (out.wallet !== cloud.wallet || !sameSaves(ms, cloud.saves) || !cloud.rev) await fsPut(uid, out);
        // anything a game wrote while we were talking to the server goes on top of what we just saved
        const now = localSnap();
        let wNew = out.wallet, sNew = Object.assign({}, ms), late = false;
        if (now.wallet !== local.wallet) { wNew = JSON.stringify(mergeWallet(mw, pw(now.wallet), lw)); late = true; }
        SYNC_KEYS.forEach(k => { if (k !== TK_KEY && (now.saves[k] != null ? now.saves[k] : null) !== (local.saves[k] != null ? local.saves[k] : null)) { sNew[k] = now.saves[k]; late = true; } });
        const changed = wNew !== now.wallet || !sameSaves(sNew, now.saves);
        lsPut(TK_KEY, wNew); SYNC_KEYS.forEach(k => { if (k !== TK_KEY) lsPut(k, sNew[k]); });
        lsPut(UID_KEY, uid); lsPut(BASE_KEY, JSON.stringify({ wallet: out.wallet, saves: ms }));
        if (!mine) Acct.lastMerge = { added: lw.bal, prizes: Object.keys(lw.owned || {}).length, bal: pw(wNew).bal };
        if (changed) { tkFire(tkLoad()); try { window.dispatchEvent(new Event('nb-sync')); } catch (e) { } }
        if (late) Acct.again = true;
        ok = true; setStatus('synced');
      } catch (e) { Acct.err = String((e && e.message) || e); setStatus('error'); setTimeout(() => markDirty(10), 15000); }
      Acct.busy = null;
      if (Acct.again) { Acct.again = false; markDirty(300); }
      return ok;
    })();
    return Acct.busy;
  }
  // ---- the Firebase SDK, loaded only when someone signs in (or is signed in on this device)
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('SDK')); document.head.appendChild(s); }); }
  function initAuth() {
    if (Acct.init) return Acct.init;
    Acct.init = (async () => {
      if (!(window.firebase && window.firebase.auth)) { await loadScript(SDK_URL + 'firebase-app-compat.js'); await loadScript(SDK_URL + 'firebase-auth-compat.js'); }
      if (!firebase.apps.length) firebase.initializeApp(FBCFG);
      const auth = Acct.auth = firebase.auth();
      try { auth.useDeviceLanguage(); } catch (e) { }
      auth.onAuthStateChanged(u => { Acct.user = u || null; setStatus(u ? 'in' : 'out'); if (u) sync(); });
      auth.getRedirectResult().then(r => { if (r && r.user) afterSignIn(); }).catch(() => { });
      if (auth.isSignInWithEmailLink(location.href)) finishEmailLink();
      return auth;
    })().catch(e => { Acct.init = null; throw e; });
    return Acct.init;
  }
  function cleanUrl() { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { } }
  async function signOutClear() {
    try { if (Acct.auth) await Acct.auth.signOut(); } catch (e) { }
    SYNC_KEYS.forEach(k => lsPut(k, null)); lsPut(UID_KEY, null); lsPut(BASE_KEY, null);
    Acct.user = null; Acct.lastMerge = null; setStatus('out'); tkFire(tkLoad());
    try { window.dispatchEvent(new Event('nb-sync')); } catch (e) { }
  }
  function acctName() { const u = Acct.user; return u ? (u.email || u.displayName || 'PLAYER').toUpperCase() : ''; }
  // a signed-in device restores its session on every page; an emailed link completes here too
  setTimeout(() => { if (lsGet(UID_KEY) || /[?&](oobCode|nbsignin)=/.test(location.search)) initAuth().catch(() => { }); }, 0);

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
.nbs-tag{font-style:normal;font-size:13px;line-height:1;vertical-align:middle;margin-left:16px;padding:4px 6px 3px;border:2px solid #ff2bd6;color:#ff2bd6;background:#1a0630}
.nbs-li.me .nbs-tag{color:#0b0620;border-color:#0b0620;background:transparent}
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
.nbp-i b.off{color:#7d72b8}
.nbp-i em{font-style:normal;font-size:9px;color:#a99be0}
.nbs-in{font-size:24px;padding:16px 18px;width:760px;max-width:100%;background:#120a30;color:#fff;border:5px solid #3a2f78;text-align:center;text-transform:lowercase;-webkit-user-select:text;user-select:text}
.nbs-in:focus{outline:none;border-color:var(--nbc);box-shadow:0 0 18px var(--nbc)}
.nbs-fine{font-size:14px;color:#a99be0;line-height:1.9}
.nbs-fine a{color:#00e5ff}
.nbs-ok{font-size:18px;color:#5fe0b7;line-height:1.8}
.nbs-b.dis{opacity:.45}
.nbs-col{display:flex;flex-direction:column;gap:16px;align-items:center}
.nbs-col .nbs-b{min-width:620px}
#nbsP.portrait .nbs-col .nbs-b{min-width:560px}
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
    const inp = e.target && (e.target.id === 'nbsIn' || e.target.id === 'nbsMail');
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
    // ---- accounts
    acct: { signedIn: () => !!Acct.user, name: acctName, status: () => Acct.status, onChange: f => Acct.listeners.push(f), sync: () => sync() },
    // the sign-in / account screen. opt: { game, onClose, reason }
    account(opt) { opt = opt || {}; ensureDom(); open(opt.game); NB._st = { game: opt.game, onClose: opt.onClose, menu: true }; NB._mode = 'menu'; if (Acct.user) renderAccount(); else renderSignIn(opt.reason); },
    // a sign-in nudge if one is due (kind: 'buy'); returns false when there's nothing to show
    nudge(kind, opt) { opt = opt || {}; if (!nudgeFor(kind)) return false; ensureDom(); open(opt.game); NB._st = { game: opt.game, onClose: opt.onClose, menu: true }; NB._mode = 'menu'; renderNudge(kind); return true; },

    // After every run: name entry -> post -> board. onClose fires when the player continues.
    submit(opt) {
      const game = opt.game, score = Math.max(0, Math.floor(+opt.score || 0));
      ensureDom(); open(game);
      let last = ''; try { last = clean(localStorage.getItem(NAME_KEY)); } catch (e) { }
      const chars = (last || '').padEnd(NAME_LEN, ' ').split('');
      // last name used on this device is pre-filled; typing a new letter first replaces it
      const st = { game, score, chars, cur: 0, onClose: opt.onClose, err: '', fresh: !!last, tk: opt.tickets !== false, feats: opt.feats || [], stats: opt.stats || {}, cheat: Tickets.tagged(game) };
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
      if (NB._mode === 'menu') return actMenu(a);
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
    post(st.game, st.name, st.score, st.cheat).then(id => {
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
    return '<div class="nbs-li' + (r.id === st.myId ? ' me' : i < 3 ? ' r' + (i + 1) : '') + '"><span>' + (i + 1) + '.</span><span>' + esc(r.name) + (r.cheat ? '<i class="nbs-tag" title="CHEAT CODE ON">CHEAT</i>' : '') + '</span><span>' + fmt(r.score) + '</span></div>';
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
      if (!items.length) return;
      const last = rows[rows.length - 1];
      if (last && last.title === slots[sl]) last.items = last.items.concat(items); else rows.push({ title: slots[sl], items });
    });
    const perks = Tickets.cheatsFor(game).filter(i => i.perk && w.owned[i.id]);
    if (perks.length) rows.push({ title: 'LOADOUT (TAGS YOUR SCORE)', items: perks });
    const codes = Tickets.cheatsFor(game).filter(i => !i.perk && w.owned[i.id]);
    if (codes.length) rows.push({ title: 'CHEAT CODES', items: codes });
    return rows;
  }
  function renderPrizes() {
    const st = NB._st, g = GAMES[st.game] || { title: '' }, rows = prizeRows(st.game), eq = Tickets.equipped(st.game);
    const isOn = i => i.cheat ? Tickets.cheatOn(st.game, i.id.split('.')[2]) : eq[i.slot] === i.id;
    st.flat = []; rows.forEach(r => r.items.forEach(i => st.flat.push(i)));
    if (st.foc > st.flat.length) st.foc = st.flat.length;
    let n = 0;
    const body = rows.length ? rows.map(r => '<div class="nbp-row"><div class="nbp-t">' + r.title + '</div><div class="nbp-items">' +
      r.items.map(i => '<button class="nbp-i nbp-c' + (isOn(i) ? ' on' : '') + '" data-k="' + (n++) + '"><canvas width="16" height="16" data-icon="' + i.id + '"></canvas><span>' + esc(i.name) + '</span>' + (i.note ? '<em>' + esc(i.note) + '</em>' : '') + (i.cheat ? '<b class="' + (isOn(i) ? '' : 'off') + '">' + (isOn(i) ? 'ON' : 'OFF') + '</b>' : isOn(i) ? '<b>EQUIPPED</b>' : '') + '</button>').join('') +
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
    const it = st.flat[st.foc];
    if (it.cheat) { const on = Tickets.cheatOn(st.game, it.id.split('.')[2]); Tickets.setCheat(it.id, !on); blip(on ? 420 : 880, 0.07); return renderPrizes(); }
    const cur = Tickets.equipped(st.game, it.slot);
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
    try { q = Tickets.quote(st.game, st.score, st.ranks, st.feats, st.cheat, st.stats); } catch (e) { st.tk = false; return close(); }
    const before = Tickets.balance();
    Tickets.payRun(st.game, st.score, q, st.cheat);
    const gold = q.lines.some(l => l.gold);
    st.tq = { q, before, shown: 0, line: 0, t0: performance.now(), done: false };
    NB._mode = 'tickets';
    panel.innerHTML =
      '<div class="nbs-k">' + esc((GAMES[st.game] || {}).title || '') + '</div>' +
      '<div class="nbs-h">TICKETS!</div>' +
      '<div class="nbt-wrap"><div class="nbt-mach"><div class="nbt-slot"></div><div class="nbt-strip' + (gold ? ' gold' : '') + '"></div></div>' +
      '<div class="nbt-side"><div class="nbt-count">0</div><div class="nbt-lines">' +
      q.lines.map(l => '<div class="nbt-l' + (l.gold ? ' gold' : '') + '"><span>' + esc(l.t) + '</span><b>+' + fmt(l.n) + '</b></div>').join('') +
      '</div><div class="nbt-bal">' + (Acct.user ? 'TICKETS IN YOUR ACCOUNT: ' : 'TICKETS ON THIS DEVICE: ') + fmt(before) + '</div></div></div>' +
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
    const bal = panel.querySelector('.nbt-bal'); if (bal) bal.textContent = (Acct.user ? 'TICKETS IN YOUR ACCOUNT: ' : 'TICKETS ON THIS DEVICE: ') + fmt(tq.before + tq.q.total);
    const b = panel.querySelector('[data-c]'); if (b) b.textContent = 'CONTINUE';
    tkSound('done');
  }
  function actTickets(a) {
    const st = NB._st; if (!st || !st.tq) return;
    if (!(a === 'a' || a === 'start' || a === 'b')) return;
    if (!st.tq.done) return tkFinish();
    if (nudgeFor('payout')) return renderNudge('payout');
    close();
  }

  // ---------------------------------------------------------------- account screens (sign in, email link, account, nudges)
  // A small menu renderer: kicker, title, message, optional extra html, buttons. Arrows / D-pad move, Cross / Enter press, Circle / Esc back.
  function renderMenu(o) {
    const st = NB._st; NB._mode = 'menu';
    st.btns = o.buttons; st.back = o.back || close; st.live = o.live || null; st.foc = o.foc || 0;
    panel.innerHTML = '<div class="nbs-k">' + (o.kicker || 'NEON BREAD ARCADE') + '</div><div class="nbs-h">' + o.title + '</div>' +
      (o.msg ? '<div class="nbs-m">' + o.msg + '</div>' : '') + (o.extra || '') +
      '<div class="nbs-col">' + o.buttons.map((b, i) => '<button class="nbs-b' + (b.alt ? ' alt' : '') + (b.dis ? ' dis' : '') + '" data-k="' + i + '">' + b.label + '</button>').join('') + '</div>' +
      (o.fine ? '<div class="nbs-fine">' + o.fine + '</div>' : '') +
      '<div class="nbs-hint">' + (dev() === 'pad' ? '&#9650;&#9660; PICK &middot; ' + P('CROSS', 'A') + ' PRESS &middot; ' + P('CIRCLE', 'B') + ' BACK' : dev() === 'touch' ? '' : '&#9650;&#9660; PICK &middot; ENTER PRESS &middot; ESC BACK') + '</div>';
    panel.querySelectorAll('.nbs-b').forEach(b => b.onclick = () => { st.foc = +b.dataset.k; menuPress(); });
    const fine = panel.querySelector('.nbs-fine a'); if (fine) fine.onclick = e => { e.preventDefault(); window.open(fine.href, '_blank', 'noopener'); };
    const inp = panel.querySelector('#nbsMail');
    if (inp) { inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); menuPress(o.enterBtn || 0); } }); setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }, 60); }
    paintMenu(); fit();
  }
  function paintMenu() { const st = NB._st; panel.querySelectorAll('.nbs-col .nbs-b').forEach(b => b.classList.toggle('sel', +b.dataset.k === st.foc)); }
  function menuPress(i) { const st = NB._st; if (i != null) st.foc = i; const b = st.btns && st.btns[st.foc]; if (!b || b.dis) { blip(200, 0.08); return; } blip(880, 0.05); b.fn(); }
  function actMenu(a) {
    const st = NB._st; if (!st || !st.btns) return;
    const n = st.btns.length;
    if (a === 'up' || a === 'left') { st.foc = (st.foc + n - 1) % n; paintMenu(); blip(520, 0.04); }
    if (a === 'down' || a === 'right' || a === 'tab') { st.foc = (st.foc + 1) % n; paintMenu(); blip(520, 0.04); }
    if (a === 'a' || a === 'start') menuPress();
    if (a === 'b') st.back();
  }
  const FINE = 'YOU MUST BE 13 OR OLDER TO SIGN IN. PLAYING NEVER NEEDS AN ACCOUNT.<br><a href="' + ARCADE_URL + 'privacy/">PRIVACY</a>';
  const AUTH_ERR = {
    'auth/operation-not-allowed': "SIGN-IN ISN'T SWITCHED ON YET. TRY AGAIN LATER.", 'auth/unauthorized-domain': "THIS SITE ISN'T ALLOWED TO SIGN IN YET.",
    'auth/network-request-failed': 'NO CONNECTION. CHECK YOUR INTERNET AND TRY AGAIN.', 'auth/invalid-email': "THAT EMAIL DOESN'T LOOK RIGHT.",
    'auth/invalid-action-code': 'THAT LINK EXPIRED OR WAS ALREADY USED. ASK FOR A NEW ONE.', 'auth/expired-action-code': 'THAT LINK EXPIRED. ASK FOR A NEW ONE.',
    'auth/too-many-requests': 'TOO MANY TRIES. WAIT A FEW MINUTES.', 'auth/user-disabled': 'THIS ACCOUNT IS SWITCHED OFF.',
  };
  const authErr = e => AUTH_ERR[e && e.code] || 'SOMETHING WENT WRONG. TRY AGAIN.';
  function renderSignIn(reason, err) {
    const ready = !!Acct.auth;
    if (!ready) initAuth().then(() => { if (NB._mode === 'menu' && NB._st && NB._st.signin) renderSignIn(reason, err); }).catch(() => { if (NB._mode === 'menu' && NB._st && NB._st.signin) renderSignIn(reason, 'NO CONNECTION. CHECK YOUR INTERNET AND TRY AGAIN.'); });
    NB._st.signin = true;
    renderMenu({ title: 'SAVE YOUR STUFF', msg: reason || 'SIGN IN TO KEEP YOUR TICKETS, PRIZES AND GAME PROGRESS ON EVERY DEVICE.',
      extra: err ? '<div class="nbs-e">' + err + '</div>' : '',
      buttons: [{ label: ready ? 'SIGN IN WITH GOOGLE' : 'LOADING...', dis: !ready, fn: googleSignIn }, { label: 'EMAIL ME A LINK', alt: true, dis: !ready, fn: renderEmail }, { label: 'NOT NOW', alt: true, fn: close }],
      fine: FINE });
  }
  function googleSignIn() {
    const auth = Acct.auth; if (!auth) return;
    const pv = new firebase.auth.GoogleAuthProvider(); pv.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(pv).then(afterSignIn).catch(e => {
      const c = e && e.code;
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') { auth.signInWithRedirect(pv).catch(e2 => renderSignIn(null, authErr(e2))); return; }
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      renderSignIn(null, authErr(e));
    });
  }
  function renderEmail(err, val) {
    NB._st.signin = false;
    renderMenu({ title: 'EMAIL ME A LINK', msg: "TYPE YOUR EMAIL. WE'LL SEND A LINK. OPEN IT ON THIS DEVICE TO SIGN IN. NO PASSWORD.",
      extra: '<input id="nbsMail" class="nbs-in" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="' + esc(val || '') + '">' + (err ? '<div class="nbs-e">' + err + '</div>' : ''),
      buttons: [{ label: 'SEND THE LINK', fn: sendLink }, { label: 'BACK', alt: true, fn: () => renderSignIn() }], back: () => renderSignIn(), fine: FINE });
  }
  function sendLink() {
    const inp = panel.querySelector('#nbsMail'), email = ((inp && inp.value) || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return renderEmail("THAT EMAIL DOESN'T LOOK RIGHT.", email);
    renderMenu({ title: 'SENDING...', msg: email.toUpperCase(), buttons: [{ label: 'WAIT', dis: true, fn: () => { } }] });
    Acct.auth.sendSignInLinkToEmail(email, { url: ARCADE_URL + '?nbsignin=1', handleCodeInApp: true }).then(() => {
      lsPut(PEND_KEY, email);
      renderMenu({ title: 'CHECK YOUR EMAIL', msg: 'WE SENT A SIGN-IN LINK TO<br>' + esc(email.toUpperCase()) + '<br><br>OPEN IT ON THIS DEVICE. IT CAN TAKE A MINUTE, AND IT MIGHT LAND IN SPAM.', buttons: [{ label: 'OK', fn: close }] });
    }).catch(e => renderEmail(authErr(e), email));
  }
  // the emailed link brings the player back to the arcade with a code in the address
  function finishEmailLink() {
    const email = lsGet(PEND_KEY);
    if (email) return completeLink(email);
    ensureDom(); open(null); NB._st = { menu: true }; NB._mode = 'menu';
    const ask = err => renderMenu({ title: 'ALMOST IN', msg: 'TYPE THE EMAIL THE LINK WAS SENT TO.', extra: '<input id="nbsMail" class="nbs-in" type="email" inputmode="email" autocomplete="email">' + (err ? '<div class="nbs-e">' + err + '</div>' : ''),
      buttons: [{ label: 'SIGN IN', fn: () => { const v = (panel.querySelector('#nbsMail').value || '').trim(); if (!v) return ask("THAT EMAIL DOESN'T LOOK RIGHT."); completeLink(v); } }, { label: 'CANCEL', alt: true, fn: () => { cleanUrl(); close(); } }], back: () => { cleanUrl(); close(); } });
    ask();
  }
  function completeLink(email) {
    if (!NB.active) { ensureDom(); open(null); NB._st = { menu: true }; NB._mode = 'menu'; }
    renderMenu({ title: 'SIGNING IN...', msg: esc(email.toUpperCase()), buttons: [{ label: 'WAIT', dis: true, fn: () => { } }] });
    Acct.auth.signInWithEmailLink(email, location.href).then(() => { lsPut(PEND_KEY, null); cleanUrl(); afterSignIn(); })
      .catch(e => { cleanUrl(); renderMenu({ title: "COULDN'T SIGN IN", msg: authErr(e), buttons: [{ label: 'OK', fn: close }] }); });
  }
  // right after signing in: wait for the first sync, then show what happened
  async function afterSignIn() {
    if (!NB.active) { ensureDom(); open(null); NB._st = { menu: true }; NB._mode = 'menu'; }
    renderMenu({ title: 'SIGNED IN', msg: 'SAVING YOUR STUFF...', buttons: [{ label: 'WAIT', dis: true, fn: () => { } }] });
    for (let i = 0; i < 40 && !Acct.user; i++) await new Promise(r => setTimeout(r, 100));
    await sync();
    if (NB._mode === 'menu') renderAccount(true);
  }
  function renderAccount(welcome) {
    const m = Acct.lastMerge, w = tkLoad();
    const stat = () => Acct.status === 'syncing' ? 'SAVING...' : Acct.status === 'error' ? "COULDN'T REACH THE SERVER. WE'LL KEEP TRYING." : 'EVERYTHING IS SAVED TO YOUR ACCOUNT.';
    const msg = esc(acctName()) + '<br><br>TICKETS: ' + fmt(w.bal) + ' &middot; PRIZES: ' + Object.keys(w.owned || {}).length;
    const extra = (welcome && m && (m.added || m.prizes) ? '<div class="nbs-ok">ADDED ' + fmt(m.added) + ' TICKETS' + (m.prizes ? ' AND ' + m.prizes + ' PRIZES' : '') + ' FROM THIS DEVICE.</div>' : '') +
      '<div class="nbs-fine" id="nbsStat">' + stat() + '</div>';
    renderMenu({ title: welcome ? "YOU'RE IN" : 'YOUR ACCOUNT', msg, extra,
      buttons: [{ label: 'DONE', fn: close }, { label: 'SIGN OUT', alt: true, fn: confirmSignOut }, { label: 'DELETE MY ACCOUNT', alt: true, fn: confirmDelete }],
      live: () => { const e = panel.querySelector('#nbsStat'); if (e) e.textContent = stat(); } });
  }
  function confirmSignOut() {
    renderMenu({ title: 'SIGN OUT?', msg: 'YOUR STUFF STAYS SAVED IN YOUR ACCOUNT.<br>THIS DEVICE GETS CLEARED UNTIL YOU SIGN IN AGAIN.', foc: 1,
      buttons: [{ label: 'SIGN OUT', fn: async () => {
        renderMenu({ title: 'SIGNING OUT...', msg: 'SAVING FIRST.', buttons: [{ label: 'WAIT', dis: true, fn: () => { } }] });
        const ok = await sync();
        const go = async () => { await signOutClear(); renderMenu({ title: 'SIGNED OUT', msg: 'SEE YOU NEXT TIME.', buttons: [{ label: 'OK', fn: close }] }); };
        if (ok) return go();
        renderMenu({ title: "COULDN'T SAVE", msg: "WE COULDN'T REACH THE SERVER, SO YOUR NEWEST TICKETS MIGHT NOT BE SAVED.<br>SIGN OUT ANYWAY?", foc: 1, buttons: [{ label: 'SIGN OUT ANYWAY', fn: go }, { label: 'STAY SIGNED IN', alt: true, fn: () => renderAccount() }], back: () => renderAccount() });
      } }, { label: 'STAY SIGNED IN', alt: true, fn: () => renderAccount() }], back: () => renderAccount() });
  }
  function confirmDelete() {
    renderMenu({ title: 'DELETE YOUR ACCOUNT?', msg: 'THIS ERASES YOUR SAVED TICKETS, PRIZES AND GAME PROGRESS FROM OUR SERVERS AND CLEARS THIS DEVICE.<br>SCORES ALREADY ON THE LEADERBOARDS STAY UP.', foc: 1,
      buttons: [{ label: 'DELETE IT', fn: async () => {
        renderMenu({ title: 'DELETING...', msg: '', buttons: [{ label: 'WAIT', dis: true, fn: () => { } }] });
        const u = Acct.user; let note = '';
        try { await fsDel(u.uid); } catch (e) { return renderMenu({ title: "COULDN'T DELETE", msg: 'NO CONNECTION. NOTHING WAS DELETED. TRY AGAIN.', buttons: [{ label: 'OK', fn: () => renderAccount() }] }); }
        try { await u.delete(); } catch (e) { note = (e && e.code) === 'auth/requires-recent-login' ? '<br><br>YOUR SAVED STUFF IS GONE. TO REMOVE THE SIGN-IN ITSELF, SIGN IN AGAIN AND DELETE ONCE MORE.' : ''; }
        await signOutClear();
        renderMenu({ title: 'ACCOUNT DELETED', msg: 'YOUR SAVED TICKETS, PRIZES AND PROGRESS ARE ERASED.' + note, buttons: [{ label: 'OK', fn: close }] });
      } }, { label: 'KEEP IT', alt: true, fn: () => renderAccount() }], back: () => renderAccount() });
  }
  // ---- nudges: after a ticket payout (once a day, plus once each at 500 / 2,000 / 10,000 tickets) and after the first prize
  const NUDGE_TH = [10000, 2000, 500];
  function nudgeFor(kind) {
    if (Acct.user || lsGet(UID_KEY)) return null;          // signed in (or a signed-in device still waking up)
    const w = tkLoad();
    if (kind === 'payout') {
      if (w.bal <= 0) return null;
      const th = NUDGE_TH.find(t => w.bal >= t) || 0;
      if (th > (+lsGet('nb_nudge_th') || 0)) { lsPut('nb_nudge_th', String(th)); lsPut('nb_nudge_day', pacificDay()); return 'th'; }
      if (lsGet('nb_nudge_day') !== pacificDay()) { lsPut('nb_nudge_day', pacificDay()); return 'day'; }
      return null;
    }
    if (kind === 'buy') { if (lsGet('nb_nudge_buy')) return null; lsPut('nb_nudge_buy', '1'); return 'buy'; }
    return null;
  }
  function renderNudge(kind) {
    const w = tkLoad(), buy = kind === 'buy';
    initAuth().catch(() => { });           // warm up the SDK so the Google popup isn't blocked
    renderMenu({ title: buy ? "DON'T LOSE IT" : 'SAVE YOUR ' + fmt(w.bal) + ' TICKETS?',
      msg: buy ? 'YOUR PRIZES ONLY LIVE ON THIS DEVICE.<br>SIGN IN TO KEEP THEM ON EVERY DEVICE.' : "RIGHT NOW THEY ONLY LIVE ON THIS DEVICE.<br>CLEAR YOUR BROWSER AND THEY'RE GONE.",
      buttons: [{ label: 'SIGN IN', fn: () => renderSignIn() }, { label: 'NOT NOW', alt: true, fn: close }], fine: FINE });
  }
})();
/* NB-SCORES END */
