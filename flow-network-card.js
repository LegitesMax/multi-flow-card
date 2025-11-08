// flow-network-card.js
// Flow Network Card – responsive, auto-size, half-row support
// NEU:
// - Pro Node nur einfache Arithmetik: add / subtract (Zahl, Entity-ID oder Liste)
// - Globale Einheiten-Umrechnung (compute.unit_mode): keep | w_to_kw
// - flow_entity default = FROM-Node.entity (wenn nicht explizit gesetzt)

class FlowNetworkCard extends HTMLElement {
  static getConfigElement(){ return null; } // YAML-only
  static getStubConfig() {
    return {
      background: "#14171a",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      value_offset_px: 8,
      compute: { unit_mode: "keep", suffix: null, precision: null }, // NEW (global)
      layout: {
        mode: "auto",
        columns: 4,
        responsive: true,
        gap_x: 38,
        gap_y: 26,
        padding_x: 26,
        padding_y: 20,
        preferred_col_width: 180,
        auto_height: true
      },
      dot: { size: 5, glow: true, fade_zone: 0.10 },
      link_fan_out: { enabled: true, strength: 0.12 },
      nodes: [],
      links: []
    };
  }

  setConfig(config) {
    this._config = {
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      node_text_color: "rgba(255,255,255,0.92)",
      value_offset_px: 8,
      compute: { unit_mode: "keep", suffix: null, precision: null }, // NEW
      layout: {
        mode: "auto",
        columns: 4,
        responsive: true,
        gap_x: 28,
        gap_y: 22,
        padding_x: 22,
        padding_y: 18,
        preferred_col_width: 160,
        auto_height: true
      },
      dot: { size: 5, glow: true, fade_zone: 0.10 },
      missing_behavior: "stop",
      link_fan_out: { enabled: true, strength: 0.12 },
      ...config
    };

    if (!this.card) {
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      Object.assign(this.wrapper.style, { position: "relative", width: "100%", height: "360px" });

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

  set hass(hass) {
    this._hass = hass;
    if (this._nodes) this._needsBgRedraw = true;
    this._updateLinkDirections();
  }

  connectedCallback(){ this._animStart(); setTimeout(()=>this._resize(),150); }
  disconnectedCallback(){ this._animStop(); if (this._resizeObserver) this._resizeObserver.disconnect(); }
  getCardSize(){ return 3; }

  // ---------- data ----------
  _prepare() {
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
        // NEU: einfache Arithmetik
        add: n.add ?? null,         // Zahl | string(entity) | [ .. ]
        subtract: n.subtract ?? null,

        shape: (n.shape || "rounded").toLowerCase(),
        size: sizeSpecified ? Math.max(44, Number(n.size)) : null,
        ring: n.ring || "#23b0ff", fill: n.fill || "#121418",
        ringWidth: Math.max(2, Number(n.ringWidth || 3)),
        text_color: n.color || this._config.node_text_color,
        fontSize: fontSpecified ? Math.max(11, Number(n.fontSize)) : null,
        order: n.order ?? i,
        icon: n.icon || null,
        icon_size: iconSpecified ? Math.max(14, Number(n.icon_size)) : null,
        icon_color: n.icon_color || "#ffffff",
        row: (row !== undefined && row !== null) ? Number(row) : null,
        col: Number.isFinite(col) ? Math.max(1, Math.floor(col)) : null,
        _labelSide: "top",
        _auto: { size: !sizeSpecified, icon: !iconSpecified, font: !fontSpecified }
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
          factor: Math.min(2, Math.max(0, Number(l.factor ?? (Number.isFinite(l.speed) ? l.speed : 1)))),
          curve: (l.curve === undefined || l.curve === null) ? 0 : Number(l.curve),
          autoCurve: (l.curve === undefined || l.curve === null),
          flow_entity: (l.flow_entity !== undefined && l.flow_entity !== null) ? l.flow_entity : defaultFlow,
          zero_threshold: Number.isFinite(l.zero_threshold) ? Math.max(0, l.zero_threshold) : 0,
          _t: 0, _dir: 0
        };
      })
      .filter(l => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  // ---------- layout ----------
  _metrics(pxW, pxH) {
    const cfg = this._config.layout || {};
    const padX = Number.isFinite(cfg.padding_x) ? cfg.padding_x : 16;
    const padY = Number.isFinite(cfg.padding_y) ? cfg.padding_y : 16;
    const gapX = Number.isFinite(cfg.gap_x) ? cfg.gap_x : 20;
    const gapY = Number.isFinite(cfg.gap_y) ? cfg.gap_y : 20;
    const prefW = Math.max(80, Number(cfg.preferred_col_width || 0));
    const targetCols = Math.max(1, Math.floor(cfg.columns || 3));
    const anyPinned = this._nodes.some(n => n.row != null || n.col != null);

    const rowsAuto = Math.ceil(this._nodes.length / targetCols);
    const maxPinnedRow = this._nodes.reduce((m, n) => Math.max(m, n.row != null ? Math.ceil(Number(n.row)) : 0), 0);
    const baseRows = anyPinned ? Math.max(maxPinnedRow, rowsAuto) : rowsAuto;

    const availW = Math.max(1, pxW - padX*2);
    const responsive = !!cfg.responsive;

    let cols = targetCols;
    if (responsive) {
      while (cols > 1) {
        const gridWidthIfPref = cols * prefW + (cols - 1) * gapX;
        if (gridWidthIfPref <= availW) break;
        cols--;
      }
    }

    const cwFit = (availW - (cols - 1) * gapX) / cols;
    const cw = Math.max(60, Math.min(cwFit, prefW));
    const ch = cw;

    const gridW = cols*cw + (cols-1)*gapX;
    const leftOffset = (pxW - gridW) / 2;

    let rows = baseRows;
    if (!anyPinned) rows = Math.ceil(this._nodes.length / cols);

    const totalH = padY*2 + rows*ch + (rows-1)*gapY;
    const topOffset = padY;

    return { cols, rows, gapX, gapY, padX, padY, cw, ch, leftOffset, topOffset, totalH };
  }

  _applyAutoLayout(pxW, pxH) {
    const m = this._metrics(pxW, pxH);
    const cfg = this._config.layout || {};
    const cols = m.cols;

    const anyPinned = this._nodes.some(n => n.row != null || n.col != null);

    const placeNode = (n, rFloat, cInt) => {
      const cx = m.leftOffset + (cInt-1)*(m.cw+m.gapX) + m.cw/2;
      const cy = m.topOffset  + (rFloat-1)*(m.ch+m.gapY) + m.ch/2;
      n.x = this._clamp01(cx / pxW);
      n.y = this._clamp01(cy / pxH);
      this._autoScaleNode(n, m.cw);
    };

    if (!anyPinned) {
      const n = this._nodes.length;
      const rows = Math.ceil(n / cols);
      this._nodes.sort((a,b)=> (a.order ?? 0) - (b.order ?? 0)).forEach((node, idx) => {
        const r = Math.floor(idx / cols) + 1;
        const c = (idx % cols) + 1;
        placeNode(node, r, c);
      });
    } else {
      const rows = m.rows;
      const grid = Array.from({length: rows}, ()=> Array.from({length: cols}, ()=> null));
      const floatPinned = [];
      const free = [];
      const byOrder = [...this._nodes].sort((a,b)=>(a.order??0)-(b.order??0));

      for (const n of byOrder) {
        const hasRow = n.row != null;
        const hasCol = n.col != null;
        if (hasRow || hasCol) {
          const r = hasRow ? Number(n.row) : 1;
          const c = hasCol ? Math.max(1, Math.min(cols, Math.floor(n.col))) : 1;
          if (Number.isInteger(r)) {
            const ri = Math.max(1, Math.min(rows, r));
            if (!grid[ri-1][c-1]) grid[ri-1][c-1] = n; else free.push(n);
          } else {
            n._rowFloat = Math.max(1, Math.min(rows, r));
            n._colInt   = c;
            floatPinned.push(n);
          }
        } else {
          free.push(n);
        }
      }
      for (let r=1;r<=rows;r++) for (let c=1;c<=cols;c++) if (!grid[r-1][c-1] && free.length) grid[r-1][c-1] = free.shift();
      for (let r=1;r<=rows;r++) for (let c=1;c<=cols;c++) {
        const n = grid[r-1][c-1]; if (!n || n._rowFloat) continue; placeNode(n, r, c);
      }
      for (const n of floatPinned) placeNode(n, n._rowFloat, n._colInt);
    }

    if (cfg.auto_height) this.wrapper.style.height = Math.round(m.totalH) + "px";
  }

  _autoScaleNode(n, cellW) {
    const nodeSize = Math.round(Math.max(56, Math.min(120, (n._auto.size ? cellW * 0.70 : n.size))));
    n.size = nodeSize;
    if (n._auto.icon) n.icon_size = Math.max(16, Math.min(64, Math.round(nodeSize * 0.38)));
    if (n._auto.font) n.fontSize = Math.round(Math.max(12, Math.min(18, nodeSize * 0.18)));
  }

  // ---------- utils ----------
  _clamp01(v){ return Math.max(0, Math.min(1, Number(v))); }
  _getState(id) { return this._hass?.states?.[id]; }
  _getNumber(id) {
    const st = this._getState(id);
    const num = Number(st?.state);
    return isNaN(num) ? NaN : num;
    }

  // einfache Arithmetik: add/subtract
  _resolveTerm(t) {
    if (Array.isArray(t)) return t.map(x=>this._resolveTerm(x)).reduce((a,b)=>a+(Number.isFinite(b)?b:0),0);
    if (typeof t === "number") return t;
    if (typeof t === "string") {
      const maybeNum = Number(t);
      if (!isNaN(maybeNum)) return maybeNum;
      return this._getNumber(t); // Entity-ID
    }
    return 0;
  }

  _applyNodeMath(node, base) {
    let val = base;
    if (node.add !== null && node.add !== undefined) {
      const addv = this._resolveTerm(node.add);
      if (Number.isFinite(addv)) val += addv;
    }
    if (node.subtract !== null && node.subtract !== undefined) {
      const subv = this._resolveTerm(node.subtract);
      if (Number.isFinite(subv)) val -= subv;
    }
    return val;
  }

  _applyGlobalUnit(val, unitDefault) {
    const cmp = this._config.compute || {};
    const mode = (cmp.unit_mode || "keep").toLowerCase();
    const precOverride = Number.isFinite(cmp.precision) ? Number(cmp.precision) : null;
    let unit = unitDefault || "";
    let out = val;

    if (mode === "w_to_kw") {
      out = val * 0.001;
      unit = " kW";
    }
    if (typeof cmp.suffix === "string" && cmp.suffix.length) {
      unit = " " + cmp.suffix;
    }
    return { out, unit, precOverride };
  }

  _readEntityValue(node) {
    const entityId = node?.entity;
    if (!this._hass || !entityId) return { raw: null, text: "" };
    const st = this._getState(entityId); if (!st) return { raw: null, text: "" };

    const rawNum = Number(st.state);
    if (!isNaN(rawNum)) {
      const afterMath = this._applyNodeMath(node, rawNum);
      const unitDefault = st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : "";
      const g = this._applyGlobalUnit(afterMath, unitDefault);
      const precision = (g.precOverride != null) ? g.precOverride : (this._config.value_precision ?? 2);
      return { raw: afterMath, text: Number(afterMath).toFixed(precision) + g.unit };
    }
    // non-numeric
    return { raw: st.state, text: String(st.state) };
  }

  _readNumber(entityId) {
    const st = this._getState(entityId);
    const num = Number(st?.state);
    return isNaN(num) ? NaN : num;
  }

  _updateLinkDirections() {
    if (!this._links) return;
    const missing = (this._config.missing_behavior || "stop");
    for (const l of this._links) {
      if (l.flow_entity) {
        const v = this._readNumber(l.flow_entity);
        if (isNaN(v) || Math.abs(v) <= (l.zero_threshold ?? 0.0001)) { l._dir = 0; l._effectiveSpeed = 0; continue; }
        l._dir = v > 0 ? 1 : -1;
      } else if (missing === "stop") { l._dir = 0; l._effectiveSpeed = 0; } else {
        const fromNode = this._nodeMap.get(l.from);
        const v = fromNode?.entity ? this._readNumber(fromNode.entity) : NaN;
        l._dir = (!isNaN(v) && Math.abs(v) > (l.zero_threshold ?? 0.0001)) ? 1 : 0;
      l._effectiveSpeed = (l._dir !== 0) ? (Math.abs(v) * (Number.isFinite(l.factor) ? Math.min(2, Math.max(0, l.factor)) : 1)) : 0;}
    }
  }

  _resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    this._applyAutoLayout(rect.width, rect.height);

    const newRect = this.wrapper.getBoundingClientRect();
    for (const c of [this.bg, this.fg]) {
      c.width  = Math.max(1, Math.floor(newRect.width * dpr));
      c.height = Math.max(1, Math.floor(newRect.height * dpr));
      const ctx = (c === this.bg ? this.bgCtx : this.fgCtx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this._positionIcons();
    this._needsBgRedraw = true;
  }

  // ---------- geometry ----------
  _edgePoint(from, to) {
    const ax = from._px.x, ay = from._px.y;
    const bx = to._px.x, by = to._px.y;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;

    if (from.shape === "circle") {
      const r = from.size / 2;
      return { x: ax + ux * r, y: ay + uy * r };
    }
    const hw = from.size / 2, hh = from.size / 2;

    if (from.shape === "rounded") {
      const radius = Math.min(14, hw);
      const coreW = Math.max(0, hw - radius);
      const coreH = Math.max(0, hh - radius);
      const tx = ux === 0 ? Infinity : coreW / Math.abs(ux);
      const ty = uy === 0 ? Infinity : coreH / Math.abs(uy);
      const tCore = Math.min(tx, ty);
      const t = tCore + radius;
      return { x: ax + ux * t, y: ay + uy * t };
    }

    const sx = ux === 0 ? Infinity : hw / Math.abs(ux);
    const sy = uy === 0 ? Infinity : hh / Math.abs(uy);
    const t = Math.min(sx, sy);
    return { x: ax + ux * t, y: ay + uy * t };
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
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    return el;
  }
  _positionIcons() {
    const rect = this.wrapper.getBoundingClientRect();
    for (const n of this._nodes) {
      if (!n.icon) continue;
      const px = { x: n.x * rect.width, y: n.y * rect.height };
      const el = this._ensureIconEl(n.id, n.icon, n.icon_color || "#fff", n.icon_size || 24);
      el.style.left = `${px.x}px`;
      el.style.top  = `${px.y}px`;
    }
  }

  // ---------- labels ----------
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

  // ---------- draw bg ----------
  _drawBg() {
    const ctx = this.bgCtx;
    const w = this.bg.width  / (window.devicePixelRatio || 1);
    const h = this.bg.height / (window.devicePixelRatio || 1);

    if (this._config.background && this._config.background !== "transparent") {
      ctx.fillStyle = this._config.background; ctx.fillRect(0,0,w,h);
    } else ctx.clearRect(0,0,w,h);

    for (const n of this._nodes) n._px = { x: n.x * w, y: n.y * h };

    this._fanCache = null;

    for (const l of this._links) {
      const a = this._nodeMap.get(l.from), b = this._nodeMap.get(l.to);
      if (!a || !b) continue;

      const pA = this._edgePoint(a, b), pB = this._edgePoint(b, a);

      const mx = (pA.x + pB.x) / 2, my = (pA.y + pB.y) / 2;
      const dx = pB.x - pA.x,      dy = pB.y - pA.y;
      const nx = -dy, ny = dx;
      const len = Math.hypot(nx, ny) || 1;
      const nux = nx / len, nuy = ny / len;

      let curve = l.curve || 0;

      if (this._config.link_fan_out?.enabled && l.autoCurve) {
        if (!this._fanCache) this._fanCache = new Map();
        const keyBase = `${a.id}->${b.id}`;
        if (!this._fanCache.has(keyBase)) {
          const siblings = this._links.filter(x =>
            (x.from === l.from && x.to !== l.to) || (x.to === l.to && x.from !== l.from)
          );
          const group = [l, ...siblings].filter(x => (x.from === l.from) || (x.to === l.to))
            .sort((x,y)=>{
              const bx = (x.from === l.from) ? this._nodeMap.get(x.to) : this._nodeMap.get(x.from);
              const by = (y.from === l.from) ? this._nodeMap.get(y.to) : this._nodeMap.get(y.from);
              return (bx?bx._px.y:0) - (by?by._px.y:0);
            });
          const n = group.length;
          group.forEach((g, idx)=>{
            const rel = (idx - (n-1)/2);
            this._fanCache.set(`${a.id}->${(g.to||'')}:${(g.from||'')}`, rel);
          });
        }
        const rel = this._fanCache.get(`${a.id}->${(l.to||'')}:${(l.from||'')}`) ?? 0;
        const strength = Number(this._config.link_fan_out.strength ?? 0.10);
        curve = rel * strength;
      }

      const ctrlDist = Math.hypot(dx,dy);
      const cx = mx + nux * curve * ctrlDist;
      const cy = my + nuy * curve * ctrlDist;

      ctx.save();
      ctx.strokeStyle = l.color; ctx.lineWidth = l.width;
      ctx.beginPath(); ctx.moveTo(pA.x, pA.y);
      if (curve) ctx.quadraticCurveTo(cx, cy, pB.x, pB.y); else ctx.lineTo(pB.x, pB.y);
      ctx.stroke(); ctx.restore();

      l._pA = pA; l._pB = pB; l._c = { x: cx, y: cy }; l._curved = !!curve;
    }

    this._computeLabelSides();
    for (const n of this._nodes) this._drawNode(ctx, n);
  }

  _drawNode(ctx, n) {
    const p = n._px, r = n.size/2;

    // Ring
    ctx.save(); ctx.shadowColor = n.ring; ctx.shadowBlur = 18; ctx.lineWidth = n.ringWidth; ctx.strokeStyle = n.ring;
    this._strokeShape(ctx, n.shape, p.x, p.y, r, n.size); ctx.restore();

    // Fill
    ctx.save(); ctx.fillStyle = n.fill; this._fillShape(ctx, n.shape, p.x, p.y, r, n.size); ctx.restore();

    // Label (außen)
    const above = (n._labelSide === "top");
    const labelY = above ? (p.y - r - 8) : (p.y + r + 8);
    const baseline = above ? "bottom" : "top";
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = baseline; ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `bold ${n.fontSize || 14}px ${this._config.font_family}`;
    ctx.fillText(n.label, p.x, labelY); ctx.restore();

    // Wert (nach add/subtract + globale Umrechnung)
    const v = this._readEntityValue(n);
    const iconH = n.icon ? (n.icon_size || 24) : 0;
    const iconBottomY = p.y + iconH/2;
    const extra = Math.max(6, this._config.value_offset_px || 8, Math.round(n.size * 0.06));
    let valueY = iconBottomY + extra;
    const innerBottom = p.y + r - 6;
    if (valueY > innerBottom) valueY = innerBottom;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = n.text_color;
    const globalPrec = (this._config.compute?.precision != null) ? this._config.compute.precision : (this._config.value_precision ?? 2);
    ctx.font = `bold ${Math.max(12, n.fontSize || 14)}px ${this._config.font_family}`;
    // v.text ist bereits formatiert; wir nutzen es direkt:
    ctx.fillText(v.text, p.x, valueY);
    ctx.restore();

    // Icon wird separat positioniert
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
      if (l._dir === 0) continue;

      l._t = (l._t + (dtMs/1000) * (l._effectiveSpeed ?? 0)) % 1;
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
  name: "Flow Network Card (Simple Math + Global Unit)",
  description: "Neon nodes, responsive, +/- per node, global unit conversion, entity-driven flow.",
  preview: true
});
