// multi-flow-card.js – Version mit animierter Flow-Richtung, ohne Drag & Drop

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
        .link {
          fill: none;
          stroke-width: 2px;
          marker-end: url(#arrow);
        }
        .flow {
          stroke-dasharray: 4,2;
          animation: flow 1s linear infinite;
        }
        @keyframes flow {
          to {
            stroke-dashoffset: -6;
          }
        }
      </style>
      <svg></svg>
    `;

    this.svg = d3.select(this.shadowRoot).select("svg");
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config) this.renderGraph();
  }

  renderGraph() {
    const nodes = this.config.nodes.map((n, index) => {
      const entity = this._hass.states[n.entity || ""];
      const state = entity ? entity.state : null;
      return {
        id: n.id,
        label: n.label,
        icon: n.icon || "mdi:help-circle",
        entity_id: n.entity,
        state: state,
        x: n.x,
        y: n.y,
      };
    });

    const links = this.config.connections.map((c) => ({
      source: c.from,
      target: c.to,
      color: c.color || "#ccc",
      flow: c.flow !== false
    }));

    this.svg.selectAll("*").remove();

    // Arrow marker
    this.svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#999");

    const g = this.svg.append("g");

    const nodeMap = {};
    nodes.forEach(n => nodeMap[n.id] = n);

    const link = g.selectAll(".link")
      .data(links)
      .enter().append("line")
      .attr("class", d => d.flow ? "link flow" : "link")
      .attr("stroke", d => d.color)
      .attr("x1", d => nodeMap[d.source].x)
      .attr("y1", d => nodeMap[d.source].y)
      .attr("x2", d => nodeMap[d.target].x)
      .attr("y2", d => nodeMap[d.target].y);

    const node = g.selectAll(".node")
      .data(nodes)
      .enter().append("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.x},${d.y})`);

    node.append("circle")
      .attr("r", 24)
      .attr("fill", d => d.state === "on" ? "#4caf50" : "#607d8b");

    node.append("text")
      .attr("dy", 7)
      .attr("text-anchor", "middle")
      .text(d => this.getIconChar(d.icon));
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

  getCardSize() {
    return 5;
  }
}

customElements.define('multi-flow-card', MultiFlowCard);