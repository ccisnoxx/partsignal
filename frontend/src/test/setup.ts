/** Vitest 浏览器替身与 DOM 断言初始化。 */
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { queryClient } from '../app/queryClient';

configure({ asyncUtilTimeout: 10_000 });

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({ matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
});
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub });

afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); });
