import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@indexql': path.resolve(__dirname, '../../src/core'),
      '@schema': path.resolve(__dirname, '../../schema'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/artifacts': 'http://localhost:3000',
      '/products': 'http://localhost:3000',
    },
  },
});
