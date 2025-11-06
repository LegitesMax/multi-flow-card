// flow-network-card.js
// Flow Network Card (no root) + Visual Editor V4 (HA controls)
// - Static lines; only a small moving dot with smooth fade
// - Square/Rounded/Circle nodes with neon ring (+icon, extra sensor lines)
// - Auto grid layout centered per row; manual x/y optional
// - Lines start/stop exactly at node border
// - Labels auto-avoid lines: above/below chosen opposite to average link direction
// - Visual editor uses Home Assistant pickers (entity, icon, color)

class FlowNetworkCard extends HTMLElement {
  static getStubConfig() {
    return {
      height: 320,
      background: "#14171a",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      layout: { mode: "auto", columns: 3, gap: 22, padding: 18 },
      dot: { size: 5, glow: true, fade_zone: 0.10 },
      nodes: [
        { id: "sensor.grid_power",   label: "Netz",     shape: "rounded", size: 72, ring: "#8a2be2", fill: "#1c1426", icon: "mdi:transmission-tower", icon_size: 28, icon_color: "#caa9ff" },
        { id: "sensor.pv_power",     label: "PV",       shape: "rounded", size: 72, ring: "#7cffcb", fill: "#0f2a22", icon: "mdi:solar-power-variant-outline", icon_size: 28, icon_color: "#baffea" },
        { id: "sensor.battery",      label: "Batterie", shape: "rounded", size: 72, ring: "#ff6b6b", fill: "#2a1f22", icon: "mdi:battery-high", icon_size: 26, icon_color: "#ffc2c2" },
        { id: "sensor.house_power",  label: "Zuhause",  shape: "rounded", size: 80, ring: "#23b0ff", fill: "#0f1a22", icon: "mdi:home-variant", icon_size: 28, icon_color: "#99dbff" }
      ],
      links: [
        { from: "sensor.grid_power", to: "sensor.house_power", color: "#8a2be2", width: 2, speed: 0.8 },
        { from: "sensor.pv_power",   to: "sensor.house_power", color: "#7cffcb", width: 2, speed: 0.9 },
        { from: "sensor.battery",    to: "sensor.house_power", color: "#ff6b6b", width: 2, speed: 0.7 }
      ]
    };
  }

  static getConfigElement() {
    return document.createElement("flow-network-card-editor-v4");
  }

  setConfig(config) {
    this._config = {
      height: 320,
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      node_text_color: "rgba(255,255,255,0.92)",
      layout: { mode: "auto", columns: 3, gap: 20, padding: 16 },
      dot: { size: 5, glow: true, fade_zone: 0.10 },
      ...config
    };

    if (!this.card) {
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      Object.assign(this.wrapper.style, { position: "relative", width: "100%", height: (this._config.height || 320) + "px" });

      this.bg = document.createElement("canvas");
      this.fg = document.createElement("canvas");
      for (const c of [this.bg, this.fg]) Object.assign(c.style, { display: "block", width: "100%", height: "100%", position: "absolute", inset: "0" });

      this.iconLayer = document.createElement("div");
      Object.assign(this.iconLayer.style, { position: "absolute", inset: "0", pointerEvents: "none" });

      this.wrapper.append(this.bg, this.fg, this.iconLayer);
      this.card.appendChild(this.wrapper);
      this.attachShadow({ mode: "open" }).appendChild(this.card);

      this.bgCtx = this.bg.getContext("2d", { alpha: true });
      this.fgCtx = this.fg.getContext("2d", { alpha: true });

      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.wrapper);
      this._visible = true;
      document.addEventListener("visibilitychange", () => this._visible = document.visibilityState === "visible");

      this._lastTs = 0;
      this._iconEls = new Map(); // key by node.id
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
      id: n.id, label: n.label || n.id,
      shape: (n.shape || "rounded").toLowerCase(), // square|rounded|circle
      size: Math.max(44, Number(n.size || 64)),
      ring: n.ring || "#23b0ff", fill: n.fill || "#121418",
      ringWidth: Math.max(2, Number(n.ringWidth || 3)),
      text_color: n.color || this._config.node_text_color,
      fontSize: Math.max(11, Number(n.fontSize || 13)),
      x: (this._config.layout?.mode === "manual" && typeof n.x === "number") ? this._clamp01(n.x) : null,
      y: (this._config.layout?.mode === "manual" && typeof n.y === "number") ? this._clamp01(n.y) : null,
      order: n.order ?? i,
      icon: n.icon || null, icon_size: Math.max(14, Number(n.icon_size || Math.round((n.size || 64) * 0.38))),
      icon_color: n.icon_color || "#ffffff",
      top_entities: Array.isArray(n.top_entities) ? n.top_entities : [],
      bottom_entities: Array.isArray(n.bottom_entities) ? n.bottom_entities : [],
      _labelSide: "top" // computed later
    }));

    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    this._links = (this._config.links || [])
      .map(l => ({
        from: l.from, to: l.to,
        color: l.color || "rgba(255,255,255,0.85)",
        width: Math.max(1, Number(l.width || 2)),
        speed: Math.max(0.05, Number(l.speed || 0.8)),
        curve: Number.isFinite(l.curve) ? Math.max(-0.35, Math.min(0.35, l.curve)) : 0,
        _t: 0
      }))
      .filter(l => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  _applyAutoLayout(pxW, pxH) {
    const cfg = this._config.layout || {};
    const cols = Math.max(1, Math.floor(cfg.columns || 3));
    const gap = Math.max(8, Number(cfg.gap || 20));
    const pad = Math.max(8, Number(cfg.padding || 16));

    const n = this._nodes.length;
    const rows = Math.ceil(n / cols);

    // base cell size from width; fit to height if needed
    const cellW = (pxW - pad*2 - gap*(cols-1)) / cols;
    const cellH = cellW; // squares
    const totalH = pad*2 + rows*cellH + gap*(rows-1);
    const scale = totalH > pxH ? (pxH - pad*2 - gap*(rows-1)) / (rows * cellH) : 1;
    const cw = cellW * scale, ch = cellH * scale;

    this._nodes.sort((a,b)=> (a.order ?? 0) - (b.order ?? 0)).forEach((n, idx) => {
      const r = Math.floor(idx / cols);
      const leftInRow = Math.min(cols, (this._nodes.length - r*cols)); // items in this row
      const rowWidth = leftInRow*cw + (leftInRow-1)*gap;
      const leftOffset = (pxW - rowWidth)/2; // <-- center this row horizontally
      const c = idx % cols;
      const cx = leftOffset + c*(cw+gap) + cw/2;
      const top = (pxH - (rows*ch + (rows-1)*gap))/2;
      const cy = top + r*(ch+gap) + ch/2;
      n.x = this._clamp01(cx / pxW);
      n.y = this._clamp01(cy / pxH);
    });
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

    if ((this._config.layout?.mode || "auto") === "auto") {
      this._applyAutoLayout(rect.width, rect.height);       // centered rows
    } else {
      // manual: keep nodes inside bounds
      for (const n of this._nodes) {
        const r = (n.size/2) / rect.width;
        const ry = (n.size/2) / rect.height;
        n.x = Math.max(r, Math.min(1 - r, n.x ?? 0.5));
        n.y = Math.max(ry, Math.min(1 - ry, n.y ?? 0.5));
      }
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
  _ensureIconEl(key, iconName, color, size) {
    let el = this._iconEls.get(key);
    if (!el) {
      el = document.createElement("ha-icon");
      Object.assign(el.style, { position: "absolute", transform: "translate(-50%, -50%)", pointerEvents: "none" });
      this.iconLayer.appendChild(el);
      this._iconEls.set(key, el);
    }
    el.setAttribute("icon", iconName);
    el.style.color = color;
    el.style.width = size + "px";
    el.style.height = size + "px";
    return el;
  }

  _positionIcons() {
    const rect = this.wrapper.getBoundingClientRect();
    for (const n of this._nodes) {
      if (!n.icon) continue;
      const px = { x: n.x * rect.width, y: n.y * rect.height };
      const el = this._ensureIconEl(n.id, n.icon, n.icon_color || "#fff", n.icon_size);
      el.style.left = px.x + "px";
      el.style.top  = px.y + "px";
    }
  }

  // ---------- label side computation ----------
  _computeLabelSides() {
    // sum direction vectors for each node, then set label opposite to avg dy
    const sum = new Map(this._nodes.map(n => [n.id, {dx:0, dy:0, count:0}]));
    for (const l of this._links) {
      const a = this._nodeMap.get(l.from), b = this._nodeMap.get(l.to);
      if (!a || !b) continue;
      const va = { dx: b._px.x - a._px.x, dy: b._px.y - a._px.y };
      const vb = { dx: a._px.x - b._px.x, dy: a._px.y - b._px.y };
      const sa = sum.get(a.id); sa.dx += va.dx; sa.dy += va.dy; sa.count++;
      const sb = sum.get(b.id); sb.dx += vb.dx; sb.dy += vb.dy; sb.count++;
    }
    for (const n of this._nodes) {
      const s = sum.get(n.id);
      if (!s || s.count === 0) { n._labelSide = "top"; continue; }
      // if flows go mostly upwards (avg dy < 0), put label BELOW (to avoid line above)
      n._labelSide = (s.dy < 0) ? "bottom" : "top";
    }
  }

  // ---------- draw background ----------
  _drawBg() {
    const ctx = this.bgCtx;
    const w = this.bg.width  / (window.devicePixelRatio || 1);
    const h = this.bg.height / (window.devicePixelRatio || 1);

    if (this._config.background && this._config.background !== "transparent") {
      ctx.fillStyle = this._config.background;
      ctx.fillRect(0,0,w,h);
    } else ctx.clearRect(0,0,w,h);

    for (const n of this._nodes) n._px = { x: n.x * w, y: n.y * h };

    // lines first
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
      ctx.strokeStyle = l.color; ctx.lineWidth = l.width;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      if (l.curve) ctx.quadraticCurveTo(cx, cy, pB.x, pB.y);
      else ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.restore();

      l._pA = pA; l._pB = pB; l._c = { x: cx, y: cy }; l._curved = !!l.curve;
    }

    // compute label sides now that positions and links are known
    this._computeLabelSides();

    // nodes
    for (const n of this._nodes) this._drawNode(ctx, n);
  }

  _drawNode(ctx, n) {
    const p = n._px, r = n.size/2;

    // neon ring
    ctx.save();
    ctx.shadowColor = n.ring; ctx.shadowBlur = 18;
    ctx.lineWidth = n.ringWidth; ctx.strokeStyle = n.ring;
    this._strokeShape(ctx, n.shape, p.x, p.y, r, n.size);
    ctx.restore();

    // fill
    ctx.save(); ctx.fillStyle = n.fill;
    this._fillShape(ctx, n.shape, p.x, p.y, r, n.size);
    ctx.restore();

    // label (auto: top or bottom based on flow)
    const labelAbove = (n._labelSide === "top");
    const labelY = labelAbove ? (p.y - r - 8) : (p.y + r + 8);
    const baseline = labelAbove ? "bottom" : "top";
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = baseline;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `bold ${n.fontSize}px ${this._config.font_family}`;
    ctx.fillText(n.label, p.x, labelY);
    ctx.restore();

    // main value (center; slight offset if icon)
    const v = this._hass ? this._readEntity(n.id) : { text: "" };
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = n.text_color;
    ctx.font = `bold ${Math.max(12, n.fontSize)}px ${this._config.font_family}`;
    ctx.fillText(v.text, p.x, p.y + (n.icon ? n.icon_size * 0.30 : 0));
    ctx.restore();
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

  // ---------- dots ----------
  _drawDots(dtMs) {
    const ctx = this.fgCtx;
    const w = this.fg.width / (window.devicePixelRatio || 1);
    const h = this.fg.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,w,h);

    const fadeZone = Math.max(0.02, this._config.dot.fade_zone || 0.10);

    for (const l of this._links) {
      if (!l._pA || !l._pB) continue;
      l._t = (l._t + (dtMs/1000) * (l.speed || 0.8)) % 1;
      const t = l._t;

      const pos = l._curved
        ? this._quadPoint(l._pA, l._c, l._pB, t)
        : { x: l._pA.x + (l._pB.x - l._pA.x)*t, y: l._pA.y + (l._pB.y - l._pA.y)*t };

      let alpha = 1;
      if (t < fadeZone) alpha = t / fadeZone;
      else if (t > 1 - fadeZone) alpha = (1 - t) / fadeZone;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      if (this._config.dot.glow) { ctx.shadowColor = l.color; ctx.shadowBlur = 8; }
      ctx.fillStyle = l.color;
      const r = Math.max(3, this._config.dot.size || 5);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  _quadPoint(a, c, b, t) { const u = 1 - t; return { x: u*u*a.x + 2*u*t*c.x + t*t*b.x, y: u*u*a.y + 2*u*t*c.y + t*t*b.y }; }

  // ---------- loop ----------
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
  name: "Flow Network Card (HA editor)",
  description: "Static lines, smooth dot, neon nodes; centered auto layout; smart labels.",
  preview: true
});

/* ======================
   VISUAL EDITOR V4 (HA controls)
   ====================== */
class FlowNetworkCardEditorV4 extends HTMLElement {
  constructor(){ super(); this.attachShadow({mode:"open"}); this._config={}; }
  set hass(h){ this._hass = h; }
  get value(){ return this._config; }

  setConfig(config) {
    this._config = {
      type: "custom:flow-network-card",
      background: config?.background ?? "transparent",
      height: Number.isFinite(config?.height) ? config.height : 320,
      value_precision: Number.isFinite(config?.value_precision) ? config.value_precision : 2,
      layout: { mode: (config?.layout?.mode)||"auto", columns: config?.layout?.columns ?? 3, gap: config?.layout?.gap ?? 20, padding: config?.layout?.padding ?? 16 },
      dot: { size: config?.dot?.size ?? 5, glow: config?.dot?.glow ?? true, fade_zone: config?.dot?.fade_zone ?? 0.10 },
      nodes: Array.isArray(config?.nodes) ? config.nodes : [],
      links: Array.isArray(config?.links) ? config.links : []
    };
    this._render();
  }

  _emit(){
    const e = new Event("config-changed",{bubbles:true,composed:true});
    e.detail = { config: this._config };
    this.dispatchEvent(e);
  }

  _render(){
    const css = `
      :host{display:block}
      .wrap{padding:8px 8px 16px; display:grid; gap:14px}
      ha-expansion-panel{--expansion-panel-summary-padding: 8px 12px}
      .row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .row2{grid-template-columns:repeat(2,minmax(0,1fr))}
      .list{display:flex;flex-direction:column;gap:10px}
      .item{border:1px solid var(--divider-color); border-radius:10px; padding:10px}
      .btns{display:flex;gap:8px;margin-top:10px}
    `;
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="wrap">
        <ha-expansion-panel>
          <div slot="header">Allgemein</div>
          <div class="row">
            <ha-color-picker label="Hintergrund" value="${this._config.background}" data-k="background"></ha-color-picker>
            <ha-textfield label="Höhe (px)" type="number" data-k="height" value="${this._config.height}"></ha-textfield>
            <ha-textfield label="Nachkommastellen" type="number" data-k="value_precision" value="${this._config.value_precision}"></ha-textfield>
          </div>
          <div class="row">
            <mwc-select label="Layout" data-k="layout.mode">
              <mwc-list-item value="auto" ?selected=${this._config.layout.mode==="auto"}>auto (empfohlen)</mwc-list-item>
              <mwc-list-item value="manual" ?selected=${this._config.layout.mode!=="auto"}>manuell (x/y)</mwc-list-item>
            </mwc-select>
            <ha-textfield label="Spalten" type="number" data-k="layout.columns" value="${this._config.layout.columns}"></ha-textfield>
            <ha-textfield label="Gap" type="number" data-k="layout.gap" value="${this._config.layout.gap}"></ha-textfield>
          </div>
          <div class="row">
            <ha-textfield label="Padding" type="number" data-k="layout.padding" value="${this._config.layout.padding}"></ha-textfield>
            <ha-textfield label="Punkt-Größe" type="number" data-k="dot.size" value="${this._config.dot.size}"></ha-textfield>
            <ha-textfield label="Fade-Zone (0–0.3)" type="number" data-k="dot.fade_zone" value="${this._config.dot.fade_zone}"></ha-textfield>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel opened>
          <div slot="header">Nodes</div>
          <div class="list" id="nodes"></div>
          <div class="btns"><mwc-button unelevated id="addNode">+ Node</mwc-button></div>
        </ha-expansion-panel>

        <ha-expansion-panel opened>
          <div slot="header">Links</div>
          <div class="list" id="links"></div>
          <div class="btns"><mwc-button unelevated id="addLink">+ Link</mwc-button></div>
        </ha-expansion-panel>
      </div>
    `;

    // bind basics
    this.shadowRoot.querySelectorAll('[data-k]').forEach(el=>{
      el.addEventListener('value-changed', (ev)=>{
        const val = ev.detail?.value ?? el.value ?? el.getAttribute('value');
        const path = el.dataset.k.split('.');
        let t=this._config; for(let i=0;i<path.length-1;i++) t=t[path[i]];
        t[path[path.length-1]] = (el.type==="number") ? Number(val) : val;
        this._emit();
      });
    });

    // lists
    this._renderNodes();
    this._renderLinks();

    // add buttons
    this.shadowRoot.getElementById('addNode').addEventListener('click', ()=>{
      this._config.nodes.push({ id:"", label:"", shape:"rounded", size:70, ring:"#23b0ff", fill:"#0f1a22", icon:"", icon_size:26, icon_color:"#ffffff" });
      this._renderNodes(); this._emit();
    });
    this.shadowRoot.getElementById('addLink').addEventListener('click', ()=>{
      this._config.links.push({ from:"", to:"", color:"#23b0ff", width:2, speed:0.8, curve:0 });
      this._renderLinks(); this._emit();
    });
  }

  _renderNodes(){
    const host = this.shadowRoot.getElementById('nodes');
    host.innerHTML = '';
    this._config.nodes.forEach((n, i)=>{
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="row">
          <ha-entity-picker label="Entity (Sensor/Gerät)" .hass=${this._hass} data-k="id" .value=${n.id||""}></ha-entity-picker>
          <ha-textfield label="Label" data-k="label" value="${n.label||""}"></ha-textfield>
          <ha-icon-picker label="Icon" .hass=${this._hass} data-k="icon" .value=${n.icon||""}></ha-icon-picker>
        </div>
        <div class="row">
          <ha-color-picker label="Ring-Farbe" value="${n.ring||'#23b0ff'}" data-k="ring"></ha-color-picker>
          <ha-color-picker label="Fill-Farbe" value="${n.fill||'#0f1a22'}" data-k="fill"></ha-color-picker>
          <ha-color-picker label="Icon-Farbe" value="${n.icon_color||'#ffffff'}" data-k="icon_color"></ha-color-picker>
        </div>
        <div class="row">
          <mwc-select label="Shape" data-k="shape">
            <mwc-list-item value="rounded" ?selected=${(n.shape||'rounded')==='rounded'}>rounded</mwc-list-item>
            <mwc-list-item value="square"  ?selected=${n.shape==='square'}>square</mwc-list-item>
            <mwc-list-item value="circle"  ?selected=${n.shape==='circle'}>circle</mwc-list-item>
          </mwc-select>
          <ha-textfield label="Size" type="number" data-k="size" value="${n.size??70}"></ha-textfield>
          <ha-textfield label="Icon-Größe" type="number" data-k="icon_size" value="${n.icon_size??26}"></ha-textfield>
        </div>
        <ha-formfield label="Erweitert (x/y manuell)">
          <ha-switch id="adv${i}"></ha-switch>
        </ha-formfield>
        <div class="row row2" id="advArea${i}" style="display:none;">
          <ha-textfield label="x (0..1)" type="number" step="0.01" data-k="x" value="${n.x??""}"></ha-textfield>
          <ha-textfield label="y (0..1)" type="number" step="0.01" data-k="y" value="${n.y??""}"></ha-textfield>
        </div>
        <div class="btns"><mwc-button outlined data-act="del">– Entfernen</mwc-button></div>
      `;
      // wire value-changed for nested controls
      el.querySelectorAll('[data-k]').forEach(ctrl=>{
        ctrl.addEventListener('value-changed', (ev)=>{
          const val = ev.detail?.value ?? ctrl.value ?? ctrl.getAttribute('value');
          const k = ctrl.dataset.k;
          let v = val;
          if (['size','icon_size','fontSize'].includes(k)) v = Number(v);
          if (['x','y'].includes(k)) v = (v===''?null:Math.max(0,Math.min(1,Number(v))));
          n[k] = v; this._emit();
        });
      });
      el.querySelector(`[data-act="del"]`).addEventListener('click', ()=>{ this._config.nodes.splice(i,1); this._renderNodes(); this._emit(); });
      const sw = el.querySelector(`#adv${i}`);
      const area = el.querySelector(`#advArea${i}`);
      sw.addEventListener('change', ()=> area.style.display = sw.checked ? 'grid' : 'none');
      host.appendChild(el);
    });
  }

  _renderLinks(){
    const host = this.shadowRoot.getElementById('links');
    host.innerHTML = '';
    const ids = this._config.nodes.map(n=>n.id).filter(Boolean);
    this._config.links.forEach((l, i)=>{
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="row">
          <mwc-select label="From">
            ${['',...ids].map(id=>`<mwc-list-item value="${id}" ${l.from===id?'selected':''}>${id||'-'}</mwc-list-item>`).join('')}
          </mwc-select>
          <mwc-select label="To">
            ${['',...ids].map(id=>`<mwc-list-item value="${id}" ${l.to===id?'selected':''}>${id||'-'}</mwc-list-item>`).join('')}
          </mwc-select>
          <ha-color-picker label="Farbe" value="${l.color||'#23b0ff'}"></ha-color-picker>
        </div>
        <div class="row">
          <ha-textfield label="Breite" type="number" value="${l.width??2}"></ha-textfield>
          <ha-textfield label="Speed" type="number" value="${l.speed??0.8}"></ha-textfield>
          <ha-textfield label="Kurve (-0.35..0.35)" type="number" value="${l.curve??0}"></ha-textfield>
        </div>
        <div class="btns"><mwc-button outlined data-act="del">– Entfernen</mwc-button></div>
      `;
      const selects = el.querySelectorAll('mwc-select');
      selects[0].addEventListener('selected', (e)=>{ l.from = e.target.value; this._emit(); });
      selects[1].addEventListener('selected', (e)=>{ l.to   = e.target.value; this._emit(); });
      el.querySelector('ha-color-picker').addEventListener('value-changed', (e)=>{ l.color = e.detail.value; this._emit(); });
      const nums = el.querySelectorAll('ha-textfield');
      nums[0].addEventListener('value-changed', (e)=>{ l.width = Number(e.detail.value); this._emit(); });
      nums[1].addEventListener('value-changed', (e)=>{ l.speed = Number(e.detail.value); this._emit(); });
      nums[2].addEventListener('value-changed', (e)=>{ l.curve = Number(e.detail.value); this._emit(); });
      el.querySelector('[data-act="del"]').addEventListener('click', ()=>{ this._config.links.splice(i,1); this._renderLinks(); this._emit(); });
      host.appendChild(el);
    });
  }

  getCardSize(){ return 3; }
}
customElements.define("flow-network-card-editor-v4", FlowNetworkCardEditorV4);
