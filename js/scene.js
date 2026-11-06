/*
 * scene.js — draws the Christmas tree scene as SVG and renders decorations.
 * It contains no game logic: game.js owns the state and calls these functions.
 *
 * SVG layer order (bottom -> top):
 *   ground & gifts -> tree -> wires -> ornaments -> DARKNESS -> bulbs -> topper -> effects
 * The "darkness" rectangle sits between the ornaments and the bulbs, so when the
 * room lights are switched off only the tree lights (and the topper) still shine.
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const CX = 300;                       // horizontal centre of the tree
  const TOPPER = { x: CX, y: 34 };      // where the star / Bubu sits
  const ORN_SCALE = 1.4;                // ornaments are drawn this much bigger (easy to see)
  const BULB_SCALE = 1.45;              // same for the light bulbs
  const BALL_CENTER = 36 * ORN_SCALE;   // distance from the hook to the middle of an ornament

  // Three overlapping tiers, drawn from the bottom one up.
  const TIERS = [
    { top: 300, base: 640, hw: 292 },
    { top: 158, base: 462, hw: 222 },
    { top: 34,  base: 288, hw: 152 }
  ];

  // ---------------------------------------------------------------- palettes
  const BALL_COLORS = {
    red: '#e53935', gold: '#f4b400', blue: '#1e88e5', silver: '#b0bec5',
    purple: '#8e24aa', pink: '#ec407a', orange: '#fb8c00', white: '#f4f4f4'
  };

  // Special (patterned) balls: base colour + overlay type.
  const SPECIAL_BALLS = {
    stripes: { base: 'red' },
    dots: { base: 'blue' },
    snowflake: { base: 'silver' },
    star: { base: 'purple' }
  };

  // Background colours behind Bubu inside the Bubu ornaments.
  const BUBU_BALLS = {
    'bubu-red': { bg: '#e53935' },
    'bubu-hat': { bg: '#e53935', hat: true },
    'bubu-green': { bg: '#43a047' },
    'bubu-blue': { bg: '#1e88e5' },
    'bubu-gold': { bg: '#f4b400' }
  };

  const LIGHT_COLORS = {
    red: '#ff3b3b', orange: '#ff9a1f', yellow: '#ffe03b', green: '#3ddc5a',
    blue: '#3b8bff', purple: '#b45cff', pink: '#ff6fcf', white: '#fff4d0', cyan: '#3be8ff'
  };

  // ---------------------------------------------------------------- helpers
  /** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /** Create an SVG group from a markup string. */
  function group(markup, attrs) {
    const g = document.createElementNS(NS, 'g');
    if (attrs) for (const k in attrs) g.setAttribute(k, attrs[k]);
    g.innerHTML = markup;
    return g;
  }

  /** Small deterministic random generator, so the tree texture never changes. */
  function seeded(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  /** 5-pointed star path centred on (cx, cy). */
  function starPath(cx, cy, outer, inner) {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      d += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
    }
    return d + 'Z';
  }

  // ---------------------------------------------------------------- geometry
  /** Is (x, y) on the tree (with a small inner margin)? */
  function isOnTree(x, y, margin) {
    const m = margin == null ? 8 : margin;
    return TIERS.some(t => {
      if (y < t.top + 26 || y > t.base - 2) return false;
      const half = t.hw * (y - t.top) / (t.base - t.top);
      return Math.abs(x - CX) <= half - m;
    });
  }

  /** Half-width of the tree at height y (0 if off the tree). */
  function halfWidthAt(y) {
    let w = 0;
    TIERS.forEach(t => {
      if (y >= t.top && y <= t.base) w = Math.max(w, t.hw * (y - t.top) / (t.base - t.top));
    });
    return w;
  }

  /** Path for one tier: concave sides and a scalloped (wavy) bottom edge. */
  function tierPath(t) {
    const left = CX - t.hw, right = CX + t.hw, h = t.base - t.top;
    let d = `M${CX} ${t.top} Q${CX + t.hw * 0.42} ${t.top + h * 0.62} ${right} ${t.base}`;
    const n = Math.max(4, Math.round((t.hw * 2) / 52));
    const step = (right - left) / n;
    for (let i = n - 1; i >= 0; i--) {
      const x = left + i * step;
      d += ` Q${(x + step / 2).toFixed(1)} ${t.base + 16} ${x.toFixed(1)} ${t.base}`;
    }
    d += ` Q${CX - t.hw * 0.42} ${t.top + h * 0.62} ${CX} ${t.top}Z`;
    return d;
  }

  // ---------------------------------------------------------------- defs
  function buildDefs() {
    let s = '';
    // Tree, trunk and ground gradients.
    s += `<linearGradient id="g-tree" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#3cb46a"/><stop offset=".5" stop-color="#23894b"/><stop offset="1" stop-color="#155f33"/></linearGradient>
          <linearGradient id="g-tree-shadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset=".6" stop-color="#0b3d20" stop-opacity="0"/><stop offset="1" stop-color="#0b3d20" stop-opacity=".45"/></linearGradient>
          <linearGradient id="g-trunk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#8d5a34"/><stop offset="1" stop-color="#5b3519"/></linearGradient>
          <radialGradient id="g-ground" cx=".5" cy=".3" r=".7">
            <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e6f5"/></radialGradient>
          <linearGradient id="g-cap" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#ffe082"/><stop offset=".5" stop-color="#c79a2c"/><stop offset="1" stop-color="#8d6e1f"/></linearGradient>
          <linearGradient id="g-star" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#fff59d"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#f29d00"/></linearGradient>
          <radialGradient id="glow-star"><stop offset="0" stop-color="#fff176" stop-opacity=".95"/><stop offset=".35" stop-color="#ffd23f" stop-opacity=".55"/><stop offset="1" stop-color="#ffd23f" stop-opacity="0"/></radialGradient>
          <radialGradient id="glow-bubu"><stop offset="0" stop-color="#ff6b6b" stop-opacity=".95"/><stop offset=".4" stop-color="#ff1f1f" stop-opacity=".55"/><stop offset="1" stop-color="#ff1f1f" stop-opacity="0"/></radialGradient>
          <filter id="f-glow-red" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff2020" flood-opacity=".95"/></filter>
          <filter id="f-glow-yellow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffd23f" flood-opacity=".9"/></filter>
          <radialGradient id="glow-twinkle"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
          <clipPath id="clip-ball"><circle cx="0" cy="34" r="20"/></clipPath>
          <clipPath id="clip-bubu"><circle cx="0" cy="39" r="25"/></clipPath>
          `;
    // One shiny gradient per ball colour.
    for (const k in BALL_COLORS) {
      const c = BALL_COLORS[k];
      s += `<radialGradient id="ball-${k}" cx=".35" cy=".3" r=".75">
              <stop offset="0" stop-color="${shade(c, 0.55)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.45)}"/></radialGradient>`;
    }
    // Glow halo + glass gradient per light colour.
    for (const k in LIGHT_COLORS) {
      const c = LIGHT_COLORS[k];
      s += `<radialGradient id="glow-${k}"><stop offset="0" stop-color="${c}" stop-opacity=".9"/><stop offset=".4" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
            <radialGradient id="bulb-${k}" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="${shade(c, 0.25)}"/><stop offset="1" stop-color="${c}"/></radialGradient>`;
    }
    return s;
  }

  // ---------------------------------------------------------------- static scene
  function buildGround() {
    return `<ellipse cx="${CX}" cy="708" rx="310" ry="22" fill="url(#g-ground)"/>`;
  }

  /**
   * Gifts under the tree. They sit below the lowest branches (y >= 650),
   * so they never cover any part of the tree that children decorate.
   */
  function buildGifts(opts) {
    let s = '';
    s += gift(58, 668, 100, 44, '#1e88e5', '#ffd23f');
    s += gift(345, 668, 92, 44, '#8e24aa', '#ffffff');
    s += gift(450, 674, 72, 38, '#43a047', '#e53935');
    // The surprise gift: closed with a "?" until it is opened.
    s += `<g id="surpriseGift" class="surprise-gift${opts.unlocked ? ' is-open' : ''}" role="button" tabindex="0" aria-label="Cadoul surpriză">`;
    if (opts.unlocked) {
      s += `<ellipse cx="216" cy="667" rx="40" ry="7" fill="#fff59d" class="gift-glow"/>`;
      s += gift(172, 666, 88, 46, '#e53935', '#ffd23f', true);
    } else {
      s += `<g class="gift-wiggle">${gift(172, 666, 88, 46, '#e53935', '#ffd23f')}
              <circle cx="216" cy="694" r="13" fill="#fff" opacity=".95"/>
              <text x="216" y="703" text-anchor="middle" font-size="24" font-weight="800" fill="#e53935" font-family="Baloo 2, sans-serif">?</text></g>`;
    }
    s += `</g>`;
    return s;
  }

  /** Gift box markup. `open` draws the lid tilted to the side. */
  function gift(x, y, w, h, color, ribbon, open) {
    const lidH = Math.round(h * 0.22);
    const lid = open
      ? ''
      : `<rect x="${x - 6}" y="${y}" width="${w + 12}" height="${lidH}" rx="4" fill="${shade(color, 0.12)}"/>
         <rect x="${x + w / 2 - 7}" y="${y}" width="14" height="${lidH}" fill="${ribbon}"/>
         <path d="M${x + w / 2} ${y} c-20 -16 -26 2 0 0 c20 -16 26 2 0 0z" fill="none" stroke="${ribbon}" stroke-width="5" stroke-linejoin="round"/>`;
    const bodyY = open ? y : y + lidH;
    const bodyH = open ? h : h - lidH;
    return `<rect x="${x}" y="${bodyY}" width="${w}" height="${bodyH}" rx="3" fill="${color}"/>
            <rect x="${x + w * 0.62}" y="${bodyY}" width="${w * 0.38}" height="${bodyH}" fill="#000" opacity=".1"/>
            <rect x="${x + w / 2 - 7}" y="${bodyY}" width="14" height="${bodyH}" fill="${ribbon}"/>
            ${lid}`;
  }

  function buildTree() {
    let s = `<rect x="268" y="600" width="64" height="106" rx="6" fill="url(#g-trunk)"/>`;
    const rnd = seeded(7);
    TIERS.forEach(t => {
      const d = tierPath(t);
      s += `<path d="${d}" fill="url(#g-tree)"/><path d="${d}" fill="url(#g-tree-shadow)"/>`;
      // A few light "needle" strokes to give texture.
      for (let i = 0; i < 9; i++) {
        const y = t.top + 40 + rnd() * (t.base - t.top - 60);
        const half = t.hw * (y - t.top) / (t.base - t.top) - 18;
        if (half < 10) continue;
        const x = CX + (rnd() * 2 - 1) * half;
        s += `<path d="M${(x - 10).toFixed(1)} ${(y - 6).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${(x + 10).toFixed(1)} ${(y - 6).toFixed(1)}" stroke="#5fd18b" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      }
    });
    return s;
  }

  /** Build the whole static scene once. Returns references to the dynamic layers. */
  function build(svg, opts) {
    svg.innerHTML = `<defs>${buildDefs()}</defs>
      <g id="layerGround">${buildGround()}</g>
      <g id="layerTree">${buildTree()}</g>
      <g id="layerGifts">${buildGifts(opts)}</g>
      <g id="layerWires"></g>
      <g id="layerOrnaments"></g>
      <rect id="darkness" class="darkness" x="-400" y="-400" width="1400" height="1600" fill="#040817"/>
      <g id="layerLit" pointer-events="none"></g>
      <g id="layerBulbs"></g>
      <g id="layerTopper"></g>
      <g id="layerFx"></g>`;
    return {
      gifts: svg.querySelector('#layerGifts'),
      wires: svg.querySelector('#layerWires'),
      ornaments: svg.querySelector('#layerOrnaments'),
      lit: svg.querySelector('#layerLit'),
      bulbs: svg.querySelector('#layerBulbs'),
      topper: svg.querySelector('#layerTopper'),
      fx: svg.querySelector('#layerFx')
    };
  }

  function rebuildGifts(layer, opts) { layer.innerHTML = buildGifts(opts); }

  // ---------------------------------------------------------------- ornaments
  const HOOK = `<path d="M0 0 v7" stroke="#c9a14a" stroke-width="1.6"/><rect x="-6" y="6" width="12" height="8" rx="2" fill="url(#g-cap)"/>`;
  const SHINE = (cy, r) => `<ellipse cx="${-r * 0.36}" cy="${cy - r * 0.42}" rx="${r * 0.3}" ry="${r * 0.18}" fill="#fff" opacity=".6" transform="rotate(-35 ${-r * 0.36} ${cy - r * 0.42})"/>`;

  /** Overlay drawings for the patterned balls (clipped to the ball). */
  function ballOverlay(kind) {
    switch (kind) {
      case 'stripes':
        return `<g clip-path="url(#clip-ball)" fill="#fff" opacity=".9">
                  <rect x="-30" y="22" width="60" height="5" transform="rotate(-25 0 34)"/>
                  <rect x="-30" y="32" width="60" height="5" transform="rotate(-25 0 34)"/>
                  <rect x="-30" y="42" width="60" height="5" transform="rotate(-25 0 34)"/></g>`;
      case 'dots':
        return `<g fill="#fff" opacity=".9"><circle cx="-8" cy="28" r="3"/><circle cx="6" cy="24" r="2.5"/><circle cx="9" cy="37" r="3"/>
                  <circle cx="-4" cy="42" r="2.5"/><circle cx="-12" cy="38" r="2"/><circle cx="2" cy="50" r="2"/></g>`;
      case 'snowflake':
        return `<g stroke="#fff" stroke-width="2.2" stroke-linecap="round" transform="translate(0 34)">
                  <path d="M0 -12V12M-10.4 -6 10.4 6M-10.4 6 10.4 -6"/>
                  <path d="M-3 -9 0 -12 3 -9M-3 9 0 12 3 9" fill="none"/></g>`;
      case 'star':
        return `<path d="${starPath(0, 35, 11, 4.6)}" fill="#ffd23f" stroke="#fff6c2" stroke-width="1"/>`;
      default:
        return '';
    }
  }

  /** Markup for a plain or patterned ball. */
  function ballMarkup(variant) {
    const special = SPECIAL_BALLS[variant];
    const color = special ? special.base : variant;
    return `${HOOK}<circle cx="0" cy="34" r="20" fill="url(#ball-${color})"/>${ballOverlay(special ? variant : '')}${SHINE(34, 20)}`;
  }

  /** Markup for a Bubu ornament. */
  function bubuMarkup(variant, bubuSrc) {
    const v = BUBU_BALLS[variant] || BUBU_BALLS['bubu-red'];
    const hat = v.hat
      ? `<g transform="translate(12 18) rotate(28)"><path d="M-12 6 Q-4 -22 14 -14 Q4 -6 10 6Z" fill="#d32f2f"/>
           <rect x="-14" y="3" width="26" height="7" rx="3.5" fill="#fff"/><circle cx="15" cy="-14" r="4.5" fill="#fff"/></g>`
      : '';
    return `${HOOK}<circle cx="0" cy="39" r="25" fill="${v.bg}"/>
            <circle cx="0" cy="39" r="25" fill="url(#ball-white)" opacity=".25"/>
            <image href="${bubuSrc}" x="-23" y="17" width="46" height="46" clip-path="url(#clip-bubu)" preserveAspectRatio="xMidYMid meet"/>
            <circle cx="0" cy="39" r="24" fill="none" stroke="#ffd54f" stroke-width="3"/>
            ${SHINE(39, 25)}${hat}`;
  }

  /** Position + size of an ornament (hook at x, y). */
  function ornamentTransform(o) {
    return `translate(${o.x.toFixed(1)} ${o.y.toFixed(1)}) scale(${ORN_SCALE})`;
  }

  /** Create the DOM node for an ornament object { id, kind, variant, x, y }. */
  function ornamentNode(o, bubuSrc) {
    const inner = o.kind === 'bubu' ? bubuMarkup(o.variant, bubuSrc) : ballMarkup(o.variant);
    const g = group(`<g class="swing" style="animation-delay:${(-(o.id * 0.37) % 3).toFixed(2)}s"><g class="pop">${inner}</g></g>`, {
      class: 'ornament', 'data-id': o.id, transform: ornamentTransform(o)
    });
    return g;
  }

  /** Small preview SVG (used inside the palette buttons). */
  function previewSVG(kind, variant, bubuSrc) {
    if (kind === 'ball') {
      return `<svg viewBox="-28 -2 56 60" aria-hidden="true">${ballMarkup(variant)}</svg>`;
    }
    if (kind === 'bubu') {
      return `<svg viewBox="-32 -2 64 70" aria-hidden="true">${bubuMarkup(variant, bubuSrc)}</svg>`;
    }
    return '';
  }

  // ---------------------------------------------------------------- lights
  /** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  /** Colour key of bulb #i in a strand, following the strand's colour pattern. */
  function bulbColor(strand, i) {
    return strand.colors[i % strand.colors.length];
  }

  /** Render (or re-render) one strand: its wire and all its bulbs. */
  function renderStrand(layers, strand, globalIndexStart, animateFrom) {
    removeStrand(layers, strand.id);
    const wire = document.createElementNS(NS, 'path');
    wire.setAttribute('class', 'wire');
    wire.setAttribute('stroke-width', '3');
    wire.setAttribute('data-strand', strand.id);
    wire.setAttribute('d', smoothPath(strand.bulbs));
    layers.wires.appendChild(wire);

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'strand');
    g.setAttribute('data-strand', strand.id);
    let markup = '';
    strand.bulbs.forEach((b, i) => {
      const key = bulbColor(strand, i);
      const tilt = (i % 2 ? 14 : -14);
      const isNew = animateFrom != null && i >= animateFrom;
      markup += `<g class="bulb${isNew ? ' is-new' : ''}" data-strand="${strand.id}" transform="translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${tilt}) scale(${BULB_SCALE})"
                   style="--i:${globalIndexStart + i};--r:${((strand.id * 7 + i * 13) % 17) / 10}s">
                   <circle class="glow" r="17" fill="url(#glow-${key})"/>
                   <g class="bulb-body"><rect x="-2.6" y="-10" width="5.2" height="5" rx="1" fill="#2b3a2b"/>
                   <ellipse class="glass" cx="0" cy="0" rx="4.8" ry="6.8" fill="url(#bulb-${key})"/></g></g>`;
    });
    g.innerHTML = markup;
    layers.bulbs.appendChild(g);
  }

  function removeStrand(layers, id) {
    layers.wires.querySelectorAll(`[data-strand="${id}"]`).forEach(n => n.remove());
    layers.bulbs.querySelectorAll(`.strand[data-strand="${id}"]`).forEach(n => n.remove());
  }

  // ---------------------------------------------------------------- topper
  function renderTopper(layer, topper, bubuSrc) {
    layer.innerHTML = '';
    if (!topper) return;
    const { x, y } = TOPPER;
    let s;
    if (topper === 'bubu') {
      // Just Bubu (transparent background), glowing red.
      s = `<circle class="topper-glow topper-glow--red" cx="${x}" cy="${y + 8}" r="120" fill="url(#glow-bubu)"/>
           <g class="topper-body pop-big">
             <image href="${bubuSrc}" x="${x - 42}" y="${y - 32}" width="84" height="84" filter="url(#f-glow-red)"/>
           </g>`;
    } else {
      s = `<circle class="topper-glow topper-glow--yellow" cx="${x}" cy="${y + 10}" r="120" fill="url(#glow-star)"/>
           <g class="topper-body pop-big" filter="url(#f-glow-yellow)">
             <path d="${starPath(x, y + 10, 40, 17)}" fill="url(#g-star)" stroke="#fff3b0" stroke-width="3" stroke-linejoin="round"/>
             <path d="${starPath(x - 2, y + 8, 15, 6.5)}" fill="#fffbe0" opacity=".7"/>
           </g>`;
    }
    layer.appendChild(group(s, { class: 'topper', 'data-topper': topper }));
  }

  // ---------------------------------------------------------------- effects
  /** A little burst of sparkles at (x, y), removed after the animation. */
  function sparkle(layer, x, y, color) {
    let s = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      s += `<circle class="spark" cx="0" cy="0" r="3.2" fill="${color || '#fff59d'}" style="--dx:${(Math.cos(a) * 30).toFixed(1)}px;--dy:${(Math.sin(a) * 30).toFixed(1)}px"/>`;
    }
    const g = group(s, { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, class: 'sparkles' });
    layer.appendChild(g);
    setTimeout(() => g.remove(), 700);
  }

  /**
   * While the room is dark, a white star twinkles for a moment on the shiny
   * spot of an ornament. Only the star is drawn (above the darkness layer),
   * the ornament itself stays in the dark.
   */
  function shimmer(layer, o) {
    const cy = o.kind === 'bubu' ? 39 : 34;
    const r = o.kind === 'bubu' ? 25 : 20;
    const x = o.x + (-r * 0.4) * ORN_SCALE;
    const y = o.y + (cy - r * 0.45) * ORN_SCALE;
    const g = group(`<g class="twinkle">
        <circle r="16" fill="url(#glow-twinkle)"/>
        <path d="M0 -15 L2.6 -2.6 L15 0 L2.6 2.6 L0 15 L-2.6 2.6 L-15 0 L-2.6 -2.6Z" fill="#fff"/>
        <path d="M0 -7 L1.4 -1.4 L7 0 L1.4 1.4 L0 7 L-1.4 1.4 L-7 0 L-1.4 -1.4Z" fill="#fff" transform="rotate(45)"/>
      </g>`, { class: 'shimmer', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
    layer.appendChild(g);
    setTimeout(() => g.remove(), 1700);
  }

  window.Scene = {
    CX, TOPPER, TIERS, ORN_SCALE, BALL_CENTER,
    BALL_COLORS, SPECIAL_BALLS, BUBU_BALLS, LIGHT_COLORS,
    build, rebuildGifts, isOnTree, halfWidthAt,
    ornamentNode, ornamentTransform, shimmer, previewSVG, renderStrand, removeStrand, renderTopper, sparkle, starPath, shade
  };
})();
