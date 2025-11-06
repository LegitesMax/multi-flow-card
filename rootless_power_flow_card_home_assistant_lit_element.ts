// File: src/rootless-power-flow-card.ts
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

// File: package.json
// Use Vite to bundle to ESM module for Lovelace
export const pkg = `{
  "name": "rootless-power-flow-card",
  "version": "0.1.0",
  "description": "Rootless power-flow animation card for Home Assistant (Lovelace)",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build && node scripts/postbuild.js",
    "preview": "vite preview"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "lit": "^3.1.0",
    "rollup-plugin-filesize": "^10.0.0"
  }
}`;

// File: tsconfig.json
export const tsconfig = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "jsx": "preserve",
    "useDefineForClassFields": false,
    "outDir": "dist",
    "types": []
  },
  "include": ["src/**/*.ts"]
}`;

// File: vite.config.ts
export const vite = `import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'dist',
    lib: {
      entry: 'src/rootless-power-flow-card.ts',
      formats: ['es'],
      fileName: () => 'rootless-power-flow-card.js',
    },
    rollupOptions: {
      external: [/^home-assistant-frontend\//],
    },
  },
});`;

// File: scripts/postbuild.js (optional: inject version hash)
export const postbuild = `import { readFileSync, writeFileSync } from 'node:fs';
const f = 'dist/rootless-power-flow-card.js';
let code = readFileSync(f, 'utf8');
code = code.replace(/from \"lit\"/g, 'from \"https://unpkg.com/lit@3.1.0/index.js?module\"');
writeFileSync(f, code);
console.log('Rewrote lit import for direct usage without bundler in HA.');`;

// File: README.md (excerpt)
export const readme = `# Rootless Power Flow Card

A Lovelace custom card for Home Assistant to animate energy/power flows with no fixed root. Pick *any* nodes as focus.

## Install
### HACS (custom repo)
1. In HACS → Settings → **Custom repositories**, add your repo URL and type **Lovelace**.
2. Install **Rootless Power Flow Card**, then **Add to dashboard**. If needed, add as a resource:
   - url: /hacsfiles/rootless-power-flow-card/rootless-power-flow-card.js
   - type: module

### Manual
1. Download ` + "`rootless-power-flow-card.js`" + ` from the latest release and copy to `/config/www/`.
2. Add Lovelace resource:
   - url: /local/rootless-power-flow-card.js
   - type: module

## Example
```yaml
type: custom:rootless-power-flow-card
title: Energiefluss
width: 800
height: 420
background: 'rgba(2,6,23,0.75)'
nodes:
  - id: grid
    label: Netz
    x: 120
    y: 90
  - id: solar
    label: PV
    x: 680
    y: 90
  - id: house
    label: Haus
    x: 380
    y: 210
  - id: car
    label: EV
    x: 620
    y: 300
  - id: battery
    label: Akku
    x: 140
    y: 300
links:
  - from: solar
    to: house
    value: 4.2
    unit: ' kW'
    speed: 90
    arrow: true
  - from: grid
    to: house
    value: 1.1
    unit: ' kW'
    speed: 60
    color: '#5DA3F4'
  - from: house
    to: battery
    value: 0.6
    unit: ' kW'
    speed: 50
    color: '#EAB308'
  - from: battery
    to: house
    value: 0.3
    unit: ' kW'
    speed: -40
    color: '#F97316'
  - from: house
    to: car
    value: 2.4
    unit: ' kW'
    speed: 75
focus_ids: ['house']
```

## Dev
```bash
npm i
npm run build
```

## License
MIT
`;
