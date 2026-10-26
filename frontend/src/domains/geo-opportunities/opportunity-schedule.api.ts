import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { PrincipalContinuation } from '@/app/auth/principal-epoch';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';
import { insightKeys } from '@/domains/geo-insights/insights.api';
import { reportKeys } from '@/domains/geo-reports/reports.api';
import { opportunityKeys, requestError } from './opportunities.api';
import { evaluationScopeSchema } from './opportunity-evaluation.model';

export type ScheduleDetail =
  components['schemas']['GeoOpportunityScheduleDetail'];
export type Configuration =
  components['schemas']['GeoOpportunityScheduleConfiguration'];
export type Action = ScheduleDetail['available_actions'][number];
export const actionLabels = {
  CONFIGURE: '编辑周期配置',
  ACTIVATE: '启用周期评估',
  PAUSE: '暂停周期评估',
  RESUME: '恢复周期评估',
} satisfies Record<Action, string>;
export const blockedLabels = {
  GEO_MONITORING_DISABLED: '监测或机会评估总开关关闭',
  AUTH_REQUIRED: '执行授权账号已停用或不可用',
  PASSWORD_CHANGE_REQUIRED: '执行授权账号需先完成改密',
  PERMISSION_DENIED: '执行授权账号已不再是管理员',
} satisfies Record<NonNullable<ScheduleDetail['blocked_reason']>, string>;
export const scheduleForm = evaluationScopeSchema.safeExtend({
  rule_set_revision: z.number().int().min(1, '规则修订号必须是正整数'),
  interval_hours: z
    .number()
    .int()
    .min(1, '周期至少1小时')
    .max(168, '周期最多168小时'),
  lookback_days: z.number().int().min(1, '至少回看1天').max(31, '最多回看31天'),
});
export type Values = z.infer<typeof scheduleForm>;
export const initialSchedule: Values = {
  scope: 'ALL',
  subject_ids: [],
  engine_surface_ids: [],
  collection_profile_ids: [],
  collection_modes: ['MANUAL'],
  rule_set_revision: 1,
  interval_hours: 24,
  lookback_days: 7,
};
export function scheduleValues(
  value: Configuration | null | undefined,
): Values {
  return value
    ? {
        ...value,
        subject_ids: [...(value.subject_ids ?? [])],
        engine_surface_ids: [...(value.engine_surface_ids ?? [])],
        collection_profile_ids: [...(value.collection_profile_ids ?? [])],
        collection_modes: [...(value.collection_modes ?? [])],
      }
    : structuredClone(initialSchedule);
}
export const scheduleKey = ['geo', 'opportunity-evaluation-schedule'] as const;
export function scheduleOptions(enabled: boolean) {
  return queryOptions({
    queryKey: scheduleKey,
    enabled,
    gcTime: 0,
    retry: false,
    retryOnMount: false,
    staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const result = await api.GET(
        '/api/v1/geo/opportunities/evaluation-schedule',
        { signal, cache: 'no-store' },
      );
      if (!result.data) throw requestError('读取周期评估配置', result);
      return result.data;
    },
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      !query.state.error && query.state.data?.status === 'ACTIVE'
        ? 15_000
        : false,
  });
}
export type ScheduleCommand = {
  action: Action;
  revision: number;
  requestId: string;
  configuration?: Configuration;
};
export async function sendSchedule(
  command: ScheduleCommand,
  csrf: string,
  signal: AbortSignal,
) {
  const params = {
    header: { 'X-CSRF-Token': csrf, 'X-Request-ID': command.requestId },
  };
  if (command.action === 'CONFIGURE') {
    if (!command.configuration) throw new Error('保存周期配置缺少明确配置');
    const result = await api.PUT(
      '/api/v1/geo/opportunities/evaluation-schedule',
      {
        params,
        signal,
        cache: 'no-store',
        body: {
          expected_revision: command.revision,
          configuration: command.configuration,
        },
      },
    );
    if (!result.data) throw requestError('保存周期评估', result);
    return result.data;
  }
  const paths = {
    ACTIVATE: '/api/v1/geo/opportunities/evaluation-schedule/activate',
    PAUSE: '/api/v1/geo/opportunities/evaluation-schedule/pause',
    RESUME: '/api/v1/geo/opportunities/evaluation-schedule/resume',
  } as const;
  const result = await api.POST(paths[command.action], {
    params,
    signal,
    cache: 'no-store',
    body: { expected_revision: command.revision },
  });
  if (!result.data) throw requestError(actionLabels[command.action], result);
  return result.data;
}
export async function refreshOpportunityReadModels(
  client: QueryClient,
  owner: PrincipalContinuation,
) {
  const keys = [opportunityKeys.root(), insightKeys.root, reportKeys.root];
  if (!owner.isCurrent()) return;
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  if (!owner.isCurrent()) return;
  await Promise.all(
    keys.map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}
