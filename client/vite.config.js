import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS (self-signed) so WebXR, camera, GPS and mic work on a phone over Wi-Fi.
// /api and /media are proxied to the Express server, so the phone only talks to this one origin.
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/media': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/media': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
