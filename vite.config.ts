import { defineConfig } from 'vite';
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
});