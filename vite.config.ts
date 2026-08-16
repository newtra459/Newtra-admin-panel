import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_BASE_URL || '';

  return {
  plugins: [react()],
  server: apiTarget ? {
    proxy: {
      '/v1': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
      },
    },
  } : {},
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-xlsx': ['xlsx'],
          'vendor-pdf-qr': ['jspdf', 'qrcode', 'qrcode.react'],
          'vendor-map': ['leaflet', 'open-location-code'],
        },
      },
    },
  },
  };
});
