/*
 * snow.js — lightweight falling-snow effect drawn on a <canvas>.
 * Pauses automatically when switched off or when the tab is hidden.
 */
(function () {
  'use strict';

  const Snow = {
    canvas: null,
    ctx: null,
    flakes: [],
    running: false,
    rafId: 0,
    width: 0,
    height: 0,
    dpr: 1,

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize = this.resize.bind(this);
      this.tick = this.tick.bind(this);
      window.addEventListener('resize', this.resize);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) cancelAnimationFrame(this.rafId);
        else if (this.running) this.rafId = requestAnimationFrame(this.tick);
      });
      this.resize();
    },

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // Density scales with the area, capped for weak devices.
      const target = Math.min(140, Math.round((this.width * this.height) / 9000));
      while (this.flakes.length < target) this.flakes.push(this.makeFlake(true));
      this.flakes.length = target;
    },

    makeFlake(anywhere) {
      return {
        x: Math.random() * this.width,
        y: anywhere ? Math.random() * this.height : -10,
        r: 1.2 + Math.random() * 3.2,
        speed: 0.35 + Math.random() * 0.9,
        drift: Math.random() * Math.PI * 2,
        alpha: 0.5 + Math.random() * 0.5
      };
    },

    start() {
      if (this.running) return;
      this.running = true;
      this.canvas.classList.add('is-on');
      this.rafId = requestAnimationFrame(this.tick);
    },

    stop() {
      this.running = false;
      this.canvas.classList.remove('is-on');
      cancelAnimationFrame(this.rafId);
      this.ctx.clearRect(0, 0, this.width, this.height);
    },

    tick() {
      if (!this.running) return;
      const c = this.ctx;
      c.clearRect(0, 0, this.width, this.height);
      c.fillStyle = '#ffffff';
      for (const f of this.flakes) {
        f.y += f.speed;
        f.drift += 0.01;
        f.x += Math.sin(f.drift) * 0.4;
        if (f.y > this.height + 6) Object.assign(f, this.makeFlake(false));
        c.globalAlpha = f.alpha;
        c.beginPath();
        c.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  window.Snow = Snow;
})();
