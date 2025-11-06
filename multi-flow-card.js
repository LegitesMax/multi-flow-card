// multi-flow-card.js

import * as d3 from "https://cdn.skypack.dev/d3@7";

class MultiFlowCard extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 500px;
          position: relative;
          font-family: sans-serif;
        }
        svg {
          width: 100%;
          height: 100%;
        }
        .node circle {
          stroke: #999;
          stroke-width: 2px;
        }
        .node text {
          pointer-events: none;
          font-size: 20px;
          fill: white;
        }
        .tooltip {
          position: absolute;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          pointer-events: none;
          font-size: 12px;
          z-index: 10;
        }
      </style>
      <div id="tooltip" class="tooltip" style="display:none;"></div>
      <svg></svg>
    `;

    this.svg = d3.select(this.shadowRoot).select("svg");
    this.tooltip = this.shadowRoot.getElementById("tooltip");
    this.simulation = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config) this.renderGraph();
  }

  renderGraph() {
    const nodes = this.config.nodes.map((n) => {
      const entity = this._hass.states[n.entity || ""];
      const state = entity ? entity.state : null;
      return {
        id: n.id,
        label: n.label,
        icon: n.icon || "mdi:help-circle",
        entity_id: n.entity,
        state: state,
      };
    });

    const links = this.config.connections.map((c) => ({
      source: c.from,
      target: c.to,
      color: c.color || "#ccc",
    }));

    this.svg.selectAll("*").remove();

    const g = this.svg.append("g");

    this.simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(this.clientWidth / 2, this.clientHeight / 2));

    const link = g.selectAll(".link")
      .data(links)
      .enter().append("line")
      .attr("stroke", d => d.color)
      .attr("stroke-width", 2);

    const node = g.selectAll(".node")
      .data(nodes)
      .enter().append("g")
      .attr("class", "node")
      .call(d3.drag()
        .on("start", (event, d) => this.dragstarted(event, d))
        .on("drag", (event, d) => this.dragged(event, d))
        .on("end", (event, d) => this.dragended(event, d)))
      .on("click", (event, d) => this.showTooltip(event, d));

    node.append("circle")
      .attr("r", 24)
      .attr("fill", d => d.state === "on" ? "#4caf50" : "#607d8b");

    node.append("text")
      .attr("dy", 7)
      .attr("text-anchor", "middle")
      .text(d => this.getIconChar(d.icon));

    node.append("title")
      .text(d => d.label);

    this.simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("transform", d => `translate(${d.x},${d.y})`);
    });
  }

  getIconChar(icon) {
    const mdi = {
      'mdi:lightbulb': '\uf335',
      'mdi:motion-sensor': '\uf21c',
      'mdi:script': '\uf3b5',
      'mdi:help-circle': '\uf2d7'
    };
    return mdi[icon] || '?';
  }

  showTooltip(event, d) {
    const state = this._hass.states[d.entity_id];
    const content = `
      <strong>${d.label}</strong><br>
      Entity: ${d.entity_id}<br>
      State: ${state ? state.state : 'unknown'}
    `;
    this.tooltip.innerHTML = content;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${event.offsetX + 10}px`;
    this.tooltip.style.top = `${event.offsetY + 10}px`;

    clearTimeout(this._tooltipTimer);
    this._tooltipTimer = setTimeout(() => {
      this.tooltip.style.display = 'none';
    }, 3000);
  }

  dragstarted(event, d) {
    if (!event.active) this.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  dragended(event, d) {
    if (!event.active) this.simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  getCardSize() {
    return 5;
  }
}

customElements.define('multi-flow-card', MultiFlowCard);
