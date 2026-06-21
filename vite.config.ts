import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy backend API calls to backend server
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy Harness API calls to avoid CORS in dev
      '/api/harness': {
        target: 'https://app.harness.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/harness/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Add Harness auth headers from env
            proxyReq.setHeader('x-api-key', env.VITE_HARNESS_API_KEY || '');
            proxyReq.setHeader('Harness-Account', env.VITE_HARNESS_ACCOUNT_ID || ''); // Capitalized!

            // Log proxied requests for debugging
            const url = req.url || '';
            if (url.includes('gateway') || url.includes('ssca')) {
              console.log(`[PROXY] ${req.method} ${url}`);
            }
          });
        },
      },
    },
  },
  };
});
