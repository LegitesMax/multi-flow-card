// ------- VISUAL EDITOR v2 (vanilla HTML, no HA components) -------
class FlowNetworkCardEditorV2 extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    // normalize
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
      input, select, textarea { background:#1f2328; color:#e6edf3; border:1px solid #30363d; border-radius:8px; padding:8px 10px; }
      textarea { min-height:70px; resize:vertical; }
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
          <legend>Auto-Layout / Dot</legend>
          <div class="row row4">
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
          <div class="muted">Tipp: Bei <b>manual</b> Layout x/y (0..1) setzen. <b>Top/Bottom</b> Sensoren als Komma-Liste.</div>
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

    // wire root inputs
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

    // render nodes/links lists
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
        <div class="row row4">
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
        <div class="row row4">
          <label>Ring-Farbe<input type="text" data-k="ring" value="${n.ring ?? '#23b0ff'}"></label>
          <label>Fill-Farbe<input type="text" data-k="fill" value="${n.fill ?? '#0f1a22'}"></label>
          <label>Ring-Breite<input type="number" min="2" max="8" step="1" data-k="ringWidth" value="${n.ringWidth ?? 3}"></label>
          <label>Text-Farbe<input type="text" data-k="color" value="${n.color ?? ''}"></label>
        </div>
        <div class="row row4">
          <label>Icon (mdi:... )<input type="text" data-k="icon" value="${n.icon ?? ''}"></label>
          <label>Icon-Größe<input type="number" min="14" max="64" step="1" data-k="icon_size" value="${n.icon_size ?? 26}"></label>
          <label>Icon-Farbe<input type="text" data-k="icon_color" value="${n.icon_color ?? '#ffffff'}"></label>
          <label>Order<input type="number" step="1" data-k="order" value="${n.order ?? i}"></label>
        </div>
        <div class="row row3">
          <label>x (0..1)<input type="number" step="0.01" min="0" max="1" data-k="x" value="${n.x ?? ''}"></label>
          <label>y (0..1)<input type="number" step="0.01" min="0" max="1" data-k="y" value="${n.y ?? ''}"></label>
          <label>Font Size<input type="number" step="1" min="10" max="24" data-k="fontSize" value="${n.fontSize ?? 13}"></label>
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
      // wire
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
        <div class="row row4">
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

// Tell the card to use this editor
if (customElements.get("flow-network-card")) {
  const Cls = customElements.get("flow-network-card");
  Cls.getConfigElement = () => document.createElement("flow-network-card-editor-v2");
}
