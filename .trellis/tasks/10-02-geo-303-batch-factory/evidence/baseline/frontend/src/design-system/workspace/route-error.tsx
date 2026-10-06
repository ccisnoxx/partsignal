import { Button } from '@/design-system/primitives/button';

type RouteErrorProps = {
  error: Error;
  onRetry: () => void;
  title: string;
};

function RouteError({ error, onRetry, title }: RouteErrorProps) {
  return (
    <section className="space-y-3 rounded-xl border border-border-subtle bg-surface-panel p-4" role="alert">
      <h1 className="type-page-title">{title}</h1>
      <p className="text-text-secondary">{error.message}</p>
      <Button onClick={onRetry} type="button">重试</Button>
    </section>
  );
}

export { RouteError };
