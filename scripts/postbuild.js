// scripts/postbuild.js
// Optionally rewrite 'lit' import to unpkg so the bundle can work as a single file in HA without extra resources.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'dist/rootless-power-flow-card.js';
let code = readFileSync(f, 'utf8');
code = code.replace(/from \"lit\"/g, 'from "https://unpkg.com/lit@3.1.0/index.js?module"');
code = code.replace(/from \"lit\/decorators.js\"/g, 'from "https://unpkg.com/lit@3.1.0/decorators.js?module"');
writeFileSync(f, code);
console.log('Rewrote lit imports for direct usage without bundler in HA.');