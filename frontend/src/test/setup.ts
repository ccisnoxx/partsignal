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

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: (element: Element, pseudoElement?: string | null) => (
    // rc-component 查询滚动条伪元素时，jsdom 会告警后返回宿主元素样式；这里直接执行同一回退。
    jsdomGetComputedStyle(element, pseudoElement === '::-webkit-scrollbar' ? undefined : pseudoElement)
  ),
});

afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); });
