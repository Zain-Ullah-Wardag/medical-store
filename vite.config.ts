import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri expects a fixed dev port; the sandbox preview proxies any 0.0.0.0 port.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true },
  build: { target: 'es2020', outDir: 'dist' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
