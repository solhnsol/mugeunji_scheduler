import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../static/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/login': 'http://127.0.0.1:8000',
      '/register': 'http://127.0.0.1:8000',
      '/plans': 'http://127.0.0.1:8000',
      '/me': 'http://127.0.0.1:8000',
      '/reserve': 'http://127.0.0.1:8000',
      '/settings': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
      '/admin/login': 'http://127.0.0.1:8000',
      '/admin/users': 'http://127.0.0.1:8000',
      '/admin/settlement': 'http://127.0.0.1:8000',
      '/admin/billing': 'http://127.0.0.1:8000',
      '/admin/settings': 'http://127.0.0.1:8000',
      '/admin/automation': 'http://127.0.0.1:8000',
      '/admin/plans': 'http://127.0.0.1:8000',
      '/admin/reservations': 'http://127.0.0.1:8000',
      '/free': 'http://127.0.0.1:8000',
      '/weekly-usage': 'http://127.0.0.1:8000',
    },
  },
});
