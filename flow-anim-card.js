// flow-network-card.js
// A minimal, high-perf network flow card for Home Assistant.
// - Nodes: circle/square with label + value (e.g., W/kW)
// - Edges: animated dashed lines (dash offset)
// - Config-driven layout (percent coords), HA entity binding
// - No external deps

class FlowNetworkCard extends HTMLElement {
  static getStubConfig() {
    return {
      height: 260,
      background: "transparent",
      nodes: [
        {
          id: "sensor.grid_power",
          x: 0.1,
          y: 0.5,
          shape: "circle",
          size: 34,
          label: "Grid",
          unit: "kW",
          color: "#1e90ff"
        },
        {
          id: "sensor.house_power",
          x: 0.5,
          y: 0.5,
          shape: "square",
          size: 38,
          label: "Haus",
          unit: "kW",
          color: "#ffffff",
          fill: "#2d2d2d"
        },
        {
          id: "sensor.pv_power",
          x: 0.9,
          y: 0.3,
          shape: "circle",
          size: 32,
          label: "PV",
          unit: "kW",
          color: "#ffd166"
        }
      ],
      links: [
        { from: "sensor.grid_power", to: "sensor.house_power", color: "#1e90ff", width: 2, speed: 1.8 },
        { from: "sensor.pv_power", to: "sensor.house_power", color: "#ffd166", width: 2, speed: 1.2 }
      ]
    };
  }

  setConfig(config) {
    this._config = {
      height: 240,
      background: "transparent",
      font_family: "Inter, Roboto, system-ui, sans-serif",
      value_precision: 2, // decimals for numeric states
      nodes: [],
      links: [],
      ...config
    };

    if (!this.card) {
      this.card = document.createElement("ha-card");
      this.card.style.position = "relative";
      this.card.style.overflow = "hidden";

      this.wrapper = document.createElement("div");
      this.wrapper.style.position = "relative";
      this.wrapper.style.width = "100%";
      this.wrapper.style.height = (this._config.height || 240) + "px";

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

      this._lastDash = 0;
      this._visible = true;
      this._animStart();
    }

    this.card.style.background = this._config.background || "transparent";
    if (this._config.height) this.wrapper.style.height = this._config.height + "px";

    this._normalizeConfig();
    this._resize(); // will also trigger a redraw
  }

  set hass(hass) {
    this._hass = hass;
    // cache latest state values for nodes
    if (this._config?.nodes?.length) {
      this._values = this._config.nodes.map((n) => this._readEntity(n.id));
    }
    // redraw text values without restarting anim
    this._needsStaticRedraw = true;
  }

  getCardSize() {
    return Math.ceil((this._config.height || 240) / 50);
  }

  connectedCallback() {
    this._animStart();
  }

  disconnectedCallback() {
    this._animStop();
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  // ---------- helpers ----------
  _normalizeConfig() {
    // Build node map for quick lookup
    this._nodeMap = new Map();
    for (const n of this._config.nodes) {
      const node = {
        id: n.id,
        x: this._clamp01(n.x ?? 0.5),
        y: this._clamp01(n.y ?? 0.5),
        shape: (n.shape || "circle").toLowerCase(), // circle|square
        size: Math.max(18, Number(n.size || 32)),
        label: n.label || n.id,
        unit: n.unit || "",
        color: n.color || "#ffffff",
        fill: n.fill || "rgba(0,0,0,0.35)",
        stroke: n.stroke || "rgba(255,255,255,0.25)",
        strokeWidth: n.strokeWidth ?? 1,
        fontSize: n.fontSize ?? 12,
      };
      this._nodeMap.set(node.id, node);
    }
    // Links
    this._links = (this._config.links || [])
      .map((l) => ({
        from: l.from,
        to: l.to,
        color: l.color || "rgba(255,255,255,0.8)",
        width: Math.max(1, Number(l.width || 2)),
        speed: Math.max(0.2, Number(l.speed || 1.0)), // dash offset speed
        dash: l.dash ?? [8, 8], // [on, off]
        arrow: l.arrow || "none", // "none" | "end"
      }))
      .filter((l) => this._nodeMap.has(l.from) && this._nodeMap.has(l.to));
  }

  _clamp01(v) {
    return Math.max(0, Math.min(1, Number(v)));
  }

  _readEntity(entityId) {
    if (!this._hass || !entityId) return { raw: null, text: "" };
    const st = this._hass.states?.[entityId];
    if (!st) return { raw: null, text: "" };
    const num = Number(st.state);
    if (!isNaN(num)) {
      const prec = this._config.value_precision ?? 2;
      return { raw: num, text: num.toFixed(prec) + (st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : "") };
    }
    return { raw: st.state, text: String(st.state) };
  }

  // ---------- drawing ----------
  _resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._needsStaticRedraw = true;
  }

  _animStart() {
    if (this._raf) return;
    const step = (ts) => {
      this._raf = requestAnimationFrame(step);
      if (!this._visible) return;

      // Advance dash phase
      const dt = 16; // assume ~60fps for simplicity; visually sufficient and cheap
      this._lastDash += dt;

      // Only redraw static layer (nodes/background) when needed
      if (this._needsStaticRedraw) {
        this._drawStatic();
        this._needsStaticRedraw = false;
      }
      // Always draw edges (animated)
      this._drawEdges();
    };
    this._raf = requestAnimationFrame(step);
  }

  _animStop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _clear(fullClear = true) {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    if (fullClear || (this._config.background && this._config.background !== "transparent")) {
      if (this._config.background && this._config.background !== "transparent") {
        this.ctx.fillStyle = this._config.background;
        this.ctx.fillRect(0, 0, w, h);
      } else {
        this.ctx.clearRect(0, 0, w, h);
      }
    }
    return { w, h };
  }

  _layoutPos(node, w, h) {
    return { x: node.x * w, y: node.y * h };
  }

  _drawStatic() {
    const { w, h } = this._clear(true);
    const ctx = this.ctx;
    ctx.font = `12px ${this._config.font_family}`;

    // Draw nodes (shapes + labels + values)
    for (let i = 0; i < this._config.nodes.length; i++) {
      const node = this._nodeMap.get(this._config.nodes[i].id);
      if (!node) continue;
      const p = this._layoutPos(node, w, h);

      // Shape
      ctx.save();
      ctx.lineWidth = node.strokeWidth;
      ctx.strokeStyle = node.stroke;
      ctx.fillStyle = node.fill;

      if (node.shape === "square") {
        const s = node.size;
        ctx.beginPath();
        ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
        ctx.fill();
        ctx.stroke();
      } else {
        const r = node.size / 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // Text (label + value)
      const val = this._hass ? this._readEntity(node.id) : { text: "" };
      const label = node.label ?? node.id;
      const unitFallback = node.unit ? ` ${node.unit}` : "";

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Label (top)
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `bold ${Math.max(11, node.fontSize)}px ${this._config.font_family}`;
      ctx.fillText(label, p.x, p.y - (node.size * 0.55));

      // Value (centered inside)
      ctx.fillStyle = node.color || "#ffffff";
      ctx.font = `bold ${Math.max(11, node.fontSize)}px ${this._config.font_family}`;
      const text = val.text || (this._values?.[i]?.text ?? "") || unitFallback.trim();
      ctx.fillText(text, p.x, p.y);
      ctx.restore();
    }
  }

  _drawEdges() {
    const { w, h } = { 
      w: this.canvas.width / (window.devicePixelRatio || 1),
      h: this.canvas.height / (window.devicePixelRatio || 1)
    };
    const ctx = this.ctx;

    // Clear only the edge layer by redrawing a transparent rect over the whole canvas
    // but keep nodes by redrawing nodes only when needed. To keep simple & fast,
    // we redraw edges on top with composite clear for lines only:
    // Instead, we fully redraw edges frame: cheap enough.
    // First re-draw the background portion only if transparent to avoid trails:
    if (this._config.background === "transparent") {
      // Repaint static nodes: skip to save cost — but we already painted nodes in _drawStatic.
      // So here, just clear a transparent rect then repaint static snapshot would be ideal.
      // For simplicity: clear & repaint static occasionally
      // We'll repaint static every ~20 frames
      if ((this._lastDash / 16) % 20 === 0) {
        this._needsStaticRedraw = true;
        this._drawStatic();
      }
    }

    // Draw all links (animated dashed)
    for (const link of this._links) {
      const a = this._nodeMap.get(link.from);
      const b = this._nodeMap.get(link.to);
      if (!a || !b) continue;
      const pa = this._layoutPos(a, w, h);
      const pb = this._layoutPos(b, w, h);

      ctx.save();
      ctx.lineWidth = link.width;
      ctx.strokeStyle = link.color;
      const dash = Array.isArray(link.dash) ? link.dash : [8, 8];
      ctx.setLineDash(dash);
      // Animate dash offset
      const totalDash = dash.reduce((s, v) => s + v, 0) || 1;
      ctx.lineDashOffset = -((this._lastDash * (link.speed || 1)) % totalDash);

      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();

      // Optional arrowhead at end
      if (link.arrow === "end") {
        const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const size = Math.max(6, link.width * 3);
        ctx.beginPath();
        ctx.setLineDash([]); // solid arrow
        ctx.moveTo(pb.x, pb.y);
        ctx.lineTo(pb.x - Math.cos(ang - Math.PI / 6) * size, pb.y - Math.sin(ang - Math.PI / 6) * size);
        ctx.moveTo(pb.x, pb.y);
        ctx.lineTo(pb.x - Math.cos(ang + Math.PI / 6) * size, pb.y - Math.sin(ang + Math.PI / 6) * size);
        ctx.stroke();
      }

      ctx.restore();
    }
  }
}

customElements.define("flow-network-card", FlowNetworkCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "flow-network-card",
  name: "Flow Network Card",
  description: "Nodes (circle/square) with animated connecting lines and HA entity values."
});
