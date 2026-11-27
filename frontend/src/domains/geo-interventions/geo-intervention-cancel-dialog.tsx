import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
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
  cancelGeoIntervention,
  invalidateGeoInterventionQueries,
  isGeoInterventionStaleConflict,
} from './geo-intervention.api';
import {
  charLength,
  geoInterventionStatusRegistry,
  type GeoInterventionOut,
} from './geo-intervention.model';
import { useGeoInterventionReload } from './use-geo-intervention-reload';

type GeoInterventionCancelDialogProps = {
  intervention: GeoInterventionOut;
  csrfToken: string | null;
  finalFocus?: () => HTMLElement | null;
  onClose: () => void;
  onCompleted?: (updated: GeoInterventionOut) => void;
};

export function GeoInterventionCancelDialog({
  intervention,
  csrfToken,
  finalFocus,
  onClose,
  onCompleted,
}: GeoInterventionCancelDialogProps) {
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
  const canCancel = current.available_actions.includes('CANCEL');

  const handleReloadLatest = () =>
    reloadLatest({
      target: current,
      isSubmitting: saving,
      formatNotice: (latest) =>
        `已同步最新版本 r${latest.revision}，已保留取消原因草稿，请核对后重新提交。`,
    });

  return (
    <Dialog onOpenChange={(next) => { if (!next && !saving && !reloading) onClose(); }} open>
      <DialogContent
        className="sm:max-w-lg"
        finalFocus={finalFocus}
        showCloseButton={!saving && !reloading}
      >
        <DialogHeader>
          <DialogTitle>取消 GEO 干预</DialogTitle>
          <DialogDescription>
            取消后该 GEO 干预将进入不可恢复的「已取消」终态，历史记录与取消原因将永久保留以供审计。
          </DialogDescription>
        </DialogHeader>

        {!canCancel ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
              该 GEO 干预最新状态为「{geoInterventionStatusRegistry[current.status].label}」（版本 r
              {current.revision}），当前不可执行取消操作。
            </div>
            <DialogFooter>
              <Button onClick={onClose} type="button" variant="outline">
                关闭
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <CancelFormBody
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

function CancelFormBody({
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
}: Omit<GeoInterventionCancelDialogProps, 'finalFocus'> & {
  reloading: boolean;
  reloadError: string | null;
  reloadNotice: string | null;
  onClearReloadState: () => void;
  onReloadLatest: () => Promise<boolean>;
  onSavingChange: (saving: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: (cleanReason: string) =>
      cancelGeoIntervention(
        intervention.id,
        {
          reason: cleanReason,
          expected_revision: intervention.revision,
        },
        csrfToken,
      ),
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current || reloading) return;
    onClearReloadState();

    const trimmed = reason.trim();
    if (!trimmed || charLength(trimmed) > 500) {
      setFormError('取消原因不能为空且不能超过 500 个字符');
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
      const updated = await cancelMutation.mutateAsync(trimmed);
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
      setFormError(err instanceof Error ? err.message : '取消 GEO 干预失败');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      onSavingChange(false);
    }
  }

  const busy = submitting || reloading;

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
      <p className="text-xs text-text-secondary">
        待取消干预：<strong className="text-text-primary">{intervention.title}</strong>（版本 r
        {intervention.revision}）
      </p>

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
        <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-cancel-reason">
          取消原因 *（1–500 字）
        </label>
        <Textarea
          disabled={busy}
          id="geo-cancel-reason"
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：对应 GEO 机会已合并至其他干预方案"
          rows={3}
          value={reason}
        />
      </div>

      <DialogFooter>
        <Button disabled={busy} onClick={onClose} type="button" variant="outline">
          返回
        </Button>
        <Button disabled={busy} type="submit" variant="destructive">
          {submitting ? '取消中…' : '确认取消干预'}
        </Button>
      </DialogFooter>
    </form>
  );
}
