class MultiFlowCard extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this.attachShadow({ mode: 'open' });

    const style = `
      <style>
        :host {
          display: block;
          position: relative;
          font-family: sans-serif;
        }
        .node {
          position: absolute;
          padding: 8px 12px;
          background: #2c3e50;
          color: white;
          border-radius: 8px;
          text-align: center;
          min-width: 100px;
        }
        svg {
          position: absolute;
          width: 100%;
          height: 100%;
          z-index: 0;
        }
        .node-content {
          z-index: 1;
        }
      </style>
    `;

    const container = document.createElement('div');
    container.innerHTML = style + `<div class="node-content"></div><svg></svg>`;
    this.shadowRoot.appendChild(container);

    this.render();
  }

  render() {
    const content = this.shadowRoot.querySelector('.node-content');
    const svg = this.shadowRoot.querySelector('svg');
    content.innerHTML = '';
    svg.innerHTML = '';

    const nodes = {};
    const nodeElements = {};

    // Render nodes
    this.config.nodes.forEach((n) => {
      const el = document.createElement('div');
      el.classList.add('node');
      el.innerText = n.label || n.id;
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      content.appendChild(el);
      nodes[n.id] = n;
      nodeElements[n.id] = el;
    });

    // Render connections
    this.config.connections.forEach((conn) => {
      const from = nodeElements[conn.from];
      const to = nodeElements[conn.to];
      if (!from || !to) return;

      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();

      const x1 = from.offsetLeft + from.offsetWidth / 2;
      const y1 = from.offsetTop + from.offsetHeight / 2;
      const x2 = to.offsetLeft + to.offsetWidth / 2;
      const y2 = to.offsetTop + to.offsetHeight / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", 'line');
      path.setAttribute('x1', x1);
      path.setAttribute('y1', y1);
      path.setAttribute('x2', x2);
      path.setAttribute('y2', y2);
      path.setAttribute('stroke', conn.color || 'white');
      path.setAttribute('stroke-width', '2');
      svg.appendChild(path);
    });
  }

  set hass(hass) {
    this._hass = hass;
    // optional: you could use hass.state here to update node styles
  }

  getCardSize() {
    return 4;
  }
}

customElements.define('multi-flow-card', MultiFlowCard);
