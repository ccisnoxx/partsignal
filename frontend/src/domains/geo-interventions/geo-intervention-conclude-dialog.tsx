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
import { Textarea } from '@/design-system/primitives/textarea';
import {
  concludeGeoIntervention,
  geoInterventionEvidenceChoicesQueryOptions,
  invalidateGeoInterventionQueries,
  isGeoInterventionStaleConflict,
} from './geo-intervention.api';
import {
  charLength,
  decisionKindLabels,
  formatRatePercent,
  formatShortDateTime,
  geoInterventionStatusRegistry,
  geoInterventionVerdictRegistry,
  geoInterventionVerdictValues,
  type GeoInterventionOut,
  type GeoInterventionOutcomeVerdict,
} from './geo-intervention.model';
import { useGeoInterventionReload } from './use-geo-intervention-reload';

type GeoInterventionConcludeDialogProps = {
  intervention: GeoInterventionOut;
  csrfToken: string | null;
  finalFocus?: () => HTMLElement | null;
  onClose: () => void;
  onCompleted?: (updated: GeoInterventionOut) => void;
};

export function GeoInterventionConcludeDialog({
  intervention,
  csrfToken,
  finalFocus,
  onClose,
  onCompleted,
}: GeoInterventionConcludeDialogProps) {
  const [saving, setSaving] = useState(false);
  const {
    liveIntervention,
    reloading,
    reloadError,
    reloadNotice,
    clearReloadState,
    reloadLatest,
  } = useGeoInterventionReload(intervention);

  const current = liveIntervention ?? intervention;
  const canConclude = current.available_actions.includes('CONCLUDE');

  const handleReloadLatest = () =>
    reloadLatest({
      target: current,
      isSubmitting: saving,
      formatNotice: (latest) => `已同步最新版本 r${latest.revision}，已保留草稿，请核对后重新提交。`,
    });

  return (
    <Dialog onOpenChange={(next) => { if (!next && !saving && !reloading) onClose(); }} open>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        finalFocus={finalFocus}
        showCloseButton={!saving && !reloading}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>结案 GEO 干预并冻结归因结论</DialogTitle>
            <Badge variant="warning">非强因果 · NOT_ESTABLISHED</Badge>
          </div>
          <DialogDescription>
            结案后状态将永久冻结为「已结案」，记录归因结果与复盘依据，且始终保持非强因果披露。
          </DialogDescription>
        </DialogHeader>

        {!canConclude ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
              该 GEO 干预最新状态为「{geoInterventionStatusRegistry[current.status].label}」（版本 r
              {current.revision}），当前不可执行结案操作。
            </div>
            <DialogFooter>
              <Button onClick={onClose} type="button" variant="outline">
                关闭
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <ConcludeFormBody
            csrfToken={csrfToken}
            intervention={current}
            key={current.id}
            onClearReloadState={clearReloadState}
            onClose={onClose}
            onCompleted={onCompleted}
            onReloadLatest={handleReloadLatest}
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

function ConcludeFormBody({
  intervention,
  csrfToken,
  reloading,
  reloadError,
  reloadNotice,
  onClearReloadState,
  onReloadLatest,
  onSavingChange,
  onClose,
  onCompleted,
}: Omit<GeoInterventionConcludeDialogProps, 'finalFocus'> & {
  reloading: boolean;
  reloadError: string | null;
  reloadNotice: string | null;
  onClearReloadState: () => void;
  onReloadLatest: () => Promise<boolean>;
  onSavingChange: (saving: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [verdict, setVerdict] = useState<GeoInterventionOutcomeVerdict>('PARTIAL_IMPROVEMENT');
  const [decisionId, setDecisionId] = useState(intervention.decision_id ?? '');
  const [conclusionNote, setConclusionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);

  const evidenceQuery = useQuery(
    geoInterventionEvidenceChoicesQueryOptions(intervention.opportunity_id, true),
  );

  const concludeMutation = useMutation({
    mutationFn: (note: string) =>
      concludeGeoIntervention(
        intervention.id,
        {
          outcome_verdict: verdict,
          conclusion_note: note,
          decision_id: decisionId || null,
          expected_revision: intervention.revision,
        },
        csrfToken,
      ),
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current || reloading) return;
    onClearReloadState();

    const trimmed = conclusionNote.trim();
    if (!trimmed || charLength(trimmed) > 2000) {
      setFormError('结案说明不能为空且不能超过 2000 个字符');
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
      const updated = await concludeMutation.mutateAsync(trimmed);
      if (!continuation.isCurrent()) return;
      await invalidateGeoInterventionQueries(queryClient, {
        campaignIds: [updated.campaign_id],
        opportunityId: updated.opportunity_id,
        interventionId: updated.id,
      });
      if (!continuation.isCurrent()) return;
      onCompleted?.(updated);
      onClose();
    } catch (err) {
      if (continuation && !continuation.isCurrent()) return;
      setStaleConflict(isGeoInterventionStaleConflict(err));
      setFormError(err instanceof Error ? err.message : '结案 GEO 干预失败');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      onSavingChange(false);
    }
  }

  const decisions = evidenceQuery.data?.decisions ?? [];
  const currentDecisionMissing = Boolean(
    decisionId && !decisions.some((d) => d.id === decisionId),
  );
  const busy = submitting || reloading;
  const attr = intervention.attribution;

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
      <div className="space-y-1 rounded-lg border border-border-subtle bg-surface-subtle/40 p-3 text-xs">
        <p className="font-medium text-text-primary">{intervention.title}</p>
        <p className="text-text-muted">
          基线样本 {attr.baseline_completed_run_count}/{attr.baseline_sample_count}
          {' · '}复测样本 {attr.retest_completed_run_count}/{attr.retest_sample_count}
          {' · '}缺失率 {formatRatePercent(attr.missing_data_rate)}
          {' · '}可比性：
          {attr.comparable === true ? '可比' : attr.comparable === false ? '不可比' : '待复测对比'}
        </p>
      </div>

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
          {staleConflict && (
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

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-conclude-verdict">
          归因判定结论 *
        </label>
        <select
          className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
          disabled={busy}
          id="geo-conclude-verdict"
          onChange={(e) => setVerdict(e.target.value as GeoInterventionOutcomeVerdict)}
          value={verdict}
        >
          {geoInterventionVerdictValues.map((code) => (
            <option key={code} value={code}>
              {geoInterventionVerdictRegistry[code].label}（{code}）
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-conclude-decision">
          关联机会处理结论（可选）
        </label>
        <select
          className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
          disabled={busy || evidenceQuery.isPending}
          id="geo-conclude-decision"
          onChange={(e) => setDecisionId(e.target.value)}
          value={decisionId}
        >
          <option value="">
            {evidenceQuery.isPending
              ? '正在加载处理结论…'
              : intervention.decision_id
                ? '保留当前已绑定结论'
                : '不绑定处理结论'}
          </option>
          {currentDecisionMissing && (
            <option value={decisionId}>已绑定结论 {decisionId.slice(0, 8)}</option>
          )}
          {decisions.map((dec) => (
            <option key={dec.id} value={dec.id}>
              {decisionKindLabels[dec.decision]} · {dec.reason_code}（
              {formatShortDateTime(dec.created_at)}）
            </option>
          ))}
        </select>
        {evidenceQuery.isError && (
          <div
            className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px]"
            role="alert"
          >
            <span>
              {evidenceQuery.error instanceof Error
                ? evidenceQuery.error.message
                : '加载处理结论失败'}
            </span>
            <Button
              onClick={() => void evidenceQuery.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              重试
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-conclude-note">
          结案说明与复盘依据 *（1–2000 字）
        </label>
        <Textarea
          disabled={busy}
          id="geo-conclude-note"
          maxLength={2000}
          onChange={(e) => setConclusionNote(e.target.value)}
          placeholder="记录复测窗口指标变化、样本可比性说明与下一步运营建议"
          rows={4}
          value={conclusionNote}
        />
      </div>

      <p className="text-xs text-text-muted">当前乐观锁版本：r{intervention.revision}</p>

      <DialogFooter>
        <Button disabled={busy} onClick={onClose} type="button" variant="outline">
          返回
        </Button>
        <Button disabled={busy} type="submit">
          {submitting ? '结案中…' : '确认结案并冻结'}
        </Button>
      </DialogFooter>
    </form>
  );
}
