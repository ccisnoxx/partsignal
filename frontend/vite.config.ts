/** 前端开发服务器、测试环境和 API 代理配置。 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
    // Ant Design 页面测试串行执行，避免共享 CI runner 在并行 JSDOM 渲染时超时。
    fileParallelism: false,
    testTimeout: 15_000,
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
});
