import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: FoundationHome,
});

function FoundationHome() {
  useQueryClient();

  return (
    <section className="space-y-2 text-center">
      <h1 className="text-2xl font-semibold">PartSignal Frontend V2</h1>
      <p>Foundation Bootstrap 已就绪。</p>
    </section>
  );
}
