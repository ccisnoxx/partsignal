import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// TanStack Router 挂载时恢复滚动位置，jsdom 尚未实现该浏览器能力。
Object.defineProperty(window, 'scrollTo', { writable: true, value: vi.fn() });

afterEach(cleanup);
