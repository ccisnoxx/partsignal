import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
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
import {
  createGeoIntervention,
  geoInterventionAssigneeChoicesQueryOptions,
  geoInterventionCampaignChoicesQueryOptions,
  geoInterventionEvidenceChoicesQueryOptions,
  geoInterventionKeys,
  geoInterventionOpportunityChoicesQueryOptions,
  GeoInterventionRequestError,
  invalidateGeoInterventionQueries,
  isGeoInterventionStaleConflict,
  updateGeoIntervention,
} from './geo-intervention.api';
import { GeoInterventionFormFields } from './geo-intervention-form-fields';
import {
  buildInitialGeoInterventionDraft,
  extractBaselineChoices,
  geoInterventionStatusRegistry,
  toLocalDateTimeValue,
  validateGeoInterventionFormDraft,
  type GeoInterventionFormDraft,
  type GeoInterventionOut,
  type ValidatedGeoInterventionForm,
} from './geo-intervention.model';
import { useGeoInterventionReload } from './use-geo-intervention-reload';

export type GeoInterventionFormDialogProps =
  | {
      mode: 'create';
      csrfToken: string | null;
      lockedCampaignId?: string;
      lockedCampaignName?: string;
      lockedOpportunityId?: string;
      lockedOpportunityTitle?: string;
      finalFocus?: () => HTMLElement | null;
      onClose: () => void;
      onSaved?: (saved: GeoInterventionOut) => void;
    }
  | {
      mode: 'edit';
      csrfToken: string | null;
      intervention: GeoInterventionOut;
      finalFocus?: () => HTMLElement | null;
      onClose: () => void;
      onSaved?: (saved: GeoInterventionOut) => void;
    };

export function GeoInterventionFormDialog(props: GeoInterventionFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const {
    liveIntervention,
    reloading,
    reloadError,
    reloadNotice,
    clearReloadState,
    reloadLatest,
  } = useGeoInterventionReload(props.mode === 'edit' ? props.intervention : null);

  const editTarget = props.mode === 'edit' ? (liveIntervention ?? props.intervention) : null;
  const formKey = props.mode === 'edit'
    ? `edit:${(editTarget ?? props.intervention).id}:${(editTarget ?? props.intervention).revision}`
    : `create:${props.lockedCampaignId ?? ''}:${props.lockedOpportunityId ?? ''}`;

  const handleReloadLatest = () =>
    reloadLatest({
      target: editTarget,
      isSubmitting: saving,
      formatNotice: (latest) => `已重新加载最新版本 r${latest.revision}，请核对最新内容后再提交。`,
    });

  return (
    <Dialog onOpenChange={(next) => { if (!next && !saving && !reloading) props.onClose(); }} open>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        finalFocus={props.finalFocus}
        showCloseButton={!saving && !reloading}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>
              {props.mode === 'create' ? '新建 GEO 干预归因记录' : '编辑 GEO 干预归因记录'}
            </DialogTitle>
            <Badge variant="warning">非强因果 · NOT_ESTABLISHED</Badge>
          </div>
          <DialogDescription>
            {props.mode === 'create'
              ? '记录针对特定 GEO 机会的优化假设、预期行动类型与目标指标，后续结合复测证据独立评估变化（不宣称强因果）。'
              : `更新非终态 GEO 干预配置与进度，提交时校验乐观锁版本 r${editTarget?.revision ?? 0}。`}
          </DialogDescription>
        </DialogHeader>

        {props.mode === 'edit' && editTarget && !editTarget.available_actions.includes('UPDATE') ? (
          <div className="space-y-4">
            <div
              className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
              role="alert"
            >
              该 GEO 干预最新状态为「{geoInterventionStatusRegistry[editTarget.status].label}」（版本 r
              {editTarget.revision}），已进入终态并冻结，不可继续编辑。
            </div>
            <DialogFooter>
              <Button onClick={props.onClose} type="button" variant="outline">
                关闭
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <GeoInterventionFormBody
            csrfToken={props.csrfToken}
            editTarget={editTarget}
            key={formKey}
            lockedCampaignId={props.mode === 'create' ? props.lockedCampaignId : undefined}
            lockedCampaignName={props.mode === 'create' ? props.lockedCampaignName : undefined}
            lockedOpportunityId={props.mode === 'create' ? props.lockedOpportunityId : undefined}
            lockedOpportunityTitle={
              props.mode === 'create' ? props.lockedOpportunityTitle : undefined
            }
            mode={props.mode}
            onClearReloadState={clearReloadState}
            onClose={props.onClose}
            onReloadLatest={props.mode === 'edit' ? handleReloadLatest : undefined}
            onSaved={props.onSaved}
            onSavingChange={setSaving}
            reloadError={reloadError}
            reloadNotice={reloadNotice}
            reloading={reloading}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function queryErrorText(isError: boolean, error: unknown, fallback: string): string | null {
  if (!isError) return null;
  return error instanceof Error ? error.message : fallback;
}

type FormBodyProps = {
  mode: 'create' | 'edit';
  csrfToken: string | null;
  editTarget: GeoInterventionOut | null;
  lockedCampaignId?: string;
  lockedCampaignName?: string;
  lockedOpportunityId?: string;
  lockedOpportunityTitle?: string;
  reloading: boolean;
  reloadError: string | null;
  reloadNotice: string | null;
  onClearReloadState: () => void;
  onReloadLatest?: () => Promise<boolean>;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
  onSaved?: (saved: GeoInterventionOut) => void;
};

function GeoInterventionFormBody({
  mode,
  csrfToken,
  editTarget,
  lockedCampaignId,
  lockedCampaignName,
  lockedOpportunityId,
  lockedOpportunityTitle,
  reloading,
  reloadError,
  reloadNotice,
  onClearReloadState,
  onReloadLatest,
  onSavingChange,
  onClose,
  onSaved,
}: FormBodyProps) {
  const queryClient = useQueryClient();
  const initialIntervenedLocal = toLocalDateTimeValue(editTarget?.intervened_at);
  const initialStartLocal = toLocalDateTimeValue(editTarget?.retest_window_start);
  const initialEndLocal = toLocalDateTimeValue(editTarget?.retest_window_end);

  const [draft, setDraft] = useState<GeoInterventionFormDraft>(() =>
    buildInitialGeoInterventionDraft(editTarget, lockedCampaignId, lockedOpportunityId),
  );
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);

  const needOpportunityPicker = mode === 'create' && !lockedOpportunityId;
  const needCampaignPicker = mode === 'edit' || !lockedCampaignId;

  const opportunitiesQuery = useQuery(
    geoInterventionOpportunityChoicesQueryOptions(needOpportunityPicker),
  );
  const campaignsQuery = useQuery(geoInterventionCampaignChoicesQueryOptions(needCampaignPicker));
  const assigneesQuery = useQuery(geoInterventionAssigneeChoicesQueryOptions(true));
  const evidenceQuery = useQuery(
    geoInterventionEvidenceChoicesQueryOptions(draft.opportunityId, Boolean(draft.opportunityId)),
  );

  const saveMutation = useMutation({
    mutationFn: async (parsed: ValidatedGeoInterventionForm) => {
      if (mode === 'create') {
        return createGeoIntervention(
          {
            opportunity_id: draft.opportunityId,
            campaign_id: draft.campaignId || null,
            title: parsed.title,
            hypothesis: parsed.hypothesis,
            planned_action_type: draft.plannedActionType,
            target_metrics: parsed.targetMetrics,
            baseline_id: draft.baselineId || null,
            assignee_id: draft.assigneeId || null,
            intervened_at: parsed.intervenedAt,
            retest_window_start: parsed.retestWindowStart,
            retest_window_end: parsed.retestWindowEnd,
          },
          csrfToken,
        );
      }
      if (!editTarget) throw new Error('缺少待更新的 GEO 干预快照');
      return updateGeoIntervention(
        editTarget.id,
        {
          campaign_id: draft.campaignId || null,
          title: parsed.title,
          hypothesis: parsed.hypothesis,
          planned_action_type: draft.plannedActionType,
          status: draft.status,
          target_metrics: parsed.targetMetrics,
          baseline_id: draft.baselineId || null,
          decision_id: draft.decisionId || null,
          assignee_id: draft.assigneeId || null,
          intervened_at: parsed.intervenedAt,
          retest_window_start: parsed.retestWindowStart,
          retest_window_end: parsed.retestWindowEnd,
          expected_revision: editTarget.revision,
        },
        csrfToken,
      );
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current || reloading) return;
    onClearReloadState();

    const validated = validateGeoInterventionFormDraft(mode, draft, editTarget, {
      intervenedLocal: initialIntervenedLocal,
      startLocal: initialStartLocal,
      endLocal: initialEndLocal,
    });
    if (!validated.ok) {
      setFormError(validated.message);
      setStaleConflict(false);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    setStaleConflict(false);
    onSavingChange(true);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      const saved = await saveMutation.mutateAsync(validated.value);
      if (!continuation.isCurrent()) return;
      await invalidateGeoInterventionQueries(queryClient, {
        campaignIds: [editTarget?.campaign_id, saved.campaign_id],
        opportunityId: saved.opportunity_id,
        interventionId: saved.id,
      });
      if (!continuation.isCurrent()) return;
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (continuation && !continuation.isCurrent()) return;
      if (err instanceof GeoInterventionRequestError) {
        if (err.code === 'INVALID_STATE_TRANSITION') {
          void queryClient.invalidateQueries({ queryKey: geoInterventionKeys.campaignChoices() });
        } else if (err.code === 'ASSIGNEE_INACTIVE') {
          void queryClient.invalidateQueries({ queryKey: geoInterventionKeys.assigneeChoices() });
        }
      }
      setStaleConflict(mode === 'edit' && isGeoInterventionStaleConflict(err));
      setFormError(err instanceof Error ? err.message : '保存 GEO 干预失败');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      onSavingChange(false);
    }
  }

  const busy = submitting || reloading;

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
      {reloadNotice && !formError && !reloadError && (
        <div
          className="rounded-lg border border-border-subtle bg-surface-subtle/50 p-2.5 text-xs text-text-secondary"
          role="status"
        >
          {reloadNotice}
        </div>
      )}
      {(formError || reloadError) && (
        <div
          className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs"
          role="alert"
        >
          <p>{reloadError ?? formError}</p>
          {staleConflict && onReloadLatest && (
            <Button
              disabled={busy}
              onClick={async () => {
                const ok = await onReloadLatest();
                if (ok) {
                  setFormError(null);
                  setStaleConflict(false);
                }
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {reloading ? '正在加载最新记录…' : '重新加载最新记录'}
            </Button>
          )}
        </div>
      )}

      <GeoInterventionFormFields
        assignees={assigneesQuery.data?.items ?? []}
        assigneesError={queryErrorText(assigneesQuery.isError, assigneesQuery.error, '加载可选负责人失败')}
        assigneesLoaded={assigneesQuery.isSuccess}
        assigneesLoading={assigneesQuery.isPending}
        baselineChoices={extractBaselineChoices(evidenceQuery.data)}
        busy={busy}
        campaigns={campaignsQuery.data?.items ?? []}
        campaignsError={queryErrorText(campaignsQuery.isError, campaignsQuery.error, '加载可选内容活动失败')}
        campaignsLoading={campaignsQuery.isPending}
        campaignsTotal={campaignsQuery.data?.total ?? 0}
        decisionChoices={evidenceQuery.data?.decisions ?? []}
        draft={draft}
        editTarget={editTarget}
        evidenceError={queryErrorText(evidenceQuery.isError, evidenceQuery.error, '加载复测基线与处理结论失败')}
        evidenceLoading={evidenceQuery.isPending}
        lockedCampaignId={lockedCampaignId}
        lockedCampaignName={lockedCampaignName}
        lockedOpportunityId={lockedOpportunityId}
        lockedOpportunityTitle={lockedOpportunityTitle}
        mode={mode}
        onDraftChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        onRetryAssignees={() => void assigneesQuery.refetch()}
        onRetryCampaigns={() => void campaignsQuery.refetch()}
        onRetryEvidence={() => void evidenceQuery.refetch()}
        onRetryOpportunities={() => void opportunitiesQuery.refetch()}
        opportunities={opportunitiesQuery.data?.items ?? []}
        opportunitiesError={queryErrorText(
          opportunitiesQuery.isError,
          opportunitiesQuery.error,
          '加载可选 GEO 机会失败',
        )}
        opportunitiesLoading={opportunitiesQuery.isPending}
        opportunitiesTotal={opportunitiesQuery.data?.total ?? 0}
      />

      {editTarget && (
        <p className="text-xs text-text-muted">
          当前提交版本：r{editTarget.revision} · 机会 ID：{editTarget.opportunity_id}
        </p>
      )}

      <DialogFooter>
        <Button disabled={busy} onClick={onClose} type="button" variant="outline">
          取消
        </Button>
        <Button disabled={busy} type="submit">
          {submitting
            ? (mode === 'create' ? '创建中…' : '保存中…')
            : (mode === 'create' ? '创建干预' : '保存修改')}
        </Button>
      </DialogFooter>
    </form>
  );
}
