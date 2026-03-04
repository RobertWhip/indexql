import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'client'),
  server: {
    port: 5011,
    proxy: {
      '/snapshot.bin': 'http://localhost:3011',
      '/head': 'http://localhost:3011',
    },
  },
});
