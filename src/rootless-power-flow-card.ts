// src/rootless-power-flow-card.ts
// A Home Assistant Lovelace custom card that renders a ROOTLESS power-flow animation
// Inspired by power-flow-card, but allows arbitrary focus nodes (no fixed root).
// Build: Vite → single JS bundle in /dist. Ship to GitHub and load as Lovelace resource.

import { LitElement, html, css, svg, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/** -------------------- Types -------------------- */
export type PFNode = {
  id: string;
  label?: string;
  x: number;
  y: number;
  r?: number;
  color?: string;
  ringColor?: string;
};

export type PFLink = {
  id?: string;
  from: string;
  to: string;
  value: number;
  unit?: string;
  curvature?: number; // 0..1
  dash?: number;      // px
  speed?: number;     // px/s (negative reverses)
  thickness?: number; // px
  color?: string;
  arrow?: boolean;
};

export type RootlessPowerFlowConfig = {
  type: string; // 'custom:rootless-power-flow-card'
  title?: string;
  width?: number;   // canvas width (px)
  height?: number;  // canvas height (px)
  background?: string; // CSS color
  nodes: PFNode[];
  links: PFLink[];
  focus_ids?: string[]; // optional list of focused node ids
};

/** -------------------- Utils -------------------- */
function bezierPath(x1: number, y1: number, x2: number, y2: number, curvature = 0.16) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -dy; // normal
  const ny = dx;
  const len = Math.hypot(dx, dy) || 1;
  const nfx = (nx / len) * curvature * len;
  const nfy = (ny / len) * curvature * len;
  const cx = mx + nfx;
  const cy = my + nfy;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function linkKey(l: PFLink) {
  return l.id ?? `${l.from}→${l.to}`;
}

@customElement('rootless-power-flow-card')
export class RootlessPowerFlowCard extends LitElement {
  @property({ attribute: false }) hass: any;
  @state() private _config!: RootlessPowerFlowConfig;

  static getConfigElement() { return null; }
  static getStubConfig(): RootlessPowerFlowConfig {
    return {
      type: 'custom:rootless-power-flow-card',
      title: 'Rootless Power Flow',
      width: 800,
      height: 420,
      background: 'transparent',
      nodes: [
        { id: 'grid', x: 120, y: 90, label: 'Netz' },
        { id: 'solar', x: 680, y: 90, label: 'PV' },
        { id: 'house', x: 380, y: 210, label: 'Haus' },
        { id: 'car', x: 620, y: 300, label: 'EV' },
        { id: 'battery', x: 140, y: 300, label: 'Akku' },
      ],
      links: [
        { from: 'solar', to: 'house', value: 4.2, unit: ' kW', speed: 90, arrow: true },
        { from: 'grid', to: 'house', value: 1.1, unit: ' kW', speed: 60, color: '#5DA3F4' },
        { from: 'house', to: 'battery', value: 0.6, unit: ' kW', speed: 50, color: '#EAB308' },
        { from: 'battery', to: 'house', value: 0.3, unit: ' kW', speed: -40, color: '#F97316' },
        { from: 'house', to: 'car', value: 2.4, unit: ' kW', speed: 75 },
      ],
      focus_ids: ['house'],
    };
  }

  setConfig(config: RootlessPowerFlowConfig) {
    if (!config || !Array.isArray(config.nodes) || !Array.isArray(config.links)) {
      throw new Error('Config muss nodes[] und links[] enthalten.');
    }
    this._config = {
      width: 800,
      height: 420,
      background: 'transparent',
      ...config,
    };
  }

  static styles = css`
    :host { display: block; }
    .card { padding: 12px; }
    .title { font-weight: 600; margin-bottom: 8px; }
    svg { display: block; }

    /* flowing dash animation */
    @keyframes flow {
      from { stroke-dashoffset: 0; }
      to { stroke-dashoffset: var(--flow-offset, -24px); }
    }
  `;

  protected shouldUpdate(changed: PropertyValues) {
    return changed.has('_config') || changed.has('hass');
  }

  private _thickness(v: number) { return Math.max(1.5, Math.min(12, v)); }

  render() {
    if (!this._config) return html``;
    const { title, width, height, background, nodes, links, focus_ids } = this._config;
    const nodeMap = new Map(nodes.map(n => [n.id, n] as const));
    const focus = new Set(focus_ids ?? []);

    const shaped = links.map(l => {
      const a = nodeMap.get(l.from);
      const b = nodeMap.get(l.to);
      if (!a || !b) return null;
      const path = bezierPath(a.x, a.y, b.x, b.y, l.curvature ?? 0.16);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const thickness = l.thickness ?? this._thickness(l.value);
      const dash = l.dash ?? Math.max(8, Math.min(28, length / 12));
      const speed = l.speed ?? 60; // px/s
      const color = l.color ?? '#00B67A';
      const direction = speed >= 0 ? -dash : dash;
      const duration = Math.max(0.4, length / Math.abs(speed));
      return { ...l, path, length, thickness, dash, speed, color, direction, duration };
    }).filter(Boolean) as Array<any>;

    const markers = svg`
      <defs>
        <marker id="pf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
        <filter id="pf-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>`;

    return html`
      <ha-card class="card">
        ${title ? html`<div class="title">${title}</div>` : null}
        <svg width=${width} height=${height} style=${`background:${background}` } aria-label="Power flow network" role="img">
          ${markers}
          ${shaped.map((l) => {
            const dimmed = focus.size > 0 && !(focus.has(l.from) || focus.has(l.to));
            const dashArray = `${l.dash} ${l.dash}`;
            const id = `${linkKey(l)}-inv`;
            return svg`
              <g opacity=${dimmed ? 0.25 : 1}>
                <path d=${l.path} stroke="#0B1221" stroke-opacity="0.35" stroke-width=${l.thickness + 4} fill="none" />
                <path
                  d=${l.path}
                  stroke=${l.color}
                  stroke-width=${l.thickness}
                  stroke-dasharray=${dashArray}
                  style=${`color:${l.color}; --flow-offset:${l.direction}px; animation: flow ${l.duration}s linear infinite;`}
                  fill="none"
                  marker-end=${l.arrow === false ? undefined : 'url(#pf-arrow)'}
                />
                <text>
                  <textPath href=${`#${id}`} startOffset="50%" text-anchor="middle" fill="#C8D2E2" font-size="12">
                    ${`${l.value}${l.unit ?? ''}`}
                  </textPath>
                </text>
                <path id=${id} d=${l.path} fill="none" stroke="transparent" />
              </g>`;
          })}
          ${nodes.map((n) => {
            const r = n.r ?? 26;
            const dimmed = focus.size > 0 && !focus.has(n.id);
            return svg`<g transform=${`translate(${n.x}, ${n.y})`} opacity=${dimmed ? 0.35 : 1}>
              <circle r=${r + 4} fill="#0B1221" opacity="0.6"></circle>
              <circle r=${r} fill=${n.color ?? '#0E1A2B'} stroke=${n.ringColor ?? '#2A3A55'} stroke-width="2" filter="url(#pf-glow)"></circle>
              ${n.label ? svg`<text y=${r + 18} font-size="12" text-anchor="middle" fill="#C8D2E2">${n.label}</text>` : ''}
            </g>`;
          })}
        </svg>
      </ha-card>
    `;
  }

  // Lovelace plumbing
  getCardSize() { return 3; }
}
