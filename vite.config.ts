import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [preact()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
    target: 'chrome140',
  },
  server: { port: 5173, strictPort: true },
});
