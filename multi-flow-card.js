
class MyFlowCard extends HTMLElement {
  setConfig(config) {
    if (!config.entities || !config.flows) {
      throw new Error("Must define entities and flows");
    }
    this.config = config;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; font-family: sans-serif; }
        svg { width: 100%; height: 300px; }
        .entity circle { stroke: #333; stroke-width: 2px; }
        .entity text { fill: white; font-size: 12px; text-anchor: middle; }
        .flow { stroke-width: 2px; fill: none; marker‑end: url(#arrow); }
        .flow .dot {
          fill: currentColor;
          animation: moveDot linear infinite;
        }
        @keyframes moveDot {
          from { offset-distance: 0%; }
          to   { offset-distance: 100%; }
        }
      </style>
      <svg></svg>
    `;
    this.svg = this.shadowRoot.querySelector("svg");
    this.render();
  }

  render() {
    const entityKeys = Object.keys(this.config.entities);
    const entities = entityKeys.map((key, idx) => {
      const ent = this.config.entities[key];
      // Positionierung: gleichmäßig horizontal
      const x = (idx + 1) * (100 / (entityKeys.length + 1));
      const y = 50;
      return { key, x, y, ...ent };
    });

    // Map key -> entity object for lookup
    const entityMap = {};
    entities.forEach(e => { entityMap[e.key] = e; });

    // Add arrow marker
    const svgNS = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(svgNS, "defs");
    const marker = document.createElementNS(svgNS, "marker");
    marker.setAttribute("id", "arrow");
    marker.setAttribute("viewBox", "0 -5 10 10");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "0");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M0,-5L10,0L0,5");
    path.setAttribute("fill", "#333");
    marker.appendChild(path);
    defs.appendChild(marker);
    this.svg.appendChild(defs);

    // Render entities
    entities.forEach(ent => {
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "entity");
      g.setAttribute("transform", `translate(${ent.x}%,${ent.y}%)`);
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("r", "20");
      circle.setAttribute("fill", ent.color || "#666");
      g.appendChild(circle);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("dy", "5");
      text.textContent = ent.icon;  // hier ggf Icon Map nutzen
      g.appendChild(text);
      this.svg.appendChild(g);
    });

    // Render flows
    this.config.flows.forEach(flow => {
      const source = entityMap[flow.from];
      const target = entityMap[flow.to];
      if (!source || !target) return;

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("class", "flow");
      line.setAttribute("stroke", flow.color || "#aaa");
      line.setAttribute("x1", `${source.x}%`);
      line.setAttribute("y1", `${source.y}%`);
      line.setAttribute("x2", `${target.x}%`);
      line.setAttribute("y2", `${target.y}%`);
      this.svg.appendChild(line);

      // Dot animation
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("class", "dot");
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", flow.color || "#aaa");
      // use offsetPath via CSS or SMIL
      dot.style.offsetPath = `path('M ${source.x}% ${source.y}% L ${target.x}% ${target.y}%')`;
      const speedMin = this.config.animation?.dot_speed_min || 2;
      const speedMax = this.config.animation?.dot_speed_max || 6;
      dot.style.animationDuration = `${speedMax}s`;
      this.svg.appendChild(dot);
    });
  }

  getCardSize() {
    return 5;
  }
}

customElements.define("custom‑flow‑card", MyFlowCard);
