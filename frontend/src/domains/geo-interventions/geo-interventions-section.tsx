import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog';
import { geoInterventionsListQueryOptions } from './geo-intervention.api';
import { GeoInterventionCancelDialog } from './geo-intervention-cancel-dialog';
import { GeoInterventionConcludeDialog } from './geo-intervention-conclude-dialog';
import { GeoInterventionFormDialog } from './geo-intervention-form-dialog';
import {
  formatMetricValue,
  formatRatePercent,
  formatSignedMetricDelta,
  geoInterventionActionTypeLabels,
  geoInterventionMetricLabel,
  geoInterventionStatusRegistry,
  geoInterventionVerdictRegistry,
  type GeoInterventionOut,
} from './geo-intervention.model';

export type GeoInterventionScope =
  | {
      kind: 'campaign';
      campaignId: string;
      campaignName: string;
      canCreate: boolean;
    }
  | {
      kind: 'opportunity';
      opportunityId: string;
      opportunityTitle: string;
      canCreate: boolean;
    };

type ActiveModal =
  | { kind: 'create' }
  | { kind: 'edit' | 'conclude' | 'cancel'; intervention: GeoInterventionOut };

type GeoInterventionsSectionProps = {
  scope: GeoInterventionScope;
  csrfToken: string | null;
  onBusyChange?: (busy: boolean) => void;
};

export function GeoInterventionsSection({
  scope,
  csrfToken,
  onBusyChange,
}: GeoInterventionsSectionProps) {
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const sectionFocusRef = useRef<HTMLDivElement | null>(null);
  const triggerReturnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  const interventionsQuery = useQuery(geoInterventionsListQueryOptions(scope));

  function openModal(next: ActiveModal) {
    triggerReturnRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setActiveModal(next);
    onBusyChange?.(true);
  }

  function closeModal() {
    setActiveModal(null);
    onBusyChange?.(false);
  }

  const resolveFinalFocus = () =>
    triggerReturnRef.current?.isConnected ? triggerReturnRef.current : sectionFocusRef.current;

  const data = interventionsQuery.data;

  return (
    <div className="space-y-2.5 outline-none" ref={sectionFocusRef} tabIndex={-1}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">
          GEO 干预归因记录{data ? `（共 ${data.total} 条）` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            disabled={interventionsQuery.isFetching}
            onClick={() => void interventionsQuery.refetch()}
            size="sm"
            type="button"
            variant="ghost"
          >
            刷新干预
          </Button>
          {scope.canCreate && (
            <Button
              onClick={() => openModal({ kind: 'create' })}
              size="sm"
              type="button"
              variant="outline"
            >
              新建干预
            </Button>
          )}
        </div>
      </div>

      {interventionsQuery.error && data && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs"
          role="alert"
        >
          <span>
            刷新 GEO 干预记录失败（当前保留上次数据）：
            {interventionsQuery.error instanceof Error
              ? interventionsQuery.error.message
              : '请求失败'}
          </span>
          <Button
            onClick={() => void interventionsQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            重试
          </Button>
        </div>
      )}

      {interventionsQuery.isPending && !data ? (
        <p className="text-xs text-text-muted">正在加载 GEO 干预记录…</p>
      ) : interventionsQuery.error && !data ? (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs"
          role="alert"
        >
          <span>
            {interventionsQuery.error instanceof Error
              ? interventionsQuery.error.message
              : '加载 GEO 干预记录失败'}
          </span>
          <Button
            onClick={() => void interventionsQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            重试
          </Button>
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-1.5">
          {data.total > data.items.length && (
            <p className="text-xs text-text-muted">
              当前展示最近 {data.items.length} 条，共 {data.total} 条干预记录。
            </p>
          )}
          <ul className="space-y-2 text-xs">
            {data.items.map((item) => (
              <GeoInterventionCard
                item={item}
                key={item.id}
                onAction={(kind) => openModal({ kind, intervention: item })}
                scopeKind={scope.kind}
              />
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border-default p-3 text-xs text-text-muted">
          {scope.kind === 'campaign'
            ? '当前活动尚未关联 GEO 干预归因记录。'
            : '当前 GEO 机会尚未创建干预归因记录。'}
        </p>
      )}

      {activeModal?.kind === 'create' && (
        <GeoInterventionFormDialog
          csrfToken={csrfToken}
          finalFocus={resolveFinalFocus}
          lockedCampaignId={scope.kind === 'campaign' ? scope.campaignId : undefined}
          lockedCampaignName={scope.kind === 'campaign' ? scope.campaignName : undefined}
          lockedOpportunityId={scope.kind === 'opportunity' ? scope.opportunityId : undefined}
          lockedOpportunityTitle={
            scope.kind === 'opportunity' ? scope.opportunityTitle : undefined
          }
          mode="create"
          onClose={closeModal}
        />
      )}

      {activeModal?.kind === 'edit' && (
        <GeoInterventionFormDialog
          csrfToken={csrfToken}
          finalFocus={resolveFinalFocus}
          intervention={activeModal.intervention}
          mode="edit"
          onClose={closeModal}
        />
      )}

      {activeModal?.kind === 'conclude' && (
        <GeoInterventionConcludeDialog
          csrfToken={csrfToken}
          finalFocus={resolveFinalFocus}
          intervention={activeModal.intervention}
          onClose={closeModal}
        />
      )}

      {activeModal?.kind === 'cancel' && (
        <GeoInterventionCancelDialog
          csrfToken={csrfToken}
          finalFocus={resolveFinalFocus}
          intervention={activeModal.intervention}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function GeoInterventionCard({
  item,
  scopeKind,
  onAction,
}: {
  item: GeoInterventionOut;
  scopeKind: GeoInterventionScope['kind'];
  onAction: (kind: 'edit' | 'conclude' | 'cancel') => void;
}) {
  const statusMeta = geoInterventionStatusRegistry[item.status];
  const verdictMeta = item.outcome_verdict
    ? geoInterventionVerdictRegistry[item.outcome_verdict]
    : null;
  const attr = item.attribution;
  const comparabilityText = attr.comparable === true
    ? '可比'
    : attr.comparable === false
      ? '不可比'
      : '待复测对比';

  return (
    <li className="space-y-1.5 rounded-lg border border-border-subtle p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-text-primary">{item.title}</strong>
            <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>
            {verdictMeta && <Badge variant={verdictMeta.tone}>{verdictMeta.label}</Badge>}
            <span className="font-mono text-[11px] text-text-muted">r{item.revision}</span>
          </div>
          <p className="text-text-muted">
            行动：{geoInterventionActionTypeLabels[item.planned_action_type]}
            {' · '}负责人：{item.assignee_display_name ?? '未分派'}
            {scopeKind === 'opportunity' && item.campaign_name
              ? ` · 活动：${item.campaign_name}`
              : scopeKind === 'campaign'
                ? ` · 机会规则：${item.opportunity_rule_code}`
                : ''}
          </p>
        </div>

        {item.available_actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {item.available_actions.includes('UPDATE') && (
              <Button
                onClick={() => onAction('edit')}
                size="sm"
                type="button"
                variant="outline"
              >
                编辑
              </Button>
            )}
            {item.available_actions.includes('CONCLUDE') && (
              <Button
                onClick={() => onAction('conclude')}
                size="sm"
                type="button"
                variant="outline"
              >
                结案
              </Button>
            )}
            {item.available_actions.includes('CANCEL') && (
              <Button
                onClick={() => onAction('cancel')}
                size="sm"
                type="button"
                variant="ghost"
              >
                取消干预
              </Button>
            )}
          </div>
        )}
      </div>

      <p className="whitespace-pre-wrap text-text-secondary">假设：{item.hypothesis}</p>

      <p className="text-[11px] text-text-muted">
        非强因果（{item.causal_claim}）
        {' · '}基线 {attr.baseline_completed_run_count}/{attr.baseline_sample_count}
        {' · '}复测 {attr.retest_completed_run_count}/{attr.retest_sample_count}
        {' · '}可比性：{comparabilityText}
        {' · '}缺失率 {formatRatePercent(attr.missing_data_rate)}
        {' · '}关联行动 {attr.linked_actions.length} 项
      </p>

      {attr.metric_deltas.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {attr.metric_deltas.map((delta) => (
            <span
              className="inline-flex items-center gap-1 rounded border border-border-subtle bg-surface-subtle/40 px-1.5 py-0.5 font-mono text-[11px]"
              key={delta.metric_code}
            >
              <span>{geoInterventionMetricLabel(delta.metric_code)}</span>
              <span>
                {formatMetricValue(delta.metric_code, delta.baseline_value)} →{' '}
                {formatMetricValue(delta.metric_code, delta.retest_value)}
              </span>
              <span>({formatSignedMetricDelta(delta.metric_code, delta.delta)})</span>
              {delta.target_met === true && <Badge variant="success">达标</Badge>}
              {delta.target_met === false && <Badge variant="warning">未达标</Badge>}
            </span>
          ))}
        </div>
      )}

      {item.conclusion_note && (
        <p className="whitespace-pre-wrap rounded bg-surface-subtle/40 px-2 py-1 text-text-secondary">
          {item.status === 'CANCELLED' ? '取消原因：' : '结案说明：'}
          {item.conclusion_note}
        </p>
      )}
    </li>
  );
}

type OpportunityInterventionsDialogButtonProps = {
  opportunityId: string;
  opportunityTitle: string;
  csrfToken: string | null;
};

export function OpportunityInterventionsDialogButton({
  opportunityId,
  opportunityTitle,
  csrfToken,
}: OpportunityInterventionsDialogButtonProps) {
  const [open, setOpen] = useState(false);
  const [childBusy, setChildBusy] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        干预归因记录
      </Button>
      {open && (
        <Dialog onOpenChange={(next) => { if (!next && !childBusy) setOpen(false); }} open>
          <DialogContent
            className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
            showCloseButton={!childBusy}
          >
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>GEO 干预归因记录</DialogTitle>
                <Badge variant="warning">非强因果 · NOT_ESTABLISHED</Badge>
              </div>
              <DialogDescription>
                围绕机会「{opportunityTitle}」编排优化假设、推进执行并按复测证据冻结归因结论或取消干预。
              </DialogDescription>
            </DialogHeader>

            <GeoInterventionsSection
              csrfToken={csrfToken}
              onBusyChange={setChildBusy}
              scope={{
                kind: 'opportunity',
                opportunityId,
                opportunityTitle,
                canCreate: true,
              }}
            />

            <DialogFooter>
              <Button
                disabled={childBusy}
                onClick={() => setOpen(false)}
                type="button"
                variant="outline"
              >
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
