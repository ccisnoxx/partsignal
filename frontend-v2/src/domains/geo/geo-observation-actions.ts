import type {
  OverflowRowAction,
  PrimaryRowAction,
} from '@/design-system/data-table/types';
import type { components } from '@/shared/api/generated/schema';

type GeoObservationAction = components['schemas']['ManualGeoObservation']['available_actions'][number];
type GeoObservationPrimaryTask = components['schemas']['ManualGeoObservation']['primary_task']
  | components['schemas']['LegacyGeoObservation']['primary_task'];

type GeoObservationActionContext = {
  actions: readonly GeoObservationAction[];
  deleting: boolean;
  label: string;
  observationId: string;
};

function resolveGeoObservationOverflowActions({
  actions,
  deleting,
  label,
  observationId,
}: GeoObservationActionContext): OverflowRowAction[] {
  return actions.map((action): OverflowRowAction => {
    if (action === 'CORRECT') {
      return {
        key: 'correct',
        label: '更正',
        href: `/geo/observations/${observationId}/correct`,
        intent: 'secondary',
        enabled: true,
      };
    }
    if (action === 'DELETE') {
      return {
        key: 'delete',
        label: deleting ? '删除中…' : '删除',
        command: 'delete-observation',
        intent: 'danger',
        enabled: !deleting,
        disabledReason: deleting ? '正在删除' : undefined,
        confirmation: {
          title: '删除 GEO 观测',
          description: `将永久删除“${label}”的完整更正链。此操作无法撤销。`,
          confirmLabel: '确认删除',
          intent: 'destructive',
        },
      };
    }
    return assertNever(action);
  });
}

function resolveGeoObservationPrimaryAction(
  task: GeoObservationPrimaryTask,
  observationId: string,
): PrimaryRowAction {
  if (task === 'VIEW_ANALYSIS') {
    return hrefPrimary('view-analysis', '查看结果', '#results');
  }
  if (task === 'CORRECT_OBSERVATION') {
    return hrefPrimary(
      'correct-observation',
      '更正 Observation',
      `/geo/observations/${observationId}/correct`,
    );
  }
  if (task === 'VIEW_CORRECTION_HISTORY') {
    return hrefPrimary('view-correction-history', '查看更正历史', '#correction-history');
  }
  if (task === 'VIEW_HISTORICAL_RECORD') {
    return hrefPrimary('view-historical-record', '查看原记录', '#observation-record');
  }
  return assertNever(task);
}

function hrefPrimary(key: string, label: string, href: string): PrimaryRowAction {
  return { key, label, href, intent: 'primary', enabled: true };
}

function assertNever(value: never): never {
  throw new Error(`GEO Observations 收到未知动作：${String(value)}`);
}

export {
  resolveGeoObservationOverflowActions,
  resolveGeoObservationPrimaryAction,
};
