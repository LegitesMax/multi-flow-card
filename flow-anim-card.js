// flow-network-card.js
// Network flow card for Home Assistant – NO root node.
// • Nodes: circle | square | rounded (rounded rectangle)
// • Style: colored ring, glow, label, value (W/kW), optional in/out values
// • Links: animated dashed Bezier (curved) with arrowhead and optional mid label
// • Each node is equal; flows exist only via links

class FlowNetworkCard extends HTMLElement {
  static getStubConfig() {
    return {
      height: 300,
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      nodes: [
        { id: "sensor.grid_power",    x: 0.12, y: 0.62, shape: "circle",  size: 54, label: "Netz",    ring: "#8a2be2", fill: "#1c1426" },
        { id: "sensor.home_power",    x: 0.55, y: 0.55, shape: "rounded", size: 60, label: "Zuhause", ring: "#23b0ff", fill: "#0f1a22" },
        { id: "sensor.pv_power",      x: 0.12, y: 0.20, shape: "circle",  size: 54, label: "PV-Anlage", ring: "#ffffff88", fill: "#2a2f36" },
        { id: "sensor.battery_power", x: 0.30, y: 0.86, shape: "circle",  size: 54, label: "Batterie", ring: "#ff6b6b", fill: "#2a1f22" },
        { id: "sensor.co2_saved",     x: 0.78, y: 0.18, shape: "circle",  size: 56, label: "CO₂",     ring: "#ffd166", fill: "#2b2b1f" }
      ],
      links: [
        { from: "sensor.grid_power", to: "sensor.home_power", color: "#8a2be2", width: 2, speed: 1.6, dash: [10,8], curve: 0.10, arrow: "end", label_entity: "sensor.grid_to_home" },
        { from: "sensor.pv_power",   to: "sensor.home_power", color: "#7cffcb", width: 2, speed: 1.2, dash: [8,8],  curve: -0.08, arrow: "end", label_entity: "sensor.pv_to_home" },
        { from: "sensor.battery_power", to: "sensor.home_power", color: "#ff6b6b", width: 2, speed: 1.0, dash: [6,8], curve: 0.18, arrow: "end", label_entity: "sensor.batt_to_home" },
        { from: "sensor.home_power", to: "sensor.co2_saved", color: "#ffd166", width: 2, speed: 0.8, dash: [2,10], curve: -0.12, arrow: "end", label_entity: "sensor.co2_rate" }
      ]
    };
  }

  setConfig(config) {
    this._config = {
      height: 280,
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2,
      node_text_color: "rgba(255,255,255,0.9)",
      muted_alpha: 0.28,                 // grau „ausgeblendet“ (z. B. bei 0-W Flow)
      hide_zero_link_labels: true,       // keine 0-W Labels auf Links
      in_out: {                          // optional: pro Knoten in/out Entities
        in_color: "#7cffcb",
        out_color: "#8a2be2",
        font_size: 11                    // px
      },
      ...config
    };

    if (!this.card) {
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      this.wrapper.style.position = "relative";
      this.wrapper.style.width = "100%";
      this.wrapper.style.height = (this._config.height || 280) + "px";

      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "block";
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";

      this.wrapper.appendChild(this.canvas);
      this.card.appendChild(this.wrapper);
      this.attachShadow({ mode: "open" }).appendChild(this.card);

      this.ctx = this.canvas.getContext("2d", { alpha: true });
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
    this._resize();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.nodes?.length) {
      this._nodeValues = this._config.nodes.map((n) => this._readEntity(n.id));
    }
    if (this._config?.links?.length) {
      this._linkLabels = this._config.links.map((l) => l.label_entity ? this._readEntity(l.label_entity) : null);
    }
    this._needsStaticRedraw = true;
  }

  getCardSize() { return Math.ceil((this._config.height || 280) / 50); }
  connectedCallback() { this._animStart(); }
  disconnectedCallback() { this._animStop(); if (this._resizeObserver) this._resizeObserver.disconnect(); }

  // ---------- data prep ----------
  _prepare() {
    // nodes
    this._nodeMap = new Map();
    for (const n of (this._config.nodes || [])) {
      this._nodeMap.set(n.id, {
        id: n.id,
        x: Math.max(0, Math.min(1, Number(n.x ?? 0.5))),
        y: Math.max(0, Math.min(1, Number(n.y ?? 0.5))),
        shape: (n.shape || "circle").toLowerCase(), // circle | square | rounded
        size: Math.max(36, Number(n.size || 54)),
        label: n.label || n.id,
        unit: n.unit || "",
        ring: n.ring || "#23b0ff",
        glow: n.glow ?? true,
        fill: n.fill || "#1b1f24",
        ringWidth: Math.max(2, Number(n.ringWidth || 3)),
        text_color: n.color || this._config.node_text_color,
        // optional in/out entities
        in_entity: n.in_entity || null,
        out_entity: n.out_entity || null,
        fontSize: Math.max(10, Number(n.fontSize || 12))
      });
    }
    // links
    this._links = (this._config.links || []).map(l => ({
      from: l.from, to: l.to,
      color: l.color || "rgba(255,255,255,0.8)",
      width: Math.max(1, Number(l.width || 2)),
      speed: Math.max(0.1, Number(l.speed || 1.0)),
      dash: Array.isArray(l.dash) ? l.dash : [8,8],
      curve: Math.max(-0.4, Math.min(0.4, Number(l.curve || 0))),
      arrow: l.arrow || "none",                    // none | end
      label_entity: l.label_entity || null
    })).filter(l => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  // ---------- utils ----------
  _readEntity(id) {
    if (!this._hass || !id) return { raw: null, text: "" };
    const st = this._hass.states?.[id];
    if (!st) return { raw: null, text: "" };
    const num = Number(st.state);
    if (!isNaN(num)) {
      const prec = this._config.value_precision ?? 2;
      const unit = st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : "";
      return { raw: num, text: num.toFixed(prec) + unit };
    }
    return { raw: st.state, text: String(st.state) };
  }

  _resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._needsStaticRedraw = true;
  }

  // ---------- animation ----------
  _animStart() {
    if (this._raf) return;
    const step = () => {
      this._raf = requestAnimationFrame(step);
      if (!this._visible) return;
      this._phase += 1.0; // dash phase
      if (this._needsStaticRedraw) { this._drawStatic(); this._needsStaticRedraw = false; }
      this._drawLinks();
    };
    this._raf = requestAnimationFrame(step);
  }
  _animStop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  // ---------- drawing ----------
  _clear() {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;
    if (this._config.background && this._config.background !== "transparent") {
      ctx.fillStyle = this._config.background;
      ctx.fillRect(0,0,w,h);
    } else {
      ctx.clearRect(0,0,w,h);
    }
    return { w, h };
  }

  _pos(node, w, h) { return { x: node.x * w, y: node.y * h }; }

  _drawStatic() {
    const { w, h } = this._clear();
    const ctx = this.ctx;

    // nodes
    for (const node of this._nodeMap.values()) {
      const p = this._pos(node, w, h);
      const r = node.size / 2;

      // glow (outer)
      if (node.glow) {
        ctx.save();
        ctx.shadowColor = node.ring;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = node.ring;
        ctx.lineWidth = node.ringWidth;
        this._strokeShape(ctx, node.shape, p.x, p.y, r, node.size);
        ctx.restore();
      }

      // ring
      ctx.save();
      ctx.strokeStyle = node.ring;
      ctx.lineWidth = node.ringWidth;
      this._strokeShape(ctx, node.shape, p.x, p.y, r, node.size);
      ctx.restore();

      // fill
      ctx.save();
      ctx.fillStyle = node.fill;
      this._fillShape(ctx, node.shape, p.x, p.y, r, node.size);
      ctx.restore();

      // label above
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `bold ${Math.max(11, node.fontSize)}px ${this._config.font_family}`;
      ctx.fillText(node.label, p.x, p.y - r - 8);
      ctx.restore();

      // value centered
      const v = this._hass ? this._readEntity(node.id) : { text: "" };
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = node.text_color;
      ctx.font = `bold ${Math.max(12, node.fontSize + 1)}px ${this._config.font_family}`;
      ctx.fillText(v.text, p.x, p.y);
      ctx.restore();

      // optional in/out values (small, unten/oben)
      if (node.in_entity || node.out_entity) {
        const io = this._config.in_out;
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = `${io.font_size}px ${this._config.font_family}`;
        if (node.in_entity) {
          const iv = this._readEntity(node.in_entity);
          ctx.fillStyle = io.in_color;
          ctx.textBaseline = "top";
          ctx.fillText(`↑ ${iv.text}`, p.x, p.y + r + 6);
        }
        if (node.out_entity) {
          const ov = this._readEntity(node.out_entity);
          ctx.fillStyle = io.out_color;
          ctx.textBaseline = "alphabetic";
          ctx.fillText(`↓ ${ov.text}`, p.x, p.y - r - 22);
        }
        ctx.restore();
      }
    }
  }

  _strokeShape(ctx, shape, cx, cy, r, size) {
    if (shape === "square") {
      ctx.strokeRect(cx - r, cy - r, size, size);
    } else if (shape === "rounded") {
      const rad = Math.min(14, r);
      this._roundRect(ctx, cx - r, cy - r, size, size, rad);
      ctx.stroke();
    } else { // circle
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  _fillShape(ctx, shape, cx, cy, r, size) {
    if (shape === "square") {
      ctx.fillRect(cx - r, cy - r, size, size);
    } else if (shape === "rounded") {
      const rad = Math.min(14, r);
      this._roundRect(ctx, cx - r, cy - r, size, size, rad);
      ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _drawLinks() {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;

    let idx = -1;
    for (const link of this._links) {
      idx++;

      const a = this._nodeMap.get(link.from);
      const b = this._nodeMap.get(link.to);
      if (!a || !b) continue;

      const pa = this._pos(a, w, h), pb = this._pos(b, w, h);

      // control point for Bezier (S-Kurve)
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const nx = -dy, ny = dx; // normal
      const k = link.curve * 0.5; // curve strength
      const cx = mx + nx * k, cy = my + ny * k;

      // label value (optional)
      let lbl = "";
      if (link.label_entity && this._hass) {
        const v = this._readEntity(link.label_entity);
        if (!(this._config.hide_zero_link_labels && Number(v.raw) === 0)) lbl = v.text;
      }

      // alpha auslastung (0 -> gedimmt)
      const alpha = (lbl === "" && this._config.hide_zero_link_labels) ? this._config.muted_alpha : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = link.color;
      ctx.lineWidth = link.width;
      ctx.setLineDash(link.dash);
      const dashTotal = link.dash.reduce((s, d) => s + d, 0) || 1;
      ctx.lineDashOffset = -((this._phase * link.speed) % dashTotal);

      // bezier path
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.quadraticCurveTo(cx, cy, pb.x, pb.y);
      ctx.stroke();

      // arrowhead
      if (link.arrow === "end") {
        // tangent near end
        const t = 0.98;
        const tx = (1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * cx + t * t * pb.x;
        const ty = (1 - t) * (1 - t) * pa.y + 2 * (1 - t) * t * cy + t * t * pb.y;
        const t2 = 1.0;
        const tx2 = (1 - t2) * (1 - t2) * pa.x + 2 * (1 - t2) * t2 * cx + t2 * t2 * pb.x;
        const ty2 = (1 - t2) * (1 - t2) * pa.y + 2 * (1 - t2) * t2 * cy + t2 * t2 * pb.y;
        const ang = Math.atan2(ty2 - ty, tx2 - tx);
        const size = Math.max(6, link.width * 3);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(pb.x, pb.y);
        ctx.lineTo(pb.x - Math.cos(ang - Math.PI/6) * size, pb.y - Math.sin(ang - Math.PI/6) * size);
        ctx.moveTo(pb.x, pb.y);
        ctx.lineTo(pb.x - Math.cos(ang + Math.PI/6) * size, pb.y - Math.sin(ang + Math.PI/6) * size);
        ctx.strokeStyle = link.color;
        ctx.stroke();
      }

      // mid label
      if (lbl) {
        ctx.setLineDash([]);
        ctx.font = `11px ${this._config.font_family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = link.color;
        // place a bit above curve midpoint
        const tt = 0.5;
        const lx = (1 - tt) * (1 - tt) * pa.x + 2 * (1 - tt) * tt * cx + tt * tt * pb.x;
        const ly = (1 - tt) * (1 - tt) * pa.y + 2 * (1 - tt) * tt * cy + tt * tt * pb.y;
        ctx.fillText(lbl, lx, ly - 10);
      }

      ctx.restore();
    }
  }
}

customElements.define("flow-network-card", FlowNetworkCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "flow-network-card",
  name: "Flow Network Card (No Root)",
  description: "Nodes with ring/glow and animated curved links. No root node."
});
