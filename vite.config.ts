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
    rollupOptions: {
      input: { index: 'src/ui/index.html', launcher: 'src/ui/launcher.html' },
    },
  },
  server: { port: 5173, strictPort: true },
});
