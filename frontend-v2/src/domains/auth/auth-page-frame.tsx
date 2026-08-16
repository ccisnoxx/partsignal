import type { ReactNode } from 'react';

import { Button } from '@/design-system/primitives/button';
import { Skeleton } from '@/design-system/primitives/skeleton';

type AuthPageFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
};

function AuthPageFrame({ children, description, title }: AuthPageFrameProps) {
  return (
    <main className="grid min-h-screen place-items-center bg-surface-app p-4 text-text-primary">
      <section className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-border-subtle bg-surface-panel p-5 shadow-sm sm:p-6">
        <header className="flex flex-col gap-1">
          <p className="type-label text-text-muted">PartSignal</p>
          <h1 className="type-page-title">{title}</h1>
          <p className="text-text-secondary">{description}</p>
        </header>
        {children}
      </section>
    </main>
  );
}

function AuthLoadingPage() {
  return (
    <AuthPageFrame description="正在确认当前浏览器会话。" title="正在验证登录状态">
      <div aria-label="正在验证登录状态" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    </AuthPageFrame>
  );
}

function AuthErrorPage({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthPageFrame description="认证服务暂时不可用，请稍后重试。" title="无法验证登录状态">
      <div className="flex flex-col gap-3" role="alert">
        <p className="text-sm text-text-danger">当前无法确认账户状态，业务页面不会继续加载。</p>
        <Button onClick={onRetry} type="button" variant="outline">重试</Button>
      </div>
    </AuthPageFrame>
  );
}

export { AuthErrorPage, AuthLoadingPage, AuthPageFrame };
