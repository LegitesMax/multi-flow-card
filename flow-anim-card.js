// flow-anim-card.js
// A minimal, high-perf canvas flow animation card for Home Assistant.
// No root node; you control the flow direction via config.
// Works without external libs. Uses <ha-card> wrapper from HA.

class FlowAnimCard extends HTMLElement {
  static getConfigElement() { return null; } // keep it simple
  static getStubConfig() {
    return { direction: 'right', speed: 1.0, density: 0.8, line_width: 1, colors: ['#00c2ff', '#7cffcb'], background: 'transparent', diagonal: 'down-right' };
  }

  setConfig(config) {
    this._config = Object.assign(
      {
        direction: 'right',         // 'right' | 'left' | 'up' | 'down' | 'diagonal'
        diagonal: 'down-right',     // 'down-right' | 'down-left' | 'up-right' | 'up-left'
        speed: 1.0,                 // 0.1 .. 5
        density: 0.8,               // 0.2 .. 2 (particles per area)
        line_width: 1,              // stroke width
        colors: ['#00c2ff', '#7cffcb'],
        background: 'transparent',  // or a color, e.g. '#000'
        fps_limit: 0,               // 0 = uncapped (rAF); otherwise e.g. 60/30
        pause_when_hidden: true,
        interactive: false          // future: mouse sway
      },
      config || {}
    );

    if (!this.card) {
      this.card = document.createElement('ha-card');
      this.card.style.overflow = 'hidden';
      this.card.style.position = 'relative';
      this.wrapper = document.createElement('div');
      this.wrapper.style.position = 'relative';
      this.wrapper.style.width = '100%';
      this.wrapper.style.height = '200px'; // default height; can be overridden by card style
      this.card.appendChild(this.wrapper);

      // Canvas setup (OffscreenCanvas where available)
      this.canvas = document.createElement('canvas');
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.display = 'block';
      this.wrapper.appendChild(this.canvas);

      this.attachShadow({ mode: 'open' }).appendChild(this.card);

      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.wrapper);

      this._visible = true;
      document.addEventListener('visibilitychange', () => {
        this._visible = document.visibilityState === 'visible';
      });

      this._initDrawing();
    }

    // reapply background each config change
    this.card.style.background = this._config.background;
    // reinit particles with new config
    this._initParticles();
  }

  set hass(hass) { this._hass = hass; } // not used, but keeps HA happy
  getCardSize() { return 3; }

  connectedCallback() {
    this._animStart();
  }
  disconnectedCallback() {
    this._animStop();
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  // --- Animation core ---
  _initDrawing() {
    this._ctx = this.canvas.getContext('2d', { alpha: this._config.background === 'transparent' });
    this._lastTs = 0;
    this._accum = 0;
    this._fpsInterval = this._config.fps_limit && this._config.fps_limit > 0 ? (1000 / this._config.fps_limit) : 0;
    this._resize();
    this._initParticles();
  }

  _resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._initParticles(true);
  }

  _initParticles(justResize = false) {
    const w = this.wrapper.clientWidth || 300;
    const h = this.wrapper.clientHeight || 200;

    // number of strands based on area and density
    const base = Math.max(20, Math.floor((w * h) / 2500));
    const count = Math.max(10, Math.floor(base * this._config.density));

    const colors = this._config.colors && this._config.colors.length ? this._config.colors : ['#00c2ff', '#7cffcb'];

    // Particle "strands": each with pos + velocity vector derived from direction
    const dir = this._directionVector();
    const speed = Math.max(0.05, this._config.speed);

    if (!this._strands || !justResize) this._strands = [];
    this._strands.length = count;

    for (let i = 0; i < count; i++) {
      const color = colors[i % colors.length];
      this._strands[i] = this._strands[i] || {};
      this._strands[i].x = Math.random() * w;
      this._strands[i].y = Math.random() * h;
      this._strands[i].vx = dir.x * (0.4 + Math.random() * 0.6) * speed;
      this._strands[i].vy = dir.y * (0.4 + Math.random() * 0.6) * speed;
      this._strands[i].life = 50 + Math.random() * 150;
      this._strands[i].color = color;
    }

    this._lineWidth = Math.max(0.5, this._config.line_width);
    this._bg = this._config.background;
  }

  _directionVector() {
    const d = (this._config.direction || 'right').toLowerCase();
    const diag = (this._config.diagonal || 'down-right').toLowerCase();
    const map = {
      right: { x: 1, y: 0 },
      left: { x: -1, y: 0 },
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      diagonal: (() => {
        switch (diag) {
          case 'down-left': return { x: -0.707, y: 0.707 };
          case 'up-right': return { x: 0.707, y: -0.707 };
          case 'up-left': return { x: -0.707, y: -0.707 };
          default: return { x: 0.707, y: 0.707 }; // down-right
        }
      })()
    };
    return map[d] || map.right;
  }

  _animStart() {
    if (this._raf) return;
    const loop = (ts) => {
      this._raf = requestAnimationFrame(loop);
      if (this._config.pause_when_hidden && !this._visible) return;

      if (this._fpsInterval) {
        if (this._lastTs) {
          this._accum += ts - this._lastTs;
          if (this._accum < this._fpsInterval) { this._lastTs = ts; return; }
          this._accum = 0;
        }
      }
      this._lastTs = ts;
      this._tick();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _animStop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick() {
    const ctx = this._ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);

    // fade trail for "flow" look
    ctx.globalCompositeOperation = 'source-over';
    if (this._bg && this._bg !== 'transparent') {
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0)'; // transparent, but we still clear slightly to avoid buildup
      ctx.clearRect(0, 0, w, h);
    }

    ctx.globalAlpha = 0.9;
    ctx.lineWidth = this._lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw & advance strands
    for (let s of this._strands) {
      const nx = s.x + s.vx;
      const ny = s.y + s.vy;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = s.color;
      ctx.stroke();

      s.x = nx;
      s.y = ny;

      // wrap around edges (no root node, endless flow)
      if (s.x < 0) s.x = w;
      if (s.x > w) s.x = 0;
      if (s.y < 0) s.y = h;
      if (s.y > h) s.y = 0;

      // random tiny drift for organic feel
      s.vx += (Math.random() - 0.5) * 0.02 * this._config.speed;
      s.vy += (Math.random() - 0.5) * 0.02 * this._config.speed;

      // normalize velocity to keep overall direction
      const dir = this._directionVector();
      const mag = Math.hypot(s.vx, s.vy) || 1;
      const target = { x: dir.x * this._config.speed, y: dir.y * this._config.speed };
      s.vx = s.vx * 0.9 + target.x * 0.1 * (1 + Math.random() * 0.2);
      s.vy = s.vy * 0.9 + target.y * 0.1 * (1 + Math.random() * 0.2);

      s.life--;
      if (s.life <= 0) {
        // respawn anywhere to avoid "root" behavior
        s.x = Math.random() * w;
        s.y = Math.random() * h;
        s.life = 50 + Math.random() * 150;
      }
    }
  }
}

customElements.define('flow-anim-card', FlowAnimCard);

// Lovelace registration signature:
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'flow-anim-card',
  name: 'Flow Animation Card',
  description: 'Simple, direction-controlled flow animation without root node.'
});
