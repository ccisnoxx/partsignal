import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DirtyGuard } from './dirty-guard';

function GuardDemo() {
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  return (
    <main>
      <label><input onChange={(event) => setDirty(event.target.checked)} type="checkbox" />有草稿</label>
      <button onClick={() => router.history.push('/?page=2')} type="button">修改 search</button>
      <button onClick={() => router.history.push('/#result')} type="button">修改 hash</button>
      <DirtyGuard when={dirty} />
    </main>
  );
}

function renderGuard() {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/', component: GuardDemo });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/#summary'] }),
    routeTree: root.addChildren([route]),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function SelectiveGuardDemo() {
  const router = useRouter();
  return (
    <main>
      <button onClick={() => router.history.push('/?promptId=one&q=next')} type="button">只改搜索</button>
      <button onClick={() => router.history.push('/?promptId=two&q=next')} type="button">切换对象</button>
      <DirtyGuard
        shouldBlockNavigation={({ current, next }) => {
          const currentSearch = current.search as Record<string, unknown>;
          const nextSearch = next.search as Record<string, unknown>;
          return currentSearch.promptId !== nextSearch.promptId;
        }}
        when
      />
    </main>
  );
}

function renderSelectiveGuard() {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/', component: SelectiveGuardDemo });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/?promptId=one&q=current'] }),
    routeTree: root.addChildren([route]),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('DirtyGuard full URL', () => {
  it('脏表单同时拦截 search 与 hash 导航', async () => {
    const user = userEvent.setup();
    const router = renderGuard();
    await user.click(await screen.findByRole('checkbox', { name: '有草稿' }));

    await user.click(screen.getByRole('button', { name: '修改 search' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.search).toEqual({});

    await user.click(screen.getByRole('button', { name: '修改 hash' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.hash).toBe('summary');
  });

  it('可选 predicate 允许安全导航，并继续阻断编辑对象变化', async () => {
    const user = userEvent.setup();
    const router = renderSelectiveGuard();

    await user.click(await screen.findByRole('button', { name: '只改搜索' }));
    expect(router.state.location.search).toEqual({ promptId: 'one', q: 'next' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '切换对象' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(router.state.location.search).toEqual({ promptId: 'one', q: 'next' });
  });
});
