/*
 * game.js — game state, user interface and interaction.
 *
 * Model
 *   state.ornaments : [{ id, kind: 'ball' | 'bubu', variant, x, y }]
 *   state.strands   : [{ id, colors: [lightKey...], bulbs: [{ x, y }] }]
 *   state.topper    : null | 'star' | 'bubu'
 *   state.lightMode : one of LIGHT_MODES
 * Settings (not part of undo): room lights, snow, Bubu unlocked.
 *
 * Nothing is stored between page loads on purpose: a refresh gives a fresh tree
 * and a closed surprise gift, so every class can discover Bubu.
 */
(function () {
  'use strict';

  const BUBU_SRC = 'assets/bubu.webp';
  const BULB_SPACING = 34;      // distance between bulbs in a garland (SVG units)
  const SHIMMER_EVERY = 1900;   // ms between ornament twinkles while the room is dark
  const MAX_HISTORY = 60;

  // ------------------------------------------------------------ texts (RO)
  const BALL_LABELS = {
    red: 'Roșu', gold: 'Auriu', blue: 'Albastru', silver: 'Argintiu',
    purple: 'Mov', pink: 'Roz', orange: 'Portocaliu', white: 'Alb',
    stripes: 'Cu dungi', dots: 'Cu buline', snowflake: 'Fulg de nea', star: 'Cu steluță'
  };
  const BUBU_LABELS = {
    'bubu-red': 'Bubu pe roșu', 'bubu-hat': 'Bubu cu căciulă', 'bubu-green': 'Bubu pe verde',
    'bubu-blue': 'Bubu pe albastru', 'bubu-gold': 'Bubu pe auriu'
  };
  // Simple colour choices for the lights (big buttons, easy for small children).
  const PRESETS = [
    { id: 'rainbow', name: 'Curcubeu', colors: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] },
    { id: 'classic', name: 'Roșu și verde', colors: ['red', 'green'] },
    { id: 'frost', name: 'Albastru și alb', colors: ['blue', 'white'] },
    { id: 'warm', name: 'Galben și roșu', colors: ['yellow', 'red'] },
    { id: 'candy', name: 'Roz și mov', colors: ['pink', 'purple'] },
    { id: 'gold', name: 'Aurii', colors: ['yellow'] },
    { id: 'red', name: 'Roșii', colors: ['red'] },
    // Warm white: the most popular (best-selling) Christmas light colour right now.
    { id: 'warmwhite', name: 'Alb cald', colors: ['white'] }
  ];
  const LIGHT_MODES = [
    { id: 'steady', name: 'Mereu aprinse', icon: '●' },
    { id: 'flash', name: 'Intermitent', icon: '◉' },
    { id: 'blink', name: 'Pe sărite', icon: '◐' },
    { id: 'sequence', name: 'Pe rând', icon: '⋯' },
    { id: 'chase', name: 'Valuri', icon: '〰' },
    { id: 'twinkle', name: 'Sclipesc', icon: '✦' },
    { id: 'breathe', name: 'Respiră', icon: '◌' },
    { id: 'rainbow', name: 'Culori magice', icon: '🌈' }
  ];
  const MSG = {
    onTree: 'Pune pe brad! 🎄',
    chooseTopper: 'Alege steaua sau pe Bubu din listă ⭐',
    moved: 'Ai mutat globul!',
    nothingToUndo: 'Nu mai avem ce da înapoi',
    recolored: 'Ghirlanda are culori noi! 🌈',
    photoSaved: 'Poza a fost salvată! 📷',
    photoFailed: 'Nu am putut salva poza 😕',
    roomDark: 'S-a stins lumina! 🌙',
    roomLight: 'S-a aprins lumina! ☀️'
  };

  // ------------------------------------------------------------ state
  const freshState = () => ({ ornaments: [], strands: [], topper: null, lightMode: 'steady', nextId: 1 });
  let state = freshState();
  const settings = { dark: false, snow: true, unlocked: false };
  const tool = { cat: 'balls', ball: 'red', bubu: 'bubu-red', palette: 'rainbow', topper: 'star' };
  const history = [];

  let layers = null;
  let bubuDataUrl = null;     // embedded copy of Bubu, used when exporting the photo
  let gesture = null;         // current pointer gesture on the tree

  // ------------------------------------------------------------ DOM
  const $ = id => document.getElementById(id);
  const app = $('app');
  const svg = $('tree');
  const paletteEl = $('palette');

  // ------------------------------------------------------------ history (undo)
  function pushHistory() {
    history.push(JSON.stringify(state));
    if (history.length > MAX_HISTORY) history.shift();
    updateUndoButton();
  }

  function undo() {
    if (!history.length) { toast(MSG.nothingToUndo); return; }
    state = JSON.parse(history.pop());
    renderAll();

    commit(false);
  }

  function updateUndoButton() { $('btnUndo').disabled = history.length === 0; }

  /** Called after every change: update counters and the undo button. */
  function commit(push) {
    if (push) pushHistory();
    updateCounters();
    updateUndoButton();
  }

  // ------------------------------------------------------------ helpers
  function svgPoint(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 1700);
  }

  /** Colour pattern for a new garland, from the selected colour button. */
  function currentColors() {
    const preset = PRESETS.find(x => x.id === tool.palette) || PRESETS[0];
    return preset.colors.slice();
  }

  function totalBulbs() { return state.strands.reduce((n, s) => n + s.bulbs.length, 0); }

  // ------------------------------------------------------------ rendering
  function renderAll() {
    layers.ornaments.innerHTML = '';
    layers.wires.innerHTML = '';
    layers.bulbs.innerHTML = '';
    state.ornaments.forEach(o => {
      const n = Scene.ornamentNode(o, BUBU_SRC);
      n.classList.add('no-pop');
      layers.ornaments.appendChild(n);
    });
    let idx = 0;
    state.strands.forEach(s => { Scene.renderStrand(layers, s, idx); idx += s.bulbs.length; });
    Scene.renderTopper(layers.topper, state.topper, BUBU_SRC);
    const tb = layers.topper.querySelector('.pop-big');
    if (tb) tb.classList.remove('pop-big');
    applyLightMode();
    updateCounters();
  }

  /** Re-render a single strand, animating bulbs from index `from` on. */
  function renderStrand(strand, from) {
    let start = 0;
    for (const s of state.strands) { if (s === strand) break; start += s.bulbs.length; }
    Scene.renderStrand(layers, strand, start, from);
    if (from != null) {
      // Stagger the "pop in" of new bulbs so long garlands light up one by one.
      layers.bulbs.querySelectorAll(`.strand[data-strand="${strand.id}"] .bulb.is-new`).forEach((b, i) => {
        b.style.animationDelay = (i * 35) + 'ms';
      });
    }
  }

  function applyLightMode() {
    LIGHT_MODES.forEach(m => svg.classList.toggle('mode-' + m.id, state.lightMode === m.id));
  }

  function updateCounters() {
    const balls = state.ornaments.filter(o => o.kind === 'ball').length;
    const bubus = state.ornaments.filter(o => o.kind === 'bubu').length;
    bump($('cntBalls'), balls);
    bump($('cntBulbs'), totalBulbs());
    bump($('cntBubu'), bubus);
    $('counterBubu').hidden = !settings.unlocked;
  }

  /** Update a counter and make it "jump" when the number changes. */
  function bump(el, value) {
    if (el.textContent === String(value)) return;
    el.textContent = value;
    el.classList.remove('bump');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('bump');
  }

  // ------------------------------------------------------------ actions on the tree
  function addOrnament(kind, variant, x, y) {
    pushHistory();
    const o = { id: state.nextId++, kind, variant, x, y };
    state.ornaments.push(o);
    layers.ornaments.appendChild(Scene.ornamentNode(o, BUBU_SRC));
    Scene.sparkle(layers.fx, x, y + Scene.BALL_CENTER, kind === 'bubu' ? '#ff8a80' : '#fff59d');

    commit(false);
  }

  function removeOrnament(id) {
    const i = state.ornaments.findIndex(o => o.id === id);
    if (i < 0) return;
    pushHistory();
    const o = state.ornaments[i];
    state.ornaments.splice(i, 1);
    const node = layers.ornaments.querySelector(`[data-id="${id}"]`);
    if (node) { node.classList.add('is-leaving'); setTimeout(() => node.remove(), 260); }
    Scene.sparkle(layers.fx, o.x, o.y + Scene.BALL_CENTER, '#ffffff');

    commit(false);
  }

  function removeStrand(id) {
    const i = state.strands.findIndex(s => s.id === id);
    if (i < 0) return;
    pushHistory();
    const s = state.strands[i];
    state.strands.splice(i, 1);
    Scene.removeStrand(layers, id);
    const mid = s.bulbs[Math.floor(s.bulbs.length / 2)];
    if (mid) Scene.sparkle(layers.fx, mid.x, mid.y, '#ffffff');

    renderAll(); // keeps the "chase" animation order continuous
    commit(false);
  }

  function recolorStrand(id) {
    const s = state.strands.find(x => x.id === id);
    if (!s) return;
    pushHistory();
    s.colors = currentColors();
    renderStrand(s);
    const mid = s.bulbs[Math.floor(s.bulbs.length / 2)];
    Scene.sparkle(layers.fx, mid.x, mid.y, '#ffffff');

    toast(MSG.recolored);
    commit(false);
  }

  function setTopper(kind) {
    if (state.topper === kind) {
      Scene.sparkle(layers.fx, Scene.TOPPER.x, Scene.TOPPER.y, kind === 'bubu' ? '#ff8a80' : '#fff59d');
      return;
    }
    pushHistory();
    state.topper = kind;
    Scene.renderTopper(layers.topper, kind, BUBU_SRC);
    if (kind) Scene.sparkle(layers.fx, Scene.TOPPER.x, Scene.TOPPER.y, kind === 'bubu' ? '#ff8a80' : '#fff59d');
    commit(false);
    renderPalette();
  }

  /** Automatically add swag-shaped garlands across the whole tree. */
  function magicGarland() {
    pushHistory();
    const rows = [
      { y: 120, slope: 26, sag: 20 },
      { y: 222, slope: 30, sag: 26 },
      { y: 330, slope: 34, sag: 30 },
      { y: 436, slope: 38, sag: 34 },
      { y: 540, slope: 40, sag: 36 }
    ];
    let delay = 0;
    rows.forEach((r, k) => {
      const hw = Scene.halfWidthAt(r.y + r.slope / 2) * 0.92;
      const leftToRight = k % 2 === 0;
      const xa = Scene.CX - hw, xb = Scene.CX + hw;
      const pts = [];
      const n = Math.max(2, Math.round((xb - xa) / (BULB_SPACING * 0.95)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = xa + (xb - xa) * t;
        const y = r.y + (leftToRight ? t : 1 - t) * r.slope + Math.sin(Math.PI * t) * r.sag;
        if (Scene.isOnTree(x, y, 6)) pts.push({ x, y });
      }
      if (pts.length < 2) return;
      if (!leftToRight) pts.reverse();
      const strand = { id: state.nextId++, colors: currentColors(), bulbs: pts };
      state.strands.push(strand);
      setTimeout(() => {
        renderStrand(strand, 0);
      }, delay);
      delay += 450;
    });
    setTimeout(() => renderAll(), delay + 600);
    commit(false);
  }

  function clearKind(kind) {
    if (kind === 'lights' && !state.strands.length) return;
    if (kind === 'ornaments' && !state.ornaments.length) return;
    pushHistory();
    if (kind === 'lights') state.strands = [];
    else state.ornaments = [];
    renderAll();

    commit(false);
  }

  // ------------------------------------------------------------ pointer interaction
  function findTarget(el) {
    if (!el || !el.closest) return null;
    const orn = el.closest('.ornament');
    if (orn) return { type: 'ornament', id: +orn.dataset.id, node: orn };
    const bulb = el.closest('.bulb');
    if (bulb) return { type: 'bulb', id: +bulb.dataset.strand };
    const wire = el.closest('.wire');
    if (wire) return { type: 'bulb', id: +wire.dataset.strand };
    if (el.closest('.topper')) return { type: 'topper' };
    if (el.closest('#surpriseGift')) return { type: 'gift' };
    return null;
  }

  function eraseTarget(t) {
    if (!t) return false;
    if (t.type === 'ornament') { removeOrnament(t.id); return true; }
    if (t.type === 'bulb') { removeStrand(t.id); return true; }
    if (t.type === 'topper') { setTopper(null); return true; }
    return false;
  }

  function onPointerDown(e) {
    if (e.button > 0) return;
    const p = svgPoint(e);
    const target = findTarget(e.target);
    gesture = null;

    // The surprise gift works with any tool.
    if (target && target.type === 'gift') { onGiftTap(); return; }

    const cat = tool.cat;
    if (cat === 'eraser') {
      eraseTarget(target);
      gesture = { type: 'erase' };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // Grab an ornament to move it (any tool except the eraser).
    if (target && target.type === 'ornament') {
      const o = state.ornaments.find(x => x.id === target.id);
      if (!o) return;
      gesture = { type: 'drag', o, node: target.node, dx: o.x - p.x, dy: o.y - p.y, from: { x: o.x, y: o.y }, moved: false, before: JSON.stringify(state) };
      target.node.classList.add('is-dragging');
      layers.ornaments.appendChild(target.node); // bring to front
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (cat === 'toppers') {
      if (Math.hypot(p.x - Scene.TOPPER.x, p.y - Scene.TOPPER.y) < 120) setTopper(tool.topper || 'star');
      else { toast(MSG.chooseTopper); }
      return;
    }

    if (cat === 'lights') {
      if (target && target.type === 'bulb') {
        // Tap = recolour that garland; drag = start a new garland from here.
        gesture = { type: 'bulbTap', strandId: target.id, start: { x: p.x, y: p.y } };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (!Scene.isOnTree(p.x, p.y)) { toast(MSG.onTree); return; }
      startGarland(p);
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (cat === 'balls' || cat === 'bubu') {
      if (target && target.type === 'topper') return;
      // Ornaments hang from the hook: place the hook a bit above the finger.
      // The finger marks the middle of the ornament; its hook goes above.
      const y = p.y - Scene.BALL_CENTER;
      if (!Scene.isOnTree(p.x, p.y, 6)) { toast(MSG.onTree); return; }
      addOrnament(cat === 'bubu' ? 'bubu' : 'ball', cat === 'bubu' ? tool.bubu : tool.ball, p.x, y);
    }
  }

  /** Begin drawing a new garland at point p. */
  function startGarland(p) {
    pushHistory();
    const strand = { id: state.nextId++, colors: currentColors(), bulbs: [{ x: p.x, y: p.y }] };
    state.strands.push(strand);
    renderStrand(strand, 0);
    gesture = { type: 'garland', strand, colors: strand.colors, last: { x: p.x, y: p.y } };
  }

  function onPointerMove(e) {
    if (!gesture) return;
    const p = svgPoint(e);

    if (gesture.type === 'bulbTap') {
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 12) {
        const s = gesture.start;
        if (Scene.isOnTree(s.x, s.y, 4)) startGarland(s);
        else gesture = null;
      }
      if (!gesture || gesture.type !== 'garland') return;
    }

    if (gesture.type === 'drag') {
      const o = gesture.o;
      o.x = p.x + gesture.dx;
      o.y = p.y + gesture.dy;
      gesture.moved = gesture.moved || Math.hypot(o.x - gesture.from.x, o.y - gesture.from.y) > 4;
      gesture.node.setAttribute('transform', Scene.ornamentTransform(o));
      gesture.node.classList.toggle('is-off-tree', !Scene.isOnTree(o.x, o.y + Scene.BALL_CENTER, 6));
      return;
    }

    if (gesture.type === 'erase') {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const t = findTarget(el);
      if (t && t.type !== 'gift') eraseTarget(t);
      return;
    }

    if (gesture.type === 'garland') {
      // Add bulbs at a fixed spacing along the finger's path.
      let d = Math.hypot(p.x - gesture.last.x, p.y - gesture.last.y);
      let added = false;
      while (d >= BULB_SPACING) {
        const t = BULB_SPACING / d;
        const nx = gesture.last.x + (p.x - gesture.last.x) * t;
        const ny = gesture.last.y + (p.y - gesture.last.y) * t;
        gesture.last = { x: nx, y: ny };
        if (Scene.isOnTree(nx, ny, 4)) {
          if (!gesture.strand) {
            // Finger came back onto the tree: start a new piece of garland.
            gesture.strand = { id: state.nextId++, colors: gesture.colors, bulbs: [] };
            state.strands.push(gesture.strand);
          }
          gesture.strand.bulbs.push({ x: nx, y: ny });

          added = true;
        } else if (gesture.strand) {
          // Left the tree: finish this piece, keep the same colours for the next one.
          gesture.colors = gesture.strand.colors;
          gesture.strand = null;
        }
        d = Math.hypot(p.x - gesture.last.x, p.y - gesture.last.y);
      }
      if (added && gesture.strand) renderStrand(gesture.strand, gesture.strand.bulbs.length - 1);
    }
  }

  function onPointerUp() {
    if (!gesture) return;
    const g = gesture;
    gesture = null;

    if (g.type === 'bulbTap') { recolorStrand(g.strandId); return; }

    if (g.type === 'drag') {
      g.node.classList.remove('is-dragging', 'is-off-tree');
      if (!g.moved) {
        // A simple tap on an ornament: make it wiggle.
        g.o.x = g.from.x; g.o.y = g.from.y;
        g.node.setAttribute('transform', Scene.ornamentTransform(g.o));
        g.node.classList.remove('wiggle'); void g.node.getBBox(); g.node.classList.add('wiggle');

        return;
      }
      if (!Scene.isOnTree(g.o.x, g.o.y + Scene.BALL_CENTER, 6)) {
        // Dropped outside the tree: fly back home.
        g.o.x = g.from.x; g.o.y = g.from.y;
        g.node.classList.add('is-returning');
        g.node.setAttribute('transform', Scene.ornamentTransform(g.o));
        setTimeout(() => g.node.classList.remove('is-returning'), 400);

        toast(MSG.onTree);
        return;
      }
      history.push(g.before);
      if (history.length > MAX_HISTORY) history.shift();

      commit(false);
      return;
    }

    if (g.type === 'garland') {
      renderAll(); // final render keeps the chase order tidy
      commit(false);
    }
  }

  // ------------------------------------------------------------ surprise
  function onGiftTap() {
    if (!settings.unlocked) { openSurprise(); return; }
    Scene.sparkle(layers.fx, 216, 668, '#fff59d');
  }

  function openSurprise() {
    settings.unlocked = true;
    showOverlay('surpriseScreen');
    const box = $('giftBox');
    box.classList.remove('is-open');
    void box.offsetWidth;
    setTimeout(() => { box.classList.add('is-open'); confetti(70); }, 450);
  }

  function afterSurprise() {
    hideOverlay('surpriseScreen');
    Scene.rebuildGifts(layers.gifts, { unlocked: true, bubuSrc: BUBU_SRC });
    updateBubuTab();
    updateCounters();
    selectCategory('bubu');
  }

  function updateBubuTab() {
    const tab = $('tabBubu');
    tab.classList.toggle('tab--surprise', !settings.unlocked);
    tab.querySelector('.tab-ico').innerHTML = settings.unlocked
      ? `<img src="${BUBU_SRC}" alt="" width="40" height="40">` : '🎁';
    tab.querySelector('.tab-lbl').textContent = settings.unlocked ? 'Bubu' : 'Surpriză';
  }

  // ------------------------------------------------------------ palette UI
  function selectCategory(cat) {
    if (cat === 'bubu' && !settings.unlocked) { openSurprise(); return; }
    tool.cat = cat;
    document.querySelectorAll('.tab[data-cat]').forEach(t => {
      const on = t.dataset.cat === cat;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    app.dataset.tool = cat;
    renderPalette();
  }

  function section(title, inner, extraClass) {
    return `<section class="pal-section ${extraClass || ''}"><h2 class="pal-title">${title}</h2>${inner}</section>`;
  }

  /** Small row of bulbs that previews a colour pattern (helps children see the repetition). */
  function patternPreview(colors, n) {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = Scene.LIGHT_COLORS[colors[i % colors.length]];
      s += `<i class="dot" style="--c:${c}"></i>`;
    }
    return `<span class="pattern">${s}</span>`;
  }

  function renderPalette() {
    let html = '';
    const cat = tool.cat;

    if (cat === 'balls') {
      const plain = Object.keys(Scene.BALL_COLORS).map(k => swatchBall('ball', k, tool.ball === k, BALL_LABELS[k])).join('');
      const special = Object.keys(Scene.SPECIAL_BALLS).map(k => swatchBall('ball', k, tool.ball === k, BALL_LABELS[k])).join('');
      html = section('Alege un glob', `<div class="grid grid--balls">${plain}</div>`) +
             section('Globuri speciale', `<div class="grid grid--balls">${special}</div>`) +
             `<p class="hint">👉 Apoi atinge bradul</p>`;
    }

    if (cat === 'bubu') {
      const items = Object.keys(Scene.BUBU_BALLS).map(k => swatchBall('bubu', k, tool.bubu === k, BUBU_LABELS[k])).join('');
      html = section('Globuri cu Bubu', `<div class="grid grid--bubu">${items}</div>`) +
             `<p class="hint">👉 Apoi atinge bradul</p>`;
    }

    if (cat === 'lights') {
      const presets = PRESETS.map(p =>
        `<button type="button" class="combo${tool.palette === p.id ? ' is-selected' : ''}" data-palette="${p.id}" aria-pressed="${tool.palette === p.id}">
           ${patternPreview(p.colors, 4)}<span class="combo-name">${p.name}</span></button>`).join('');
      const modes = LIGHT_MODES.map(m =>
        `<button type="button" class="mode${state.lightMode === m.id ? ' is-selected' : ''}" data-mode="${m.id}"><span class="mode-ico mode-ico--${m.id}" aria-hidden="true">${m.icon}</span>${m.name}</button>`).join('');

      html = section('Alege culorile', `<div class="combos combos--big">${presets}</div>`) +
             section('Cum luminează?', `<div class="modes">${modes}</div>`) +
             `<p class="hint">👉 Atinge bradul sau trage cu degetul.<br>Atinge o ghirlandă ca să-i schimbi culorile.</p>` +
             `<button type="button" class="pal-btn pal-btn--magic pal-btn--hero" data-action="magic">✨ Ghirlandă magică</button>`;
    }

    if (cat === 'toppers') {
      const star = `<button type="button" class="topper-tile${state.topper === 'star' ? ' is-selected' : ''}" data-topper="star">
          <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="#ffd23f" opacity=".25"/><path d="${Scene.starPath(50, 52, 38, 16)}" fill="#ffd23f" stroke="#fff3b0" stroke-width="3"/></svg>
          <span>Steaua galbenă</span></button>`;
      const bubu = settings.unlocked
        ? `<button type="button" class="topper-tile topper-tile--bubu${state.topper === 'bubu' ? ' is-selected' : ''}" data-topper="bubu">
             <span class="topper-bubu"><img src="${BUBU_SRC}" alt="" width="80" height="80"></span><span>Bubu cu lumină roșie</span></button>`
        : `<button type="button" class="topper-tile topper-tile--locked" data-action="surprise">
             <span class="topper-locked" aria-hidden="true">🎁</span><span>Deschide cadoul!</span></button>`;
      const none = `<button type="button" class="topper-tile topper-tile--none${!state.topper ? ' is-selected' : ''}" data-topper="none">
             <span class="topper-locked" aria-hidden="true">🚫</span><span>Fără</span></button>`;
      html = section('Ce punem în vârf?', `<div class="grid grid--toppers">${star}${bubu}${none}</div>`) +
             `<p class="hint">Stinge lumina ca să vezi cum strălucește! 🌙</p>`;
    }

    if (cat === 'eraser') {
      html = section('Radiera', `<div class="eraser-info"><span class="eraser-ico" aria-hidden="true">🧽</span>
               <p>Atinge globul sau ghirlanda pe care vrei să o ștergi.</p></div>`) +
             `<div class="pal-actions">
                <button type="button" class="pal-btn" data-action="clear-ornaments">🔴 Șterge toate globurile</button>
                <button type="button" class="pal-btn" data-action="clear-lights">💡 Șterge toate luminițele</button>
                <button type="button" class="pal-btn" data-action="undo">↩️ M-am răzgândit (Înapoi)</button>
              </div>`;
    }

    paletteEl.innerHTML = html;
  }

  function swatchBall(kind, variant, selected, label) {
    return `<button type="button" class="swatch${selected ? ' is-selected' : ''}" data-${kind}="${variant}" aria-label="${label}" title="${label}" aria-pressed="${selected}">
              ${Scene.previewSVG(kind, variant, BUBU_SRC)}<span class="swatch-lbl">${label}</span></button>`;
  }

  function onPaletteClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;

    const d = b.dataset;

    if (d.ball) { tool.ball = d.ball; renderPalette(); return; }
    if (d.bubu) { tool.bubu = d.bubu; renderPalette(); return; }
    if (d.palette) { tool.palette = d.palette; renderPalette(); return; }
    if (d.mode) { state.lightMode = d.mode; applyLightMode(); renderPalette(); return; }
    if (d.topper) {
      tool.topper = d.topper === 'none' ? null : d.topper;
      setTopper(tool.topper);
      return;
    }
    switch (d.action) {
      case 'magic': magicGarland(); break;
      case 'surprise': openSurprise(); break;
      case 'clear-ornaments': clearKind('ornaments'); break;
      case 'clear-lights': clearKind('lights'); break;
      case 'undo': undo(); break;
    }
  }

  // ------------------------------------------------------------ room lights, snow
  let shimmerTimer = 0;

  /** While the room is dark, now and then a star twinkles on one ornament. */
  function shimmerTick() {
    const list = state.ornaments;
    if (!settings.dark || !list.length || document.hidden) return;
    const o = list[Math.floor(Math.random() * list.length)];
    Scene.shimmer(layers.lit, o);
  }

  function setRoomDark(on, quiet) {
    settings.dark = on;
    clearInterval(shimmerTimer);
    if (on) shimmerTimer = setInterval(shimmerTick, SHIMMER_EVERY);
    else layers.lit.innerHTML = '';
    app.classList.toggle('is-dark', on);
    document.body.classList.toggle('is-dark', on);
    const btn = $('btnRoomLights');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.querySelector('.btn-lights-lbl').textContent = on ? 'Aprinde lumina' : 'Stinge lumina';
    btn.querySelector('.tab-ico').textContent = on ? '☀️' : '🌙';
    if (!quiet) toast(on ? MSG.roomDark : MSG.roomLight);
  }

  function setSnow(on) {
    settings.snow = on;
    $('btnSnow').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) Snow.start(); else Snow.stop();
  }

  function toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    }
  }

  // ------------------------------------------------------------ overlays
  let lastFocus = null;
  function showOverlay(id) {
    lastFocus = document.activeElement;
    const o = $(id);
    o.classList.add('is-open');
    const btn = o.querySelector('.btn-big:last-of-type') || o.querySelector('button');
    setTimeout(() => btn && btn.focus(), 50);
  }
  function hideOverlay(id) {
    $(id).classList.remove('is-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ------------------------------------------------------------ celebration
  function celebrate() {
    const tally = $('tally');
    const byVariant = {};
    state.ornaments.forEach(o => { byVariant[o.kind + ':' + o.variant] = (byVariant[o.kind + ':' + o.variant] || 0) + 1; });
    let items = Object.keys(byVariant).map(key => {
      const [kind, variant] = key.split(':');
      const label = kind === 'bubu' ? BUBU_LABELS[variant] : BALL_LABELS[variant];
      return `<li class="tally-item" title="${label}">${Scene.previewSVG(kind, variant, BUBU_SRC)}<b>${byVariant[key]}</b></li>`;
    }).join('');
    const bulbs = totalBulbs();
    if (bulbs) items += `<li class="tally-item tally-item--bulbs"><span class="tally-bulb" aria-hidden="true">💡</span><b>${bulbs}</b></li>`;
    if (state.topper) {
      items += `<li class="tally-item tally-item--topper">${state.topper === 'bubu'
        ? `<img src="${BUBU_SRC}" alt="Bubu în vârf" width="48" height="48">`
        : '<span aria-hidden="true">⭐</span>'}<b>1</b></li>`;
    }
    if (!items) items = '<li class="tally-empty">Bradul așteaptă decorațiuni! 🎄</li>';
    tally.innerHTML = items;

    const total = state.ornaments.length;
    $('celebrateTitle').textContent = total + bulbs > 0 ? 'Bravo! Crăciun fericit!' : 'Hai să împodobim bradul!';
    $('celebrateBubu').hidden = !settings.unlocked;
    showOverlay('celebrateScreen');
    if (total + bulbs > 0) confetti(110);
  }

  // ------------------------------------------------------------ confetti
  function confetti(count) {
    const box = $('confetti');
    const colors = ['#e53935', '#ffd23f', '#43a047', '#1e88e5', '#ec407a', '#ffffff', '#8e24aa'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const c = document.createElement('i');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 0.6) + 's';
      c.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      c.style.setProperty('--x', (Math.random() * 200 - 100) + 'px');
      c.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      if (i % 3 === 0) c.style.borderRadius = '50%';
      frag.appendChild(c);
    }
    box.appendChild(frag);
    setTimeout(() => { box.innerHTML = ''; }, 4800);
  }

  // ------------------------------------------------------------ photo export
  /** Load Bubu as a data URL, so the image can be embedded in the exported PNG. */
  function preloadBubuDataUrl() {
    fetch(BUBU_SRC)
      .then(r => r.blob())
      .then(blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }))
      .then(url => { bubuDataUrl = url; })
      .catch(() => { /* export will still work, just without Bubu (e.g. opened from file://) */ });
  }

  function exportPhoto() {
    const W = 1200, H = 1700;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', W);
    clone.setAttribute('height', W * 765 / 600);
    // CSS does not apply inside an exported image, so bake the current look in.
    const dark = settings.dark;
    const dk = clone.querySelector('#darkness');
    if (dk) dk.setAttribute('opacity', dark ? '0.84' : '0');
    clone.querySelectorAll('.glow').forEach(g => g.setAttribute('opacity', dark ? '1' : '0.45'));
    clone.querySelectorAll('.topper-glow').forEach(g => g.setAttribute('opacity', dark ? '1' : '0.6'));
    clone.querySelectorAll('.sparkles, .shimmer').forEach(g => g.remove());
    clone.querySelectorAll('.wire').forEach(w => { w.setAttribute('fill', 'none'); w.setAttribute('stroke', '#1b3a20'); w.setAttribute('stroke-width', '2.4'); });
    clone.querySelectorAll('image').forEach(img => {
      if (bubuDataUrl) img.setAttribute('href', bubuDataUrl); else img.remove();
    });
    const markup = new XMLSerializer().serializeToString(clone);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);

    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const c = canvas.getContext('2d');
        const sky = c.createLinearGradient(0, 0, 0, H);
        if (dark) { sky.addColorStop(0, '#050a1c'); sky.addColorStop(1, '#050a1c'); }
        else { sky.addColorStop(0, '#bfe3ff'); sky.addColorStop(1, '#eaf6ff'); }
        c.fillStyle = sky;
        c.fillRect(0, 0, W, H);
        const treeH = W * 765 / 600;
        c.drawImage(img, 0, 70, W, treeH);
        c.textAlign = 'center';
        c.fillStyle = dark ? '#fff4c2' : '#0f3d2e';
        c.font = '800 64px "Baloo 2", sans-serif';
        c.fillText('Bradul lui Bubu', W / 2, 82);
        c.font = '700 44px "Baloo 2", sans-serif';
        c.fillText('Crăciun fericit! ' + new Date().getFullYear(), W / 2, H - 40);
        canvas.toBlob(blob => {
          if (!blob) { toast(MSG.photoFailed); return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'bradul-lui-bubu.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast(MSG.photoSaved);
        }, 'image/png');
      } catch (err) {
        toast(MSG.photoFailed);
      }
    };
    img.onerror = () => toast(MSG.photoFailed);
    img.src = url;
  }

  // ------------------------------------------------------------ new tree
  function newTree() {
    pushHistory();
    const mode = state.lightMode;
    state = freshState();
    state.lightMode = mode;
    // Lock the surprise again, so the next group of children can discover Bubu.
    settings.unlocked = false;
    Scene.rebuildGifts(layers.gifts, { unlocked: false, bubuSrc: BUBU_SRC });
    updateBubuTab();
    if (tool.cat === 'bubu') selectCategory('balls');
    renderAll();
    renderPalette();
    setRoomDark(false, true);

    commit(false);
  }

  // ------------------------------------------------------------ init
  function bindEvents() {
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('lostpointercapture', onPointerUp);
    svg.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#surpriseGift')) { e.preventDefault(); onGiftTap(); }
    });

    $('tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab[data-cat]');
      if (t) selectCategory(t.dataset.cat);
    });
    paletteEl.addEventListener('click', onPaletteClick);

    $('btnUndo').addEventListener('click', undo);
    $('btnRoomLights').addEventListener('click', () => setRoomDark(!settings.dark));
    $('btnSnow').addEventListener('click', () => { setSnow(!settings.snow); });
    $('btnFullscreen').addEventListener('click', () => { toggleFullscreen(); });
    $('btnPhoto').addEventListener('click', exportPhoto);
    $('btnNew').addEventListener('click', () => { showOverlay('confirmScreen'); });
    $('btnConfirmNo').addEventListener('click', () => { hideOverlay('confirmScreen'); });
    $('btnConfirmYes').addEventListener('click', () => { hideOverlay('confirmScreen'); newTree(); });
    $('btnDone').addEventListener('click', () => { celebrate(); });
    $('btnCelebrateClose').addEventListener('click', () => { hideOverlay('celebrateScreen'); });
    $('btnCelebratePhoto').addEventListener('click', exportPhoto);
    $('btnSurpriseOk').addEventListener('click', () => { afterSurprise(); });
    $('btnStart').addEventListener('click', () => $('startScreen').classList.remove('is-open'));

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('surpriseScreen').classList.contains('is-open')) { afterSurprise(); return; }
        ['confirmScreen', 'celebrateScreen'].forEach(id => {
          if ($(id).classList.contains('is-open')) hideOverlay(id);
        });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });

    // Hide the fullscreen button where the API is unavailable (e.g. iPhone).
    const el = document.documentElement;
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) $('btnFullscreen').hidden = true;
  }

  function init() {
    layers = Scene.build(svg, { unlocked: settings.unlocked, bubuSrc: BUBU_SRC });
    Snow.init($('snowCanvas'));
    bindEvents();
    updateBubuTab();
    renderAll();
    renderPalette();
    setSnow(settings.snow);
    setRoomDark(false, true);
    updateUndoButton();
    preloadBubuDataUrl();
  }

  init();
})();
