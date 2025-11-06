// flow-network-card.js
// Elegant network flow card for Home Assistant (NO root node).
// • Lines are static. Only a small dot moves from A -> B.
// • Square / rounded nodes with neon ring (no blinking).
// • Auto layout (grid) or manual positioning.
// • Lines start/stop exactly at node borders (circle/square/rounded).
// No external dependencies.

class FlowNetworkCard extends HTMLElement {
  static getStubConfig() {
    return {
      height: 320,
      background: "#15181c",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      layout: { mode: "auto", columns: 3, gap: 22 },
      nodes: [
        { id: "sensor.grid_power",   label: "Netz",    shape: "rounded", size: 68, ring: "#8a2be2", fill: "#1c1426" },
        { id: "sensor.pv_power",     label: "PV",      shape: "rounded", size: 68, ring: "#7cffcb", fill: "#0f2a22" },
        { id: "sensor.battery",      label: "Batterie",shape: "rounded", size: 68, ring: "#ff6b6b", fill: "#2a1f22" },
        { id: "sensor.house_power",  label: "Zuhause", shape: "rounded", size: 76, ring: "#23b0ff", fill: "#0f1a22" }
      ],
      links: [
        { from: "sensor.grid_power",  to: "sensor.house_power", color: "#8a2be2", width: 2, speed: 0.8 },
        { from: "sensor.pv_power",    to: "sensor.house_power", color: "#7cffcb", width: 2, speed: 0.9 },
        { from: "sensor.battery",     to: "sensor.house_power", color: "#ff6b6b", width: 2, speed: 0.7 }
      ],
      value_precision: 2
    };
  }

  setConfig(config) {
    this._config = {
      height: 300,
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      node_text_color: "rgba(255,255,255,0.92)",
      layout: { mode: "auto", columns: 3, gap: 20, padding: 16 },
      dot: { size: 5, glow: true }, // moving dot
      ...config
    };

    if (!this.card) {
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      this.wrapper.style.position = "relative";
      this.wrapper.style.width = "100%";
      this.wrapper.style.height = (this._config.height || 300) + "px";

      // two layers: bg (nodes+lines), fg (moving dots)
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

      this.wrapper.appendChild(this.bg);
      this.wrapper.appendChild(this.fg);
      this.card.appendChild(this.wrapper);
      this.attachShadow({ mode: "open" }).appendChild(this.card);

      this.bgCtx = this.bg.getContext("2d", { alpha: true });
      this.fgCtx = this.fg.getContext("2d", { alpha: true });

      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.wrapper);
      document.addEventListener("visibilitychange", () => {
        this._visible = document.visibilityState === "visible";
      });
      this._visible = true;

      this._phase = 0;
      this._animStart();
    }

    this.card.style.background = this._config.background || "transparent";
    if (this._config.height) this.wrapper.style.height = this._config.height + "px";

    this._prepare();
    this._resize(); // also draws bg
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.nodes?.length) {
      this._nodeValues = this._config.nodes.map((n) => this._readEntity(n.id));
    }
    this._needsBgRedraw = true; // update node texts
  }

  getCardSize() { return Math.ceil((this._config.height || 300) / 50); }
  connectedCallback() { this._animStart(); }
  disconnectedCallback() { this._animStop(); if (this._resizeObserver) this._resizeObserver.disconnect(); }

  // ---------- data ----------
  _prepare() {
    // normalize nodes
    this._nodes = (this._config.nodes || []).map((n, i) => ({
      id: n.id,
      label: n.label || n.id,
      shape: (n.shape || "square").toLowerCase(), // square|rounded|circle
      size: Math.max(44, Number(n.size || 64)),
      ring: n.ring || "#23b0ff",
      fill: n.fill || "#121418",
      ringWidth: Math.max(2, Number(n.ringWidth || 3)),
      text_color: n.color || this._config.node_text_color,
      fontSize: Math.max(11, Number(n.fontSize || 13)),
      x: (typeof n.x === "number") ? this._clamp01(n.x) : null,
      y: (typeof n.y === "number") ? this._clamp01(n.y) : null,
      order: n.order ?? i
    }));

    // auto layout if no x/y
    const needAuto = (this._config.layout?.mode || "auto") === "auto";
    if (needAuto) this._applyAutoLayout();

    // index by id
    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    // links
    this._links = (this._config.links || [])
      .map(l => ({
        from: l.from, to: l.to,
        color: l.color || "rgba(255,255,255,0.8)",
        width: Math.max(1, Number(l.width || 2)),
        speed: Math.max(0.15, Number(l.speed || 0.8)),
        curve: Number.isFinite(l.curve) ? Math.max(-0.35, Math.min(0.35, l.curve)) : 0 // gentle S optional
      }))
      .filter(l => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  _applyAutoLayout() {
    const cols = Math.max(1, Math.floor(this._config.layout.columns || 3));
    const gap = Math.max(8, Number(this._config.layout.gap || 20));
    const pad = Math.max(0, Number(this._config.layout.padding || 12));

    // grid stored in normalized [0..1]
    const rows = Math.ceil(this._nodes.length / cols);
    // positions are assigned later in _resize() because we need actual px size
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

    // place auto grid if enabled
    if (this._auto) {
      const { cols, gap, pad } = this._auto;
      const w = rect.width;
      const h = rect.height;
      const cellW = (w - pad*2 - gap*(cols-1)) / cols;
      const cellH = cellW; // square cells
      const usableH = pad*2 + cellH * Math.ceil(this._nodes.length / cols) + gap*(Math.ceil(this._nodes.length/cols)-1);
      // vertically center grid
      const top = Math.max(pad, (h - usableH)/2);

      this._nodes
        .sort((a,b)=> (a.order ?? 0) - (b.order ?? 0))
        .forEach((n, i) => {
          if (n.x !== null && n.y !== null) return; // manual keeps position
          const r = Math.floor(i / cols);
          const c = i % cols;
          const cx = pad + c*(cellW+gap) + cellW/2;
          const cy = top + r*(cellH+gap) + cellH/2;
          // normalize to [0..1]
          n.x = this._clamp01(cx / w);
          n.y = this._clamp01(cy / h);
        });
    }

    this._needsBgRedraw = true;
  }

  // ---- geometry: intersection with node border ----
  _edgePoint(from, to) {
    // returns point on border of "from" towards "to"
    const ax = from._px.x, ay = from._px.y;
    const bx = to._px.x,   by = to._px.y;
    const dx = bx - ax, dy = by - ay;

    if (from.shape === "circle") {
      const r = from.size/2;
      const len = Math.hypot(dx,dy) || 1;
      return { x: ax + dx/len * r, y: ay + dy/len * r };
    }

    // square/rounded -> axis-aligned rectangle
    const hw = from.size/2, hh = from.size/2;
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: ax + dx * s, y: ay + dy * s };
  }

  // ---- draw static layer (nodes + lines) ----
  _drawBg() {
    const ctx = this.bgCtx;
    const w = this.bg.width  / (window.devicePixelRatio || 1);
    const h = this.bg.height / (window.devicePixelRatio || 1);

    // background
    if (this._config.background && this._config.background !== "transparent") {
      ctx.fillStyle = this._config.background;
      ctx.fillRect(0,0,w,h);
    } else {
      ctx.clearRect(0,0,w,h);
    }

    // cache pixel positions
    for (const n of this._nodes) {
      n._px = { x: n.x * w, y: n.y * h };
    }

    // lines first (static)
    for (const l of this._links) {
      const a = this._nodeMap.get(l.from);
      const b = this._nodeMap.get(l.to);
      if (!a || !b) continue;
      const pA = this._edgePoint(a, b);
      const pB = this._edgePoint(b, a);

      // optional gentle S-curve via single quad control point
      const mx = (pA.x + pB.x) / 2;
      const my = (pA.y + pB.y) / 2;
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      const nx = -dy, ny = dx;
      const cx = mx + nx * (l.curve || 0);
      const cy = my + ny * (l.curve || 0);

      ctx.save();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      if (l.curve) ctx.quadraticCurveTo(cx, cy, pB.x, pB.y);
      else ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.restore();

      // store bezier control for the dot animation
      l._pA = pA; l._pB = pB; l._c = { x: cx, y: cy }; l._curved = !!l.curve;
    }

    // nodes on top
    for (const n of this._nodes) this._drawNode(ctx, n);
  }

  _drawNode(ctx, n) {
    const p = n._px;
    const r = n.size/2;

    // ring + soft glow (no blinking)
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

    // label (top)
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = `bold ${n.fontSize}px ${this._config.font_family}`;
    ctx.fillText(n.label, p.x, p.y - r - 8);
    ctx.restore();

    // value (center)
    const v = this._hass ? this._readEntity(n.id) : { text: "" };
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = n.text_color;
    ctx.font = `bold ${Math.max(12, n.fontSize)}px ${this._config.font_family}`;
    ctx.fillText(v.text, p.x, p.y);
    ctx.restore();
  }

  _strokeShape(ctx, shape, cx, cy, r, size) {
    if (shape === "circle") {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke(); return;
    }
    if (shape === "rounded") {
      const rad = Math.min(14, r);
      this._roundRect(ctx, cx - r, cy - r, size, size, rad); ctx.stroke(); return;
    }
    ctx.strokeRect(cx - r, cy - r, size, size); // square
  }
  _fillShape(ctx, shape, cx, cy, r, size) {
    if (shape === "circle") {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill(); return;
    }
    if (shape === "rounded") {
      const rad = Math.min(14, r);
      this._roundRect(ctx, cx - r, cy - r, size, size, rad); ctx.fill(); return;
    }
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

  // ---- animate dots only (fg layer) ----
  _drawDots() {
    const ctx = this.fgCtx;
    const w = this.fg.width / (window.devicePixelRatio || 1);
    const h = this.fg.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,w,h);

    for (const l of this._links) {
      if (!l._pA || !l._pB) continue;
      const t = ((this._phase * (l.speed || 0.8)) % 1000) / 1000; // 0..1
      const pos = l._curved
        ? this._quadPoint(l._pA, l._c, l._pB, t)
        : { x: l._pA.x + (l._pB.x - l._pA.x)*t, y: l._pA.y + (l._pB.y - l._pA.y)*t };

      ctx.save();
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
    return {
      x: u*u*a.x + 2*u*t*c.x + t*t*b.x,
      y: u*u*a.y + 2*u*t*c.y + t*t*b.y
    };
  }

  // ---- anim loop ----
  _animStart() {
    if (this._raf) return;
    const step = () => {
      this._raf = requestAnimationFrame(step);
      if (!this._visible) return;
      this._phase += 1; // time base
      if (this._needsBgRedraw) { this._drawBg(); this._needsBgRedraw = false; }
      this._drawDots();
    };
    this._raf = requestAnimationFrame(step);
  }
  _animStop(){ if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
}

customElements.define("flow-network-card", FlowNetworkCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "flow-network-card",
  name: "Flow Network Card (elegant neon)",
  description: "Static lines, moving dot, square/rounded nodes, auto layout."
});
