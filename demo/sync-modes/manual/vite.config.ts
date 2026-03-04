import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'client'),
  server: {
    port: 5013,
    proxy: {
      '/snapshot.bin': 'http://localhost:3013',
      '/head': 'http://localhost:3013',
    },
  },
});
