// flow-network-card.js (repaired minimal version)
// Features: nodes with grid, links with optional curve, animated dots with global flow_speed (by entity),
// flow_entity default = FROM node entity, zero_threshold, responsive size.

class FlowNetworkCard extends HTMLElement {
  static getConfigElement(){ return null; } // YAML-only
  static getStubConfig(){
    return {
      background: "#14171a",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      value_offset_px: 8,
      compute: { unit_mode: "keep", suffix: null, precision: null },
      layout: {
        mode: "auto",
        columns: 4,
        responsive: true,
        gap_x: 28, gap_y: 22,
        padding_x: 22, padding_y: 18,
        preferred_col_width: 160,
        auto_height: true
      },
      dot: { size: 5, glow: true, fade_zone: 0.10 },
      link_fan_out: { enabled: true, strength: 0.12 },
      flow_speed: { mode: "by_entity", value_min: 0, value_max: 3000, speed_min: 0.05, speed_max: 2.5, multiplier: 1 },
      nodes: [], links: []
    };
  }

  setConfig(config){
    this._config = {
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      node_text_color: "rgba(255,255,255,0.92)",
      value_offset_px: 8,
      compute: { unit_mode: "keep", suffix: null, precision: null },
      layout: {
        mode: "auto",
        columns: 4,
        responsive: true,
        gap_x: 28, gap_y: 22,
        padding_x: 22, padding_y: 18,
        preferred_col_width: 160,
        auto_height: true
      },
      dot: { size: 5, glow: true, fade_zone: 0.10 },
      link_fan_out: { enabled: true, strength: 0.12 },
      flow_speed: { mode: "by_entity", value_min: 0, value_max: 3000, speed_min: 0.05, speed_max: 2.5, multiplier: 1 },
      nodes: [], links: [],
      missing_behavior: "stop",
      ...config
    };

    if (!this.card){
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      Object.assign(this.wrapper.style, { position: "relative", width: "100%", height: "360px" });

      this.bg = document.createElement("canvas");
      this.fg = document.createElement("canvas");
      for (const c of [this.bg, this.fg]) Object.assign(c.style, { width: "100%", height: "100%", position: "absolute", inset: "0" });

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
      this._iconEls = new Map();
      this._animStart();
    }

    this.card.style.background = this._config.background || "transparent";

    this._prepare();
    this._resize();
    this._updateLinkDirections();

    // First-render fix
    if (!this._initializedFix) {
      this._initializedFix = true;
      setTimeout(() => {
        const rect = this.wrapper?.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.height > 0) this._resize();
        else {
          const waitForVisible = () => {
            const r = this.wrapper?.getBoundingClientRect?.();
            if (r && r.width > 0 && r.height > 0) this._resize();
            else requestAnimationFrame(waitForVisible);
          };
          requestAnimationFrame(waitForVisible);
        }
      }, 50);
    }
  }

  set hass(hass){
    this._hass = hass;
    if (this._nodes) this._needsBgRedraw = true;
    this._updateLinkDirections();
  }

  connectedCallback(){ this._animStart(); setTimeout(()=>this._resize(),150); }
  disconnectedCallback(){ this._animStop(); if (this._resizeObserver) this._resizeObserver.disconnect(); }
  getCardSize(){ return 3; }

  // ---------- data ----------
  _prepare(){
    this._nodes = (this._config.nodes || []).map((n, i) => {
      let row = n.row, col = n.col;
      if ((row === undefined || col === undefined) && typeof n.grid === "string") {
        const m = n.grid.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+)$/);
        if (m) { row = Number(m[1]); col = Number(m[2]); }
      }
      const sizeSpecified = Number.isFinite(n.size);
      const iconSpecified = Number.isFinite(n.icon_size);
      const fontSpecified = Number.isFinite(n.fontSize);

      return {
        id: String(n.id || `n${i}`),
        label: n.label || n.id,
        entity: n.entity || "",
        shape: (n.shape || "rounded").toLowerCase(),
        size: sizeSpecified ? Math.max(44, Number(n.size)) : null,
        ring: n.ring || "#23b0ff", fill: n.fill || "#121418",
        ringWidth: Math.max(2, Number(n.ringWidth || 3)),
        text_color: n.color || this._config.node_text_color,
        fontSize: fontSpecified ? Math.max(11, Number(n.fontSize)) : null,
        icon: n.icon || null,
        icon_size: iconSpecified ? Math.max(14, Number(n.icon_size)) : null,
        icon_color: n.icon_color || "#ffffff",
        row: (row !== undefined && row !== null) ? Number(row) : null,
        col: Number.isFinite(col) ? Math.max(1, Math.floor(col)) : null
      };
    });

    this._nodeMap = new Map(this._nodes.map(n => [n.id, n]));

    // Links: flow_entity default = FROM-Node.entity
    this._links = (this._config.links || [])
      .map(l => {
        const fromId = String(l.from || "");
        const toId   = String(l.to || "");
        const fromNode = this._nodeMap.get(fromId);
        const defaultFlow = fromNode?.entity || null;
        return {
          from: fromId,
          to: toId,
          color: l.color || "rgba(255,255,255,0.85)",
          width: Math.max(1, Number(l.width ?? 2)),
          speed: Math.max(0.05, Number(l.speed ?? 1)),
          curve: (l.curve === undefined || l.curve === null) ? 0 : Number(l.curve),
          autoCurve: (l.curve === undefined || l.curve === null),
          flow_entity: (l.flow_entity !== undefined && l.flow_entity !== null) ? l.flow_entity : defaultFlow,
          zero_threshold: Number.isFinite(l.zero_threshold) ? Math.max(0, l.zero_threshold) : 0,
          _t: 0, _dir: 0, _speed: 0
        };
      })
      .filter(l => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  // ---------- layout ----------
  _metrics(pxW, pxH){
    const cfg = this._config.layout || {};
    const padX = Number.isFinite(cfg.padding_x) ? cfg.padding_x : 16;
    const padY = Number.isFinite(cfg.padding_y) ? cfg.padding_y : 16;
    const gapX = Number.isFinite(cfg.gap_x) ? cfg.gap_x : 20;
    const gapY = Number.isFinite(cfg.gap_y) ? cfg.gap_y : 20;
    const cols = Math.max(1, Number.isFinite(cfg.columns) ? Math.floor(cfg.columns) : 4);
    const preferredColW = Math.max(120, Number(cfg.preferred_col_width || 160));

    const innerW = Math.max(100, pxW - padX*2);
    const cw = (innerW - (cols-1)*gapX) / cols;
    const ch = Number.isFinite(cfg.preferred_row_height) ? cfg.preferred_row_height : cw * 0.6;

    const rows = Math.max(1, Math.ceil(Math.max(...this._nodes.map(n => n.row || 1))));
    const leftOffset = padX;
    const topOffset  = padY;
    return { cols, rows, gapX, gapY, padX, padY, cw, ch, leftOffset, topOffset };
  }

  _applyAutoLayout(pxW, pxH){
    const m = this._metrics(pxW, pxH);
    const placeNode = (n, rFloat, cInt) => {
      const cx = m.leftOffset + (cInt-1)*(m.cw+m.gapX) + m.cw/2;
      const cy = m.topOffset  + (rFloat-1)*(m.ch+m.gapY) + m.ch/2;
      n.x = cx; n.y = cy; n._cx = cx; n._cy = cy;
      n._w = m.cw; n._h = m.ch;
    };

    // place nodes
    for (const n of this._nodes) {
      const rFloat = Number(n.row || 1);
      const cInt   = Number(n.col || 1);
      placeNode(n, rFloat, cInt);
    }

    // compute link geometry (straight or quadratic)
    for (const l of this._links){
      const a = this._nodeMap.get(l.from);
      const b = this._nodeMap.get(l.to);
      l._pA = { x: a._cx, y: a._cy };
      l._pB = { x: b._cx, y: b._cy };
      l._curved = Math.abs(l.curve || 0) > 0.0001;
      if (l._curved){
        const mx = (l._pA.x + l._pB.x)/2;
        const my = (l._pA.y + l._pB.y)/2;
        const nx = l._pB.y - l._pA.y;
        const ny = -(l._pB.x - l._pA.x);
        const k = Number(l.curve || 0);
        const len = Math.hypot(l._pB.x - l._pA.x, l._pB.y - l._pA.y) || 1;
        const s = (len * 0.25) * k;
        l._c = { x: mx + nx/Math.hypot(nx,ny)*s, y: my + ny/Math.hypot(nx,ny)*s };
      } else {
        l._c = null;
      }
    }

    // canvas size
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const totalW = pxW, totalH = pxH;
    for (const c of [this.bg, this.fg]) { c.width = Math.floor(totalW*dpr); c.height = Math.floor(totalH*dpr); c.style.width="100%"; c.style.height="100%"; c.getContext("2d").setTransform(dpr,0,0,dpr,0,0);}
  }

  _resize(){
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this._applyAutoLayout(rect.width, rect.height);
    const w = this.bg.width / dpr, h = this.bg.height / dpr;
    const bg = this.bgCtx;
    bg.clearRect(0,0,w,h);
    // draw links as lines
    for (const l of this._links){
      bg.save();
      bg.strokeStyle = l.color;
      bg.lineWidth = Math.max(1, l.width || 2);
      bg.beginPath();
      if (l._curved && l._c){
        bg.moveTo(l._pA.x, l._pA.y);
        bg.quadraticCurveTo(l._c.x, l._c.y, l._pB.x, l._pB.y);
      } else {
        bg.moveTo(l._pA.x, l._pA.y);
        bg.lineTo(l._pB.x, l._pB.y);
      }
      bg.stroke();
      bg.restore();
    }
    this._needsBgRedraw = false;
  }

  // ---------- utils ----------
  _getState(entityId){
    try { return this._hass?.states?.[entityId]; } catch(e){ return undefined; }
  }
  _readNumber(entityId){
    const st = this._getState(entityId);
    const num = Number(st?.state);
    return isNaN(num) ? NaN : num;
  }
  _map(val, inMin, inMax, outMin, outMax, clamp=true){
    if (inMax === inMin) return outMin;
    let t = (val - inMin) / (inMax - inMin);
    if (clamp) t = Math.max(0, Math.min(1, t));
    return outMin + t * (outMax - outMin);
  }

  _updateLinkDirections(){
    if (!this._links) return;
    const missing = (this._config.missing_behavior || "stop");
    const fs = this._config.flow_speed || { mode: "by_entity", value_min: 0, value_max: 3000, speed_min: 0.05, speed_max: 2.5, multiplier: 1 };
    for (const l of this._links){
      // direction
      let v = NaN;
      if (l.flow_entity){
        v = this._readNumber(l.flow_entity);
        if (isNaN(v) || Math.abs(v) <= (l.zero_threshold ?? 0)) { l._dir = 0; l._speed = 0; continue; }
        l._dir = v > 0 ? 1 : -1;
      } else if (missing === "stop"){
        l._dir = 0; l._speed = 0; continue;
      } else {
        const fromNode = this._nodeMap.get(l.from);
        const fv = fromNode?.entity ? this._readNumber(fromNode.entity) : NaN;
        if (isNaN(fv) || Math.abs(fv) <= (l.zero_threshold ?? 0)) { l._dir = 0; l._speed = 0; continue; }
        l._dir = 1; v = fv;
      }

      // global dynamic speed
      let spd = Number(l.speed ?? 1);
      if ((fs.mode || "by_entity") === "by_entity"){
        const absW = Math.abs(v);
        const vmin = Number.isFinite(fs.value_min) ? fs.value_min : 0;
        const vmax = Number.isFinite(fs.value_max) ? fs.value_max : 3000;
        const smin = Number.isFinite(fs.speed_min) ? fs.speed_min : 0.05;
        const smax = Number.isFinite(fs.speed_max) ? fs.speed_max : 2.5;
        spd = this._map(absW, vmin, vmax, smin, smax, true);
      }
      const mult = Number.isFinite(fs.multiplier) ? fs.multiplier : 1;
      l._speed = Math.max(0.01, spd * mult);
    }
  }

  // ---------- foreground ----------
  _drawDots(dtMs){
    const ctx = this.fgCtx;
    const w = this.fg.width / (window.devicePixelRatio || 1);
    const h = this.fg.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0,0,w,h);

    const fadeZone = Math.max(0.02, this._config.dot?.fade_zone || 0.10);

    for (const l of this._links){
      if (!l._pA || !l._pB) continue;
      if (l._dir === 0) continue;

      l._t = (l._t + (dtMs/1000) * (l._speed ?? l.speed ?? 1)) % 1;
      const tPrime = l._dir === 1 ? l._t : (1 - l._t);

      const pos = l._curved && l._c
        ? this._quadPoint(l._pA, l._c, l._pB, tPrime)
        : { x: l._pA.x + (l._pB.x - l._pA.x)*tPrime, y: l._pA.y + (l._pB.y - l._pA.y)*tPrime };

      let alpha = 1;
      if (tPrime < fadeZone) alpha = tPrime / fadeZone;
      else if (tPrime > 1 - fadeZone) alpha = (1 - tPrime) / fadeZone;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      if (this._config.dot?.glow) { ctx.shadowColor = l.color; ctx.shadowBlur = 8; }
      ctx.fillStyle = l.color;
      const r = Math.max(2, this._config.dot?.size || 5);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  _quadPoint(a, c, b, t){ const u = 1 - t; return { x: u*u*a.x + 2*u*t*c.x + t*t*b.x, y: u*u*a.y + 2*u*t*c.y + t*t*b.y }; }

  // ---------- loop ----------
  _animStart(){
    if (this._raf) return;
    const step = (ts) => {
      this._raf = requestAnimationFrame(step);
      if (!this._visible) { this._lastTs = ts; return; }
      const dt = Math.min(80, Math.max(0, ts - (this._lastTs || ts)));
      this._lastTs = ts;
      if (this._needsBgRedraw) this._resize();
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
  name: "Flow Network Card (Global Flow Speed)",
  description: "Animated flow with global entity-based speed mapping."
});
