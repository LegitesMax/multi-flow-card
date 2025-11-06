// flow-network-card.js
// Flow Network Card for Home Assistant (no root node)
// • Static lines; only a small moving dot with smooth fade at ends
// • Square/Rounded/Circle nodes with neon ring (no blinking), icons, extra sensor lines
// • Auto grid layout OR manual x/y positions
// • Lines start/stop exactly at node borders
// • Built-in visual editor (vanilla, no HA form deps)

class FlowNetworkCard extends HTMLElement {
  static getStubConfig() {
    return {
      height: 340,
      background: "#121418",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      layout: { mode: "auto", columns: 3, gap: 22, padding: 18 },
      value_precision: 2,
      dot: { size: 5, glow: true, fade_zone: 0.08 },
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
      ]
    };
  }

  static getConfigElement() {
    return document.createElement("flow-network-card-editor-v2");
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

      // two canvas layers
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

      // DOM layer for icons
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
    this._resize();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.nodes?.length) this._nodeValues = this._config.nodes.map(n => this._readEntity(n.id));
    if (this._nodes) this._needsBgRedraw = true;
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
      icon: n.icon || null,
      icon_size: Math.max(14, Number(n.icon_size || Math.round((n.size || 64) * 0.38))),
      icon_color: n.icon_color || "#ffffff",
      top_entities: Array.isArray(n.top_entities) ? n.top_entities : [],
      bottom_entities: Array.isArray(n.bottom_entities) ? n.bottom_entities : []
    }));

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
      const cellH = cellW; // square cells
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
    const hw = from.size/2, hh = from.size/2;
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: ax + dx * s, y: ay + dy * s };
  }

  // ---------- icons ----------
  _ensureIconEl(iconName, color, size) {
    let el = this._iconEls.get(iconName);
    if (!el) {
      el = document.createElement("ha-icon");
      el.style.position = "absolute";
      el.style.transform = "translate(-50%, -50%)";
      el.style.pointerEvents = "none";
      this.iconLayer.appendChild(el);
      this._iconEls.set(iconName, el);
    }
    el.setAttribute("icon", iconName);
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
      const px = { x: n.x * w, y: n.y * h };
      const el = this._ensureIconEl(n.icon, n.icon_color || "#fff", n.icon_size);
      el.style.left = px.x + "px";
      el.style.top  = px.y + "px";
    }
  }

  // ---------- draw (background) ----------
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

    for (const n of this._nodes) n._px = { x: n.x * w, y: n.y * h };

    // static lines
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

    // neon ring (soft glow, no flicker)
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

    // main value (center; slight offset if icon)
    const v = this._hass ? this._readEntity(n.id) : { text: "" };
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = n.text_color;
    ctx.font = `bold ${Math.max(12, n.fontSize)}px ${this._config.font_family}`;
    ctx.fillText(v.text, p.x, p.y + Math.max(0, (n.icon ? n.icon_size * 0.30 : 0)));
    ctx.restore();

    // extra top sensors
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

    // extra bottom sensors
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

  // ---------- dot animation ----------
  _drawDots(dtMs) {
    const ctx = this.fgCtx;
    const w = this.fg.width / (window.devicePixelRatio || 1);
    const h = this.fg.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,w,h);

    const fadeZone = Math.max(0.02, this._config.dot.fade_zone || 0.08);

    for (const l of this._links) {
      if (!l._pA || !l._pB) continue;

      // real-time phase for smoothness
      l._t = ((l._t ?? 0) + (dtMs/1000) * (l.speed || 0.8)) % 1;
      const t = l._t;

      const pos = l._curved
        ? this._quadPoint(l._pA, l._c, l._pB, t)
        : { x: l._pA.x + (l._pB.x - l._pA.x)*t, y: l._pA.y + (l._pB.y - l._pA.y)*t };

      // smooth fade near ends
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

// register card
customElements.define("flow-network-card", FlowNetworkCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "flow-network-card",
  name: "Flow Network Card (icons + smooth dot)",
  description: "Static lines, smooth moving dot, neon nodes, auto layout, extra sensors.",
  preview: true
});

/* ============================
   Visual Editor (vanilla v2)
   ============================ */
class FlowNetworkCardEditorV2 extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = {
      type: "custom:flow-network-card",
      background: config?.background ?? "transparent",
      height: Number.isFinite(config?.height) ? config.height : 320,
      value_precision: Number.isFinite(config?.value_precision) ? config.value_precision : 2,
      layout: { mode: "auto", columns: 3, gap: 20, padding: 16, ...(config?.layout || {}) },
      dot: { size: 5, glow: true, fade_zone: 0.08, ...(config?.dot || {}) },
      nodes: Array.isArray(config?.nodes) ? config.nodes : [],
      links: Array.isArray(config?.links) ? config.links : []
    };
    this._render();
  }

  set hass(hass) { this._hass = hass; }
  get value() { return this._config; }

  _emitChange() {
    const ev = new Event("config-changed", { bubbles: true, composed: true });
    ev.detail = { config: this._config };
    this.dispatchEvent(ev);
  }

  _render() {
    const css = `
      :host { display:block; font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--primary-text-color, #fff); }
      .wrap { display:grid; gap:16px; padding:8px 8px 16px; }
      fieldset { border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:12px; }
      legend { opacity: .8; padding:0 6px; }
      .row { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:10px; }
      .row3 { grid-template-columns: repeat(3, minmax(0,1fr)); }
      .row2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
      label { display:flex; flex-direction:column; gap:6px; }
      input, select { background:#1f2328; color:#e6edf3; border:1px solid #30363d; border-radius:8px; padding:8px 10px; }
      .list { display:flex; flex-direction:column; gap:10px; }
      .item { border:1px dashed rgba(255,255,255,0.15); border-radius:10px; padding:10px; }
      .item > .row { margin-top:8px; }
      .btns { display:flex; gap:8px; margin-top:10px; }
      button { background:#2d333b; color:#e6edf3; border:1px solid #30363d; padding:6px 10px; border-radius:8px; cursor:pointer; }
      button:hover { filter: brightness(1.1); }
      .muted { opacity:.75; font-size:12px; }
    `;
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="wrap">
        <fieldset>
          <legend>Allgemein</legend>
          <div class="row row3">
            <label> Hintergrund
              <input type="text" data-k="background" value="${this._config.background}">
            </label>
            <label> Höhe (px)
              <input type="number" min="180" max="1200" step="10" data-k="height" value="${this._config.height}">
            </label>
            <label> Nachkommastellen
              <input type="number" min="0" max="4" step="1" data-k="value_precision" value="${this._config.value_precision}">
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Auto-Layout & Dot</legend>
          <div class="row">
            <label> Layout-Modus
              <select data-k="layout.mode">
                <option value="auto" ${this._config.layout.mode==="auto"?"selected":""}>auto</option>
                <option value="manual" ${this._config.layout.mode==="manual"?"selected":""}>manual (x/y an Nodes)</option>
              </select>
            </label>
            <label> Spalten
              <input type="number" min="1" max="8" step="1" data-k="layout.columns" value="${this._config.layout.columns}">
            </label>
            <label> Gap
              <input type="number" min="0" max="80" step="1" data-k="layout.gap" value="${this._config.layout.gap}">
            </label>
            <label> Padding
              <input type="number" min="0" max="120" step="1" data-k="layout.padding" value="${this._config.layout.padding}">
            </label>
          </div>
          <div class="row row3" style="margin-top:8px">
            <label> Punkt-Größe
              <input type="number" min="2" max="12" step="1" data-k="dot.size" value="${this._config.dot.size}">
            </label>
            <label> Fade-Zone (0–0.3)
              <input type="number" min="0" max="0.3" step="0.01" data-k="dot.fade_zone" value="${this._config.dot.fade_zone}">
            </label>
            <label> Glow
              <select data-k="dot.glow">
                <option value="true" ${this._config.dot.glow?"selected":""}>an</option>
                <option value="false" ${!this._config.dot.glow?"selected":""}>aus</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Nodes (Karten)</legend>
          <div class="list" id="nodes"></div>
          <div class="btns">
            <button id="addNode">+ Node</button>
          </div>
          <div class="muted">Bei <b>manual</b> Layout x/y (0..1) setzen. Top/Bottom-Sensoren als Komma-Liste.</div>
        </fieldset>

        <fieldset>
          <legend>Links (Verbindungen)</legend>
          <div class="list" id="links"></div>
          <div class="btns">
            <button id="addLink">+ Link</button>
          </div>
          <div class="muted">Kurve ist optional (-0.35..0.35). Linien sind statisch; nur der Punkt bewegt sich.</div>
        </fieldset>
      </div>
    `;

    // root inputs
    this.shadowRoot.querySelectorAll('input[data-k], select[data-k]').forEach(el => {
      el.addEventListener('input', () => {
        const path = el.dataset.k.split('.');
        let target = this._config;
        for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
        const key = path[path.length - 1];
        let val = el.value;
        if (el.type === 'number') val = Number(val);
        if (el.tagName === 'SELECT' && (val === 'true' || val === 'false')) val = (val === 'true');
        target[key] = val;
        this._emitChange();
      });
    });

    // lists
    this._renderNodes();
    this._renderLinks();

    // add buttons
    this.shadowRoot.getElementById('addNode').onclick = () => {
      this._config.nodes.push({
        id: "", label: "", shape: "rounded", size: 70,
        ring: "#23b0ff", fill: "#0f1a22", icon: "", icon_size: 26, icon_color: "#ffffff",
        top_entities: [], bottom_entities: []
      });
      this._renderNodes();
      this._emitChange();
    };
    this.shadowRoot.getElementById('addLink').onclick = () => {
      this._config.links.push({ from: "", to: "", color: "#23b0ff", width: 2, speed: 0.8, curve: 0 });
      this._renderLinks();
      this._emitChange();
    };
  }

  _renderNodes() {
    const host = this.shadowRoot.getElementById('nodes');
    host.innerHTML = '';
    this._config.nodes.forEach((n, i) => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="row">
          <label>ID (Entity)<input type="text" data-k="id" value="${n.id ?? ''}"></label>
          <label>Label<input type="text" data-k="label" value="${n.label ?? ''}"></label>
          <label>Shape
            <select data-k="shape">
              <option value="square" ${n.shape==='square'?'selected':''}>square</option>
              <option value="rounded" ${n.shape==='rounded'?'selected':''}>rounded</option>
              <option value="circle" ${n.shape==='circle'?'selected':''}>circle</option>
            </select>
          </label>
          <label>Size<input type="number" min="44" max="160" step="1" data-k="size" value="${n.size ?? 70}"></label>
        </div>
        <div class="row">
          <label>Ring-Farbe<input type="text" data-k="ring" value="${n.ring ?? '#23b0ff'}"></label>
          <label>Fill-Farbe<input type="text" data-k="fill" value="${n.fill ?? '#0f1a22'}"></label>
          <label>Ring-Breite<input type="number" min="2" max="8" step="1" data-k="ringWidth" value="${n.ringWidth ?? 3}"></label>
          <label>Text-Farbe<input type="text" data-k="color" value="${n.color ?? ''}"></label>
        </div>
        <div class="row">
          <label>Icon (mdi:... )<input type="text" data-k="icon" value="${n.icon ?? ''}"></label>
          <label>Icon-Größe<input type="number" min="14" max="64" step="1" data-k="icon_size" value="${n.icon_size ?? 26}"></label>
          <label>Icon-Farbe<input type="text" data-k="icon_color" value="${n.icon_color ?? '#ffffff'}"></label>
          <label>Order<input type="number" step="1" data-k="order" value="${n.order ?? i}"></label>
        </div>
        <div class="row">
          <label>x (0..1)<input type="number" step="0.01" min="0" max="1" data-k="x" value="${n.x ?? ''}"></label>
          <label>y (0..1)<input type="number" step="0.01" min="0" max="1" data-k="y" value="${n.y ?? ''}"></label>
          <label>Font Size<input type="number" step="1" min="10" max="24" data-k="fontSize" value="${n.fontSize ?? 13}"></label>
          <span></span>
        </div>
        <div class="row row2">
          <label>Top-Sensoren (Komma-IDs)
            <input type="text" data-k="top_entities" value="${(n.top_entities||[]).map(e=>e.id).join(', ')}">
          </label>
          <label>Bottom-Sensoren (Komma-IDs)
            <input type="text" data-k="bottom_entities" value="${(n.bottom_entities||[]).map(e=>e.id).join(', ')}">
          </label>
        </div>
        <div class="btns"><button data-act="del">– Entfernen</button></div>
      `;
      el.querySelectorAll('[data-k]').forEach(inp => {
        inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          let val = inp.value;
          if (['size','ringWidth','icon_size','order','fontSize'].includes(k)) val = Number(val);
          if (['x','y'].includes(k)) val = (val === '' ? null : Math.max(0, Math.min(1, Number(val))));
          if (k === 'top_entities' || k === 'bottom_entities') {
            const ids = String(val).split(',').map(s=>s.trim()).filter(Boolean);
            n[k] = ids.map(id => ({ id }));
          } else {
            n[k] = val;
          }
          this._emitChange();
        });
      });
      el.querySelector('[data-act="del"]').onclick = () => {
        this._config.nodes.splice(i,1);
        this._renderNodes();
        this._emitChange();
      };
      host.appendChild(el);
    });
  }

  _renderLinks() {
    const host = this.shadowRoot.getElementById('links');
    host.innerHTML = '';
    this._config.links.forEach((l, i) => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="row">
          <label>From<input type="text" data-k="from" value="${l.from ?? ''}"></label>
          <label>To<input type="text" data-k="to" value="${l.to ?? ''}"></label>
          <label>Farbe<input type="text" data-k="color" value="${l.color ?? '#23b0ff'}"></label>
          <label>Breite<input type="number" min="1" max="6" step="1" data-k="width" value="${l.width ?? 2}"></label>
        </div>
        <div class="row row3">
          <label>Speed<input type="number" min="0.05" max="3" step="0.05" data-k="speed" value="${l.speed ?? 0.8}"></label>
          <label>Kurve (-0.35..0.35)<input type="number" min="-0.35" max="0.35" step="0.01" data-k="curve" value="${l.curve ?? 0}"></label>
          <span></span>
        </div>
        <div class="btns"><button data-act="del">– Entfernen</button></div>
      `;
      el.querySelectorAll('[data-k]').forEach(inp => {
        inp.addEventListener('input', () => {
          const k = inp.dataset.k;
          let val = inp.value;
          if (['width','speed','curve'].includes(k)) val = Number(val);
          l[k] = val;
          this._emitChange();
        });
      });
      el.querySelector('[data-act="del"]').onclick = () => {
        this._config.links.splice(i,1);
        this._renderLinks();
        this._emitChange();
      };
      host.appendChild(el);
    });
  }

  getCardSize() { return 3; }
}
customElements.define("flow-network-card-editor-v2", FlowNetworkCardEditorV2);
