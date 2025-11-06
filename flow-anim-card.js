// flow-network-card.js
// Elegant network flow card for Home Assistant – no root node.
// — Static lines; only a small moving dot (with fade in/out near ends).
// — Square / rounded / circle nodes with neon ring (no blinking).
// — Auto grid layout or manual positions.
// — Icons inside nodes (mdi:...), plus extra sensor lines above/below the icon.
// — Lines start/stop exactly on node borders.
// No external deps.

class FlowNetworkCard extends HTMLElement {
  static getStubConfig() {
    return {
      height: 340,
      background: "#121418",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      layout: { mode: "auto", columns: 3, gap: 22, padding: 18 },
      nodes: [
        {
          id: "sensor.grid_power", label: "Netz",
          shape: "rounded", size: 72, ring: "#8a2be2", fill: "#1c1426",
          icon: "mdi:transmission-tower", icon_size: 28, icon_color: "#caa9ff",
          top_entities: [{ id: "sensor.grid_in" }],
          bottom_entities: [{ id: "sensor.grid_out" }]
        },
        {
          id: "sensor.pv_power", label: "PV",
          shape: "rounded", size: 72, ring: "#7cffcb", fill: "#0f2a22",
          icon: "mdi:solar-power-variant-outline", icon_size: 28, icon_color: "#baffea"
        },
        {
          id: "sensor.battery", label: "Batterie",
          shape: "rounded", size: 72, ring: "#ff6b6b", fill: "#2a1f22",
          icon: "mdi:battery-high", icon_size: 26, icon_color: "#ffc2c2"
        },
        {
          id: "sensor.house_power", label: "Zuhause",
          shape: "rounded", size: 80, ring: "#23b0ff", fill: "#0f1a22",
          icon: "mdi:home-variant", icon_size: 28, icon_color: "#99dbff"
        }
      ],
      links: [
        { from: "sensor.grid_power", to: "sensor.house_power", color: "#8a2be2", width: 2, speed: 0.8 },
        { from: "sensor.pv_power",   to: "sensor.house_power", color: "#7cffcb", width: 2, speed: 0.9 },
        { from: "sensor.battery",    to: "sensor.house_power", color: "#ff6b6b", width: 2, speed: 0.7 }
      ],
      value_precision: 2,
      dot: { size: 5, glow: true, fade_zone: 0.08 } // 8% am Anfang/Ende weiches Ein-/Ausblenden
    };
  }

  setConfig(config) {
    this._config = {
      height: 320,
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      node_text_color: "rgba(255,255,255,0.92)",
      layout: { mode: "auto", columns: 3, gap: 20, padding: 16 },
      dot: { size: 5, glow: true, fade_zone: 0.08 },
      ...config
    };

    if (!this.card) {
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      this.wrapper.style.position = "relative";
      this.wrapper.style.width = "100%";
      this.wrapper.style.height = (this._config.height || 320) + "px";

      // Canvas background (nodes + lines) and foreground (moving dots)
      this.bg = document.createElement("canvas");
      this.fg = document.createElement("canvas");
      for (const c of [this.bg, this.fg]) {
        c.style.display = "block";
        c.style.width = "100%";
        c.style.height = "100%";
        c.style.position = "absolute";
        c.style.top = "0";
        c.style.left = "0";
      }

      // Overlay for icons (DOM, crisp & themeable)
      this.iconLayer = document.createElement("div");
      Object.assign(this.iconLayer.style, {
        position: "absolute", inset: "0", pointerEvents: "none"
      });

      this.wrapper.appendChild(this.bg);
      this.wrapper.appendChild(this.fg);
      this.wrapper.appendChild(this.iconLayer);
      this.card.appendChild(this.wrapper);
      this.attachShadow({ mode: "open" }).appendChild(this.card);

      this.bgCtx = this.bg.getContext("2d", { alpha: true });
      this.fgCtx = this.fg.getContext("2d", { alpha: true });

      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.wrapper);
      this._visible = true;
      document.addEventListener("visibilitychange", () => {
        this._visible = document.visibilityState === "visible";
      });

      this._phase = 0;
      this._lastTs = 0;
      this._iconEls = new Map();
      this._animStart();
    }

    this.card.style.background = this._config.background || "transparent";
    if (this._config.height) this.wrapper.style.height = this._config.height + "px";

    this._prepare();
    this._resize(); // also (re)draws background
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.nodes?.length) this._nodeValues = this._config.nodes.map(n => this._readEntity(n.id));
    if (this._nodes) this._needsBgRedraw = true; // update displayed texts
  }

  getCardSize() { return Math.ceil((this._config.height || 320) / 50); }
  connectedCallback(){ this._animStart(); }
  disconnectedCallback(){ this._animStop(); if (this._resizeObserver) this._resizeObserver.disconnect(); }

  // ---------- data ----------
  _prepare() {
    this._nodes = (this._config.nodes || []).map((n, i) => ({
      id: n.id,
      label: n.label || n.id,
      shape: (n.shape || "rounded").toLowerCase(), // square|rounded|circle
      size: Math.max(44, Number(n.size || 64)),
      ring: n.ring || "#23b0ff",
      fill: n.fill || "#121418",
      ringWidth: Math.max(2, Number(n.ringWidth || 3)),
      text_color: n.color || this._config.node_text_color,
      fontSize: Math.max(11, Number(n.fontSize || 13)),
      x: (typeof n.x === "number") ? this._clamp01(n.x) : null,
      y: (typeof n.y === "number") ? this._clamp01(n.y) : null,
      order: n.order ?? i,
      // icon
      icon: n.icon || null,
      icon_size: Math.max(14, Number(n.icon_size || Math.round((n.size || 64) * 0.38))),
      icon_color: n.icon_color || "#ffffff",
      // extra sensor lines
      top_entities: Array.isArray(n.top_entities) ? n.top_entities : [],
      bottom_entities: Array.isArray(n.bottom_entities) ? n.bottom_entities : []
    }));

    // auto grid?
    if ((this._config.layout?.mode || "auto") === "auto") this._applyAutoLayout();

    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    this._links = (this._config.links || [])
      .map(l => ({
        from: l.from, to: l.to,
        color: l.color || "rgba(255,255,255,0.85)",
        width: Math.max(1, Number(l.width || 2)),
        speed: Math.max(0.05, Number(l.speed || 0.8)),
        curve: Number.isFinite(l.curve) ? Math.max(-0.35, Math.min(0.35, l.curve)) : 0
      }))
      .filter(l => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  _applyAutoLayout() {
    const cols = Math.max(1, Math.floor(this._config.layout.columns || 3));
    const gap = Math.max(8, Number(this._config.layout.gap || 20));
    const pad = Math.max(0, Number(this._config.layout.padding || 12));
    const rows = Math.ceil(this._nodes.length / cols);
    this._auto = { cols, rows, gap, pad };
  }

  // ---------- utils ----------
  _clamp01(v){ return Math.max(0, Math.min(1, Number(v))); }

  _readEntity(id) {
    if (!this._hass || !id) return { raw: null, text: "" };
    const st = this._hass.states?.[id];
    if (!st) return { raw: null, text: "" };
    const num = Number(st.state);
    if (!isNaN(num)) {
      const p = this._config.value_precision ?? 2;
      const unit = st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : "";
      return { raw: num, text: num.toFixed(p) + unit };
    }
    return { raw: st.state, text: String(st.state) };
  }

  _resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    for (const c of [this.bg, this.fg]) {
      c.width  = Math.max(1, Math.floor(rect.width * dpr));
      c.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = (c === this.bg ? this.bgCtx : this.fgCtx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (this._auto) {
      const { cols, gap, pad } = this._auto;
      const w = rect.width, h = rect.height;
      const cellW = (w - pad*2 - gap*(cols-1)) / cols;
      const cellH = cellW; // square
      const rows = Math.ceil(this._nodes.length / cols);
      const usableH = pad*2 + rows*cellH + (rows-1)*gap;
      const top = Math.max(pad, (h - usableH)/2);

      this._nodes.sort((a,b)=> (a.order ?? 0) - (b.order ?? 0)).forEach((n, i) => {
        if (n.x !== null && n.y !== null) return;
        const r = Math.floor(i / cols);
        const c = i % cols;
        const cx = pad + c*(cellW+gap) + cellW/2;
        const cy = top + r*(cellH+gap) + cellH/2;
        n.x = this._clamp01(cx / w);
        n.y = this._clamp01(cy / h);
      });
    }

    // reposition icons after we know px coords
    this._positionIcons();
    this._needsBgRedraw = true;
  }

  // ---------- geometry ----------
  _edgePoint(from, to) {
    const ax = from._px.x, ay = from._px.y;
    const bx = to._px.x, by = to._px.y;
    const dx = bx - ax, dy = by - ay;

    if (from.shape === "circle") {
      const r = from.size/2;
      const len = Math.hypot(dx,dy) || 1;
      return { x: ax + dx/len * r, y: ay + dy/len * r };
    }
    // square/rounded: AABB intersection along direction
    const hw = from.size/2, hh = from.size/2;
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: ax + dx * s, y: ay + dy * s };
  }

  // ---------- icons ----------
  _ensureIconEl(id, color, size) {
    let el = this._iconEls.get(id);
    if (!el) {
      el = document.createElement("ha-icon");
      el.style.position = "absolute";
      el.style.transform = "translate(-50%, -50%)";
      el.style.pointerEvents = "none";
      this.iconLayer.appendChild(el);
      this._iconEls.set(id, el);
    }
    el.setAttribute("icon", id);
    el.style.color = color;
    el.style.width = size + "px";
    el.style.height = size + "px";
    return el;
  }

  _positionIcons() {
    if (!this._nodes) return;
    const rect = this.wrapper.getBoundingClientRect();
    const w = rect.width, h = rect.height;

    for (const n of this._nodes) {
      if (!n.icon) continue;
      if (!this._hass) continue; // ha-icon exists regardless, but color can still be set
      const px = { x: n.x * w, y: n.y * h };
      const el = this._ensureIconEl(n.icon, n.icon_color || "#fff", n.icon_size);
      el.style.left = px.x + "px";
      el.style.top  = px.y + "px";
    }
  }

  // ---------- drawing (background) ----------
  _drawBg() {
    const ctx = this.bgCtx;
    const w = this.bg.width  / (window.devicePixelRatio || 1);
    const h = this.bg.height / (window.devicePixelRatio || 1);

    if (this._config.background && this._config.background !== "transparent") {
      ctx.fillStyle = this._config.background;
      ctx.fillRect(0,0,w,h);
    } else {
      ctx.clearRect(0,0,w,h);
    }

    // pixel positions
    for (const n of this._nodes) n._px = { x: n.x * w, y: n.y * h };

    // lines (static)
    for (const l of this._links) {
      const a = this._nodeMap.get(l.from);
      const b = this._nodeMap.get(l.to);
      if (!a || !b) continue;
      const pA = this._edgePoint(a, b);
      const pB = this._edgePoint(b, a);

      const mx = (pA.x + pB.x)/2, my = (pA.y + pB.y)/2;
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      const nx = -dy, ny = dx;
      const cx = mx + nx * (l.curve || 0), cy = my + ny * (l.curve || 0);

      ctx.save();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      if (l.curve) ctx.quadraticCurveTo(cx, cy, pB.x, pB.y);
      else ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.restore();

      l._pA = pA; l._pB = pB; l._c = { x: cx, y: cy }; l._curved = !!l.curve;
    }

    // nodes
    for (const n of this._nodes) this._drawNode(ctx, n);
  }

  _drawNode(ctx, n) {
    const p = n._px, r = n.size/2;

    // ring with soft glow
    ctx.save();
    ctx.shadowColor = n.ring;
    ctx.shadowBlur = 18;
    ctx.lineWidth = n.ringWidth;
    ctx.strokeStyle = n.ring;
    this._strokeShape(ctx, n.shape, p.x, p.y, r, n.size);
    ctx.restore();

    // fill
    ctx.save();
    ctx.fillStyle = n.fill;
    this._fillShape(ctx, n.shape, p.x, p.y, r, n.size);
    ctx.restore();

    // label above
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = `bold ${n.fontSize}px ${this._config.font_family}`;
    ctx.fillText(n.label, p.x, p.y - r - 8);
    ctx.restore();

    // primary value (centered, below icon visually)
    const v = this._hass ? this._readEntity(n.id) : { text: "" };
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = n.text_color;
    ctx.font = `bold ${Math.max(12, n.fontSize)}px ${this._config.font_family}`;
    ctx.fillText(v.text, p.x, p.y + Math.max(0, (n.icon ? n.icon_size * 0.30 : 0)));
    ctx.restore();

    // extra sensors above icon
    if (n.top_entities?.length) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = `${Math.max(10, n.fontSize - 1)}px ${this._config.font_family}`;
      let y = p.y - r - 22;
      for (const e of n.top_entities) {
        const val = this._readEntity(e.id);
        const label = e.label ? e.label + " " : "";
        ctx.fillText(label + val.text, p.x, y);
        y -= (n.fontSize + 2);
      }
      ctx.restore();
    }

    // extra sensors unter dem Icon
    if (n.bottom_entities?.length) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = `${Math.max(10, n.fontSize - 1)}px ${this._config.font_family}`;
      let y = p.y + r + 8;
      for (const e of n.bottom_entities) {
        const val = this._readEntity(e.id);
        const label = e.label ? e.label + " " : "";
        ctx.fillText(label + val.text, p.x, y);
        y += (n.fontSize + 2);
      }
      ctx.restore();
    }
  }

  _strokeShape(ctx, shape, cx, cy, r, size) {
    if (shape === "circle") { ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); return; }
    if (shape === "rounded") { const rad = Math.min(14, r); this._roundRect(ctx, cx-r, cy-r, size, size, rad); ctx.stroke(); return; }
    ctx.strokeRect(cx - r, cy - r, size, size);
  }
  _fillShape(ctx, shape, cx, cy, r, size) {
    if (shape === "circle") { ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill(); return; }
    if (shape === "rounded") { const rad = Math.min(14, r); this._roundRect(ctx, cx-r, cy-r, size, size, rad); ctx.fill(); return; }
    ctx.fillRect(cx - r, cy - r, size, size);
  }
  _roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  // ---------- drawing (dots only, with fade) ----------
  _drawDots(dtMs) {
    const ctx = this.fgCtx;
    const w = this.fg.width / (window.devicePixelRatio || 1);
    const h = this.fg.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,w,h);

    const fadeZone = Math.max(0.02, this._config.dot.fade_zone || 0.08); // fraction [0..0.3]

    for (const l of this._links) {
      if (!l._pA || !l._pB) continue;

      // advance per-link phase with real time
      l._t = ((l._t ?? 0) + (dtMs/1000) * (l.speed || 0.8)) % 1;
      const t = l._t;

      const pos = l._curved
        ? this._quadPoint(l._pA, l._c, l._pB, t)
        : { x: l._pA.x + (l._pB.x - l._pA.x)*t, y: l._pA.y + (l._pB.y - l._pA.y)*t };

      // smooth fade in/out near ends
      let alpha = 1;
      if (t < fadeZone) alpha = t / fadeZone;
      else if (t > 1 - fadeZone) alpha = (1 - t) / fadeZone;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      if (this._config.dot.glow) { ctx.shadowColor = l.color; ctx.shadowBlur = 8; }
      ctx.fillStyle = l.color;
      const r = Math.max(3, this._config.dot.size || 5);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  _quadPoint(a, c, b, t) {
    const u = 1 - t;
    return { x: u*u*a.x + 2*u*t*c.x + t*t*b.x, y: u*u*a.y + 2*u*t*c.y + t*t*b.y };
  }

  // ---------- anim loop ----------
  _animStart() {
    if (this._raf) return;
    const step = (ts) => {
      this._raf = requestAnimationFrame(step);
      if (!this._visible) { this._lastTs = ts; return; }
      const dt = this._lastTs ? (ts - this._lastTs) : 16;
      this._lastTs = ts;

      if (this._needsBgRedraw) { this._drawBg(); this._needsBgRedraw = false; }
      this._drawDots(dt);
    };
    this._raf = requestAnimationFrame(step);
  }
  _animStop(){ if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
}

customElements.define("flow-network-card", FlowNetworkCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "flow-network-card",
  name: "Flow Network Card (icons + smooth dot)",
  description: "Static lines, smooth moving dot, neon nodes, auto layout, extra sensors."
});
