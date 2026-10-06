import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { planKeys, requestError } from './plans.api';

type PlanOptionKind = 'subjects' | 'prompts' | 'profiles';
type PlanOption = { id: string; label: string; description: string };
type PlanOptionsPage = { items: PlanOption[]; page: number; page_size: number; total: number };
function planOptionsQuery(kind: PlanOptionKind, q: string, page: number) {
  return queryOptions({ queryKey: planKeys.options(kind, q, page), retry: false, retryOnMount: false, staleTime: 30_000,
    queryFn: async ({ signal }): Promise<PlanOptionsPage> => {
      const query = { q: q || undefined, page, page_size: 10 as const };
      if (kind === 'subjects') {
        const result = await api.GET('/api/v1/geo/subjects', { params: { query: { ...query, sort: 'NAME_ASC' } }, signal });
        if (!result.data) throw requestError('读取监测对象选项', result);
        return { ...result.data, items: result.data.items.map((item) => ({ id: item.id, label: item.display_name, description: `${item.subject_type} · ${item.is_active ? '已启用' : '已停用'}` })) };
      }
      if (kind === 'prompts') {
        const result = await api.GET('/api/v1/geo/prompt-variants', { params: { query: { ...query, sort: 'TEXT_ASC' } }, signal });
        if (!result.data) throw requestError('读取问题变体选项', result);
        return { ...result.data, items: result.data.items.map((item) => ({ id: item.id, label: item.prompt_text, description: `${item.language_code} · ${item.region_code} · ${item.mention_mode} · ${item.is_active ? '已启用' : '已停用'}` })) };
      }
      const result = await api.GET('/api/v1/geo/collection-profiles', { params: { query: { ...query, sort: 'NAME_ASC' } }, signal });
      if (!result.data) throw requestError('读取采集配置选项', result);
      return { ...result.data, items: result.data.items.map(({ summary }) => ({ id: summary.id, label: summary.name, description: `${summary.collection_mode} · ${summary.engine_surface.name} · ${summary.language_code} · ${summary.region_code} · ${summary.is_active ? '已启用' : '已停用'}` })) };
    },
  });
}
export { planOptionsQuery };
export type { PlanOption, PlanOptionKind, PlanOptionsPage };
