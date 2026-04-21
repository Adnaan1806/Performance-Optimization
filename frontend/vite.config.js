import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

// No manualChunks, no compression plugin, no build-time image optimization.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'analyze' && visualizer({ filename: 'dist/stats.html', open: false, gzipSize: true }),
  ].filter(Boolean),
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  build: {
    sourcemap: true,
  },
}));
