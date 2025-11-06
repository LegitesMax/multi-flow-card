// flow-network-card.js
// Flow Network Card (no root) + Simple Visual Editor V6
// CHANGES:
// - Node has `id` (your friendly key like "pv") AND `entity` (the real HA sensor)
// - Links use Node IDs for from/to
// - Each link can have `flow_entity` (separate from the node's entity) to control direction/stop

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
        { id: "netz",  label: "Netz",     entity: "sensor.grid_power",   shape: "rounded", size: 72, ring: "#8a2be2", fill: "#1c1426", icon: "mdi:transmission-tower", icon_size: 28, icon_color: "#caa9ff" },
        { id: "pv",    label: "PV",       entity: "sensor.pv_power",     shape: "rounded", size: 72, ring: "#7cffcb", fill: "#0f2a22", icon: "mdi:solar-power-variant-outline", icon_size: 28, icon_color: "#baffea" },
        { id: "batt",  label: "Batterie", entity: "sensor.battery_power",shape: "rounded", size: 72, ring: "#ff6b6b", fill: "#2a1f22", icon: "mdi:battery-high", icon_size: 26, icon_color: "#ffc2c2" },
        { id: "home",  label: "Zuhause",  entity: "sensor.house_power",  shape: "rounded", size: 80, ring: "#23b0ff", fill: "#0f1a22", icon: "mdi:home-variant", icon_size: 28, icon_color: "#99dbff" }
      ],
      links: [
        { from: "netz", to: "home", color: "#8a2be2", width: 2, speed: 0.8, flow_entity: "sensor.grid_to_home_kw", zero_threshold: 0.01 },
        { from: "pv",   to: "home", color: "#7cffcb", width: 2, speed: 0.9, flow_entity: "sensor.pv_to_home_kw",   zero_threshold: 0.01 },
        { from: "batt", to: "home", color: "#ff6b6b", width: 2, speed: 0.7, flow_entity: "sensor.batt_flow_kw",     zero_threshold: 0.01 }
      ]
    };
  }
  static getConfigElement() {
    return document.createElement("flow-network-card-editor-v6");
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
      value_below_icon_factor: 0.65,
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
      this._iconEls = new Map(); // keyed by node.id
      this._animStart();
    }

    this.card.style.background = this._config.background || "transparent";
    if (this._config.height) this.wrapper.style.height = this._config.height + "px";

    this._prepare();
    this._resize();
    this._updateLinkDirections();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._nodes) this._needsBgRedraw = true;
    this._updateLinkDirections();
  }

  getCardSize() { return Math.ceil((this._config.height || 320) / 50); }
  connectedCallback(){ this._animStart(); }
  disconnectedCallback(){ this._animStop(); if (this._resizeObserver) this._resizeObserver.disconnect(); }

  // ---------- data ----------
  _prepare() {
    this._nodes = (this._config.nodes || []).map((n, i) => ({
      id: String(n.id || `n${i}`),                      // friendly ID like "pv"
      label: n.label || n.id,
      entity: n.entity || "",                           // real sensor for value
      shape: (n.shape || "rounded").toLowerCase(),
      size: Math.max(44, Number(n.size || 64)),
      ring: n.ring || "#23b0ff", fill: n.fill || "#121418",
      ringWidth: Math.max(2, Number(n.ringWidth || 3)),
      text_color: n.color || this._config.node_text_color,
      fontSize: Math.max(11, Number(n.fontSize || 13)),
      x: (this._config.layout?.mode === "manual" && typeof n.x === "number") ? this._clamp01(n.x) : null,
      y: (this._config.layout?.mode === "manual" && typeof n.y === "number") ? this._clamp01(n.y) : null,
      order: n.order ?? i,
      icon: n.icon || null,
      icon_size: Math.max(14, Number(n.icon_size || Math.round((n.size || 64) * 0.38))),
      icon_color: n.icon_color || "#ffffff",
      _labelSide: "top"
    }));

    // map by NODE ID
    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    // links use NODE IDs; direction controlled by flow_entity
	this._links = (this._config.links || [])
	  .map(l => ({
		from: String(l.from || ""),
		to: String(l.to || ""),
		color: l.color || "rgba(255,255,255,0.85)",
		width: Math.max(1, Number(l.width || 2)),
		speed: Math.max(0.05, Number(l.speed || 0.8)),
		curve: Number.isFinite(l.curve) ? Math.max(-0.35, Math.min(0.35, l.curve)) : 0,
		flow_entity: l.flow_entity || l.entity || null,
		zero_threshold: Number.isFinite(l.zero_threshold) ? Math.max(0, l.zero_threshold) : 0.0001,
		_t: 0,
		_dir: 0 // <--- vorher 1; jetzt default: keine Animation
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
    const cellW = (pxW - pad*2 - gap*(cols-1)) / cols;
    const cellH = cellW;
    const totalH = pad*2 + rows*cellH + gap*(rows-1);
    const scale = totalH > pxH ? (pxH - pad*2 - gap*(rows-1)) / (rows * cellH) : 1;
    const cw = cellW * scale, ch = cellH * scale;

    this._nodes.sort((a,b)=> (a.order ?? 0) - (b.order ?? 0)).forEach((n, idx) => {
      const r = Math.floor(idx / cols);
      const leftInRow = Math.min(cols, (this._nodes.length - r*cols));
      const rowWidth = leftInRow*cw + (leftInRow-1)*gap;
      const leftOffset = (pxW - rowWidth)/2;
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

  _getState(id) { return this._hass?.states?.[id]; }
  _readEntityValue(entityId) {
    if (!this._hass || !entityId) return { raw: null, text: "" };
    const st = this._getState(entityId); if (!st) return { raw: null, text: "" };
    const num = Number(st.state);
    if (!isNaN(num)) {
      const p = this._config.value_precision ?? 2;
      const unit = st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : "";
      return { raw: num, text: num.toFixed(p) + unit };
    }
    return { raw: st.state, text: String(st.state) };
  }
  _readNumber(entityId) {
    const st = this._getState(entityId);
    const num = Number(st?.state);
    return isNaN(num) ? NaN : num;
  }

	_updateLinkDirections() {
	  if (!this._links) return;
	  for (const l of this._links) {
		if (!l.flow_entity) { l._dir = 0; continue; } // <--- vorher 1; jetzt stoppen
		const v = this._readNumber(l.flow_entity);
		if (isNaN(v)) { l._dir = 0; continue; }       // unknown/unavailable => stoppen
		if (Math.abs(v) <= (l.zero_threshold ?? 0.0001)) l._dir = 0;
		else l._dir = v > 0 ? 1 : -1;
	  }
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
    if ((this._config.layout?.mode || "auto") === "auto") this._applyAutoLayout(rect.width, rect.height);
    else {
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
      const r = from.size/2, len = Math.hypot(dx,dy) || 1;
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

  // ---------- label side ----------
  _computeLabelSides() {
    const sum = new Map(this._nodes.map(n => [n.id, {dx:0, dy:0, c:0}]));
    for (const l of this._links) {
      const a = this._nodeMap.get(l.from), b = this._nodeMap.get(l.to);
      if (!a || !b) continue;
      const va = { dx: b._px.x - a._px.x, dy: b._px.y - a._px.y };
      const vb = { dx: a._px.x - b._px.x, dy: a._px.y - b._px.y };
      const sa = sum.get(a.id); sa.dx += va.dx; sa.dy += va.dy; sa.c++;
      const sb = sum.get(b.id); sb.dx += vb.dx; sb.dy += vb.dy; sb.c++;
    }
    for (const n of this._nodes) {
      const s = sum.get(n.id);
      n._labelSide = (!s || s.c===0) ? "top" : (s.dy < 0 ? "bottom" : "top");
    }
  }

  // ---------- draw background ----------
  _drawBg() {
    const ctx = this.bgCtx;
    const w = this.bg.width  / (window.devicePixelRatio || 1);
    const h = this.bg.height / (window.devicePixelRatio || 1);

    if (this._config.background && this._config.background !== "transparent") {
      ctx.fillStyle = this._config.background; ctx.fillRect(0,0,w,h);
    } else ctx.clearRect(0,0,w,h);

    for (const n of this._nodes) n._px = { x: n.x * w, y: n.y * h };

    for (const l of this._links) {
      const a = this._nodeMap.get(l.from), b = this._nodeMap.get(l.to);
      if (!a || !b) continue;
      const pA = this._edgePoint(a, b), pB = this._edgePoint(b, a);
      const mx = (pA.x + pB.x)/2, my = (pA.y + pB.y)/2;
      const dx = pB.x - pA.x, dy = pB.y - pA.y;
      const nx = -dy, ny = dx;
      const cx = mx + nx * (l.curve || 0), cy = my + ny * (l.curve || 0);

      ctx.save(); ctx.strokeStyle = l.color; ctx.lineWidth = l.width;
      ctx.beginPath(); ctx.moveTo(pA.x, pA.y);
      if (l.curve) ctx.quadraticCurveTo(cx, cy, pB.x, pB.y); else ctx.lineTo(pB.x, pB.y);
      ctx.stroke(); ctx.restore();

      l._pA = pA; l._pB = pB; l._c = { x: cx, y: cy }; l._curved = !!l.curve;
    }

    this._computeLabelSides();
    for (const n of this._nodes) this._drawNode(ctx, n);
  }

  _drawNode(ctx, n) {
    const p = n._px, r = n.size/2;

    // ring
    ctx.save(); ctx.shadowColor = n.ring; ctx.shadowBlur = 18; ctx.lineWidth = n.ringWidth; ctx.strokeStyle = n.ring;
    this._strokeShape(ctx, n.shape, p.x, p.y, r, n.size); ctx.restore();

    // fill
    ctx.save(); ctx.fillStyle = n.fill; this._fillShape(ctx, n.shape, p.x, p.y, r, n.size); ctx.restore();

    // label
    const above = (n._labelSide === "top");
    const labelY = above ? (p.y - r - 8) : (p.y + r + 8);
    const baseline = above ? "bottom" : "top";
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = baseline; ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `bold ${n.fontSize}px ${this._config.font_family}`;
    ctx.fillText(n.label, p.x, labelY); ctx.restore();

    // value (from node.entity) ALWAYS under icon
    const v = this._readEntityValue(n.entity);
    const k = Math.max(0.45, Number(this._config.value_below_icon_factor) || 0.65);
    const valueY = p.y + (n.icon ? n.icon_size * k : 0);
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = n.text_color;
    ctx.font = `bold ${Math.max(12, n.fontSize)}px ${this._config.font_family}`;
    ctx.fillText(v.text, p.x, valueY); ctx.restore();
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
      if (l._dir === 0) continue; // paused

      l._t = (l._t + (dtMs/1000) * (l.speed || 0.8)) % 1;
      const tPrime = l._dir === 1 ? l._t : (1 - l._t);

      const pos = l._curved
        ? this._quadPoint(l._pA, l._c, l._pB, tPrime)
        : { x: l._pA.x + (l._pB.x - l._pA.x)*tPrime, y: l._pA.y + (l._pB.y - l._pA.y)*tPrime };

      let alpha = 1;
      if (tPrime < fadeZone) alpha = tPrime / fadeZone;
      else if (tPrime > 1 - fadeZone) alpha = (1 - tPrime) / fadeZone;

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
      this._updateLinkDirections();
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
  name: "Flow Network Card (IDs + flow entity)",
  description: "Neon nodes, static lines + smooth dot; friendly node IDs; entity-driven direction.",
  preview: true
});

/* ===========
   SIMPLE EDITOR V6 (vanilla, tidy)
   =========== */
class FlowNetworkCardEditorV6 extends HTMLElement {
  constructor(){ super(); this.attachShadow({mode:"open"}); this._config={}; }
  set hass(h){ this._hass = h; }
  get value(){ return this._config; }
  setConfig(config){
    this._config = {
      type: "custom:flow-network-card",
      background: config?.background ?? "transparent",
      height: Number.isFinite(config?.height) ? config.height : 320,
      value_precision: Number.isFinite(config?.value_precision) ? config.value_precision : 2,
      node_text_color: config?.node_text_color ?? 'rgba(255,255,255,0.92)',
      value_below_icon_factor: config?.value_below_icon_factor ?? 0.65,
      layout: { mode: (config?.layout?.mode)||"auto", columns: config?.layout?.columns ?? 3, gap: config?.layout?.gap ?? 20, padding: config?.layout?.padding ?? 16 },
      dot: { size: config?.dot?.size ?? 5, glow: config?.dot?.glow ?? true, fade_zone: config?.dot?.fade_zone ?? 0.10 },
      nodes: Array.isArray(config?.nodes) ? config.nodes : [],
      links: Array.isArray(config?.links) ? config.links : []
    };
    this._render();
  }
  _emit(){ const e=new Event("config-changed",{bubbles:true,composed:true}); e.detail={config:this._config}; this.dispatchEvent(e); }

  _render(){
    const css = `
      :host{display:block;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--primary-text-color,#fff)}
      .wrap{display:grid;gap:16px;padding:10px}
      fieldset{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px}
      legend{opacity:.85;padding:0 8px}
      .row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .row2{grid-template-columns:repeat(2,minmax(0,1fr))}
      .list{display:flex;flex-direction:column;gap:12px}
      .item{border:1px dashed rgba(255,255,255,.15);border-radius:10px;padding:10px}
      label{display:flex;flex-direction:column;gap:6px}
      input,select{background:#1f2328;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:8px 10px}
      .btns{display:flex;gap:8px;margin-top:10px}
      button{background:#2d333b;color:#e6edf3;border:1px solid #30363d;padding:6px 10px;border-radius:8px;cursor:pointer}
      button:hover{filter:brightness(1.08)}
    `;
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="wrap">
        <fieldset>
          <legend>Allgemein</legend>
          <div class="row">
            <label>Hintergrund <input data-k="background" value="${this._config.background}"></label>
            <label>Höhe (px) <input type="number" data-k="height" value="${this._config.height}"></label>
            <label>Nachkommastellen <input type="number" min="0" max="4" step="1" data-k="value_precision" value="${this._config.value_precision}"></label>
          </div>
          <div class="row">
            <label>Layout
              <select data-k="layout.mode">
                <option value="auto" ${this._config.layout.mode==="auto"?"selected":""}>auto (zentriert)</option>
                <option value="manual" ${this._config.layout.mode!=="auto"?"selected":""}>manuell (x/y)</option>
              </select>
            </label>
            <label>Spalten <input type="number" min="1" max="8" step="1" data-k="layout.columns" value="${this._config.layout.columns}"></label>
            <label>Gap <input type="number" min="0" max="80" step="1" data-k="layout.gap" value="${this._config.layout.gap}"></label>
          </div>
          <div class="row">
            <label>Padding <input type="number" min="0" max="120" step="1" data-k="layout.padding" value="${this._config.layout.padding}"></label>
            <label>Punkt-Größe <input type="number" min="2" max="12" step="1" data-k="dot.size" value="${this._config.dot.size}"></label>
            <label>Fade-Zone (0–0.3) <input type="number" min="0" max="0.3" step="0.01" data-k="dot.fade_zone" value="${this._config.dot.fade_zone}"></label>
          </div>
          <div class="row2">
            <label>Textfarbe im Node <input data-k="node_text_color" value="${this._config.node_text_color}"></label>
            <label>Abstand Wert unter Icon (0.45–0.9) <input type="number" min="0.45" max="0.9" step="0.01" data-k="value_below_icon_factor" value="${this._config.value_below_icon_factor}"></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Nodes</legend>
          <div id="nodes" class="list"></div>
          <div class="btns"><button id="addNode">+ Node</button></div>
        </fieldset>

        <fieldset>
          <legend>Links</legend>
          <div id="links" class="list"></div>
          <div class="btns"><button id="addLink">+ Link</button></div>
        </fieldset>
      </div>
    `;

    // base inputs
    this.shadowRoot.querySelectorAll('[data-k]').forEach(el=>{
      el.addEventListener('input',()=>{
        const path = el.dataset.k.split('.'); let t=this._config;
        for(let i=0;i<path.length-1;i++) t=t[path[i]];
        t[path[path.length-1]] = (el.type==='number') ? Number(el.value) : el.value;
        this._emit();
      });
    });

    this._renderNodes();
    this._renderLinks();

    this.shadowRoot.getElementById('addNode').onclick = ()=>{
      this._config.nodes.push({
        id:"", label:"", entity:"", shape:"rounded", size:70,
        ring:"#23b0ff", fill:"#0f1a22",
        icon:"", icon_size:26, icon_color:"#ffffff"
      });
      this._renderNodes(); this._emit();
    };
    this.shadowRoot.getElementById('addLink').onclick = ()=>{
      this._config.links.push({ from:"", to:"", color:"#23b0ff", width:2, speed:0.8, curve:0, flow_entity:"", zero_threshold:0.0001 });
      this._renderLinks(); this._emit();
    };
  }

  _renderNodes(){
    const host=this.shadowRoot.getElementById('nodes'); host.innerHTML='';
    this._config.nodes.forEach((n,i)=>{
      const el=document.createElement('div'); el.className='item';
      el.innerHTML=`
        <div class="row">
          <label>Node-ID (frei) <input data-k="id" value="${n.id??''}" placeholder="pv, netz, batt, home"></label>
          <label>Label <input data-k="label" value="${n.label??''}" placeholder="Anzeigename"></label>
          <label>Sensor-Entity <input data-k="entity" value="${n.entity??''}" placeholder="sensor.xyz_power"></label>
        </div>
        <div class="row">
          <label>Ring-Farbe <input data-k="ring" value="${n.ring??'#23b0ff'}"></label>
          <label>Fill-Farbe <input data-k="fill" value="${n.fill??'#0f1a22'}"></label>
          <label>Icon-Farbe <input data-k="icon_color" value="${n.icon_color??'#ffffff'}"></label>
        </div>
        <div class="row">
          <label>Icon (mdi:...) <input data-k="icon" value="${n.icon??''}" placeholder="mdi:home-variant"></label>
          <label>Icon-Größe <input type="number" min="14" max="64" step="1" data-k="icon_size" value="${n.icon_size??26}"></label>
          <label>Size <input type="number" min="44" max="160" step="1" data-k="size" value="${n.size??70}"></label>
        </div>
        <details>
          <summary>Erweitert (manuelle Position, Text)</summary>
          <div class="row">
            <label>x (0..1) <input type="number" step="0.01" min="0" max="1" data-k="x" value="${n.x??''}"></label>
            <label>y (0..1) <input type="number" step="0.01" min="0" max="1" data-k="y" value="${n.y??''}"></label>
            <label>Font Size <input type="number" min="10" max="24" step="1" data-k="fontSize" value="${n.fontSize??13}"></label>
          </div>
        </details>
        <div class="btns"><button data-act="del">– Entfernen</button></div>
      `;
      el.querySelectorAll('[data-k]').forEach(inp=>{
        inp.addEventListener('input',()=>{
          const k=inp.dataset.k; let v = (inp.type==='number') ? Number(inp.value) : inp.value;
          if (['x','y'].includes(k)) v = (v===""?null:Math.max(0,Math.min(1,Number(v))));
          n[k]=v; this._emit();
        });
      });
      el.querySelector('[data-act="del"]').onclick=()=>{ this._config.nodes.splice(i,1); this._renderNodes(); this._emit(); };
      host.appendChild(el);
    });
  }

  _renderLinks(){
    const host=this.shadowRoot.getElementById('links'); host.innerHTML='';
    const ids=this._config.nodes.map(n=>n.id).filter(Boolean);
    this._config.links.forEach((l,i)=>{
      const el=document.createElement('div'); el.className='item';
      el.innerHTML=`
        <div class="row">
          <label>From (Node-ID)
            <select data-k="from">${['',...ids].map(id=>`<option value="${id}" ${l.from===id?'selected':''}>${id||'-'}</option>`).join('')}</select>
          </label>
          <label>To (Node-ID)
            <select data-k="to">${['',...ids].map(id=>`<option value="${id}" ${l.to===id?'selected':''}>${id||'-'}</option>`).join('')}</select>
          </label>
          <label>Farbe <input data-k="color" value="${l.color??'#23b0ff'}"></label>
        </div>
        <div class="row">
          <label>Breite <input type="number" min="1" max="6" step="1" data-k="width" value="${l.width??2}"></label>
          <label>Speed <input type="number" min="0.05" max="3" step="0.05" data-k="speed" value="${l.speed??0.8}"></label>
          <label>Kurve (-0.35..0.35) <input type="number" min="-0.35" max="0.35" step="0.01" data-k="curve" value="${l.curve??0}"></label>
        </div>
        <div class="row">
          <label>Flow-Entity (Richtung/Stop) <input data-k="flow_entity" value="${l.flow_entity??''}" placeholder="sensor.flow_kw"></label>
          <label>Zero-Threshold <input type="number" step="0.0001" data-k="zero_threshold" value="${l.zero_threshold??0.0001}"></label>
          <span></span>
        </div>
        <div class="btns"><button data-act="del">– Entfernen</button></div>
      `;
      el.querySelectorAll('[data-k]').forEach(inp=>{
        inp.addEventListener('input',()=>{
          const k=inp.dataset.k; let v=(inp.type==='number')?Number(inp.value):inp.value;
          l[k]=v; this._emit();
        });
      });
      el.querySelector('[data-act="del"]').onclick=()=>{ this._config.links.splice(i,1); this._renderLinks(); this._emit(); };
      host.appendChild(el);
    });
  }

  getCardSize(){ return 3; }
}
customElements.define("flow-network-card-editor-v6", FlowNetworkCardEditorV6);
