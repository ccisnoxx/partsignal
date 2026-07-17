/** 验证章节观察只暴露当前章节，并在观察器不可用时保持稳定首项。 */
import { act, render, screen } from '@testing-library/react';
import { useActiveSection } from './useActiveSection';

let notify: IntersectionObserverCallback;
const disconnect = vi.fn();

class IntersectionObserverStub {
  constructor(callback: IntersectionObserverCallback) {
    notify = callback;
  }
  observe() {}
  disconnect() { disconnect(); }
}

function Probe() {
  const active = useActiveSection(['first', 'second']);
  return <><output>{active}</output><section id="first" /><section id="second" /></>;
}

test('多个章节同时可见时选择最靠近阅读基准线的章节并清理观察器', () => {
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  const view = render(<Probe />);
  expect(screen.getByText('first')).toBeInTheDocument();

  act(() => notify([
    {
      isIntersecting: true,
      target: document.getElementById('first')!,
      boundingClientRect: { top: -95 },
    } as unknown as IntersectionObserverEntry,
    {
      isIntersecting: true,
      target: document.getElementById('second')!,
      boundingClientRect: { top: 360 },
    } as unknown as IntersectionObserverEntry,
  ], {} as IntersectionObserver));
  expect(screen.getByText('second')).toBeInTheDocument();

  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

test('观察器不可用时保持首章节', () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  render(<Probe />);
  expect(screen.getByText('first')).toBeInTheDocument();
  vi.unstubAllGlobals();
});
