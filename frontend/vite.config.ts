/** 前端开发服务器、测试环境和 API 代理配置。 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // 共享 CI runner 使用两个 worker 有界并行，避免单 worker 累积导致跨文件超时。
    fileParallelism: true,
    maxWorkers: 2,
    testTimeout: 30_000,
    exclude: ['tests/e2e/**', 'scripts/check-theme-colors.test.mjs', 'scripts/theme-init.test.mjs', 'node_modules/**', 'dist/**'],
  },
});
