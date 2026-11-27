import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type RefObject } from 'react';

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
import { Input } from '@/design-system/primitives/input';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/schema';

type PlatformHealthSettings = components['schemas']['PlatformHealthCheckSettingsOut'];
type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

const positiveIntPattern = /^\d+$/;

function extractApiError(action: string, status: number, rawError: unknown): string {
  const envelope = rawError as ErrorEnvelope | undefined;
  if (envelope?.error?.message) {
    const reqId = envelope.error.request_id;
    return reqId ? `${envelope.error.message}（请求 ID：${reqId}）` : envelope.error.message;
  }
  return `${action}失败（HTTP ${status}）`;
}

function platformHealthCheckSettingsQueryOptions(platformId: string) {
  return queryOptions({
    queryKey: ['configuration', 'platforms', 'health-check-settings', platformId] as const,
    retry: false,
    queryFn: async () => {
      const result = await api.GET(
        '/api/v1/platform-profiles/{platform_profile_id}/health-check-settings',
        { params: { path: { platform_profile_id: platformId } } },
      );
      if (result.data) return result.data;
      throw new Error(extractApiError('读取公开页面健康检查配置', result.response.status, result.error));
    },
  });
}

function PlatformHealthCheckSettingsButton({
  platformId,
  canEdit,
  csrfToken,
  onSaved,
}: {
  platformId: string;
  canEdit: boolean;
  csrfToken: string | null;
  onSaved?: () => Promise<unknown>;
}) {
  const [openedForPlatformId, setOpenedForPlatformId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isOpen = openedForPlatformId === platformId;

  return (
    <>
      <Button
        onClick={() => setOpenedForPlatformId(platformId)}
        ref={triggerRef}
        size="sm"
        type="button"
        variant="outline"
      >
        公开页健康检查配置
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (!next && !busy) setOpenedForPlatformId(null);
        }}
        open={isOpen}
      >
        {isOpen && (
          <PlatformHealthCheckDialogBody
            busy={busy}
            canEdit={canEdit}
            csrfToken={csrfToken}
            key={platformId}
            onBusyChange={setBusy}
            onClose={() => setOpenedForPlatformId(null)}
            onSaved={onSaved}
            platformId={platformId}
            triggerRef={triggerRef}
          />
        )}
      </Dialog>
    </>
  );
}

function PlatformHealthCheckDialogBody({
  platformId,
  canEdit,
  csrfToken,
  busy,
  onBusyChange,
  onClose,
  onSaved,
  triggerRef,
}: {
  platformId: string;
  canEdit: boolean;
  csrfToken: string | null;
  busy: boolean;
  onBusyChange: (nextBusy: boolean) => void;
  onClose: () => void;
  onSaved?: () => Promise<unknown>;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const query = useQuery(platformHealthCheckSettingsQueryOptions(platformId));
  const [notice, setNotice] = useState<string>();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [reloading, setReloading] = useState(false);

  async function handleReload() {
    setReloading(true);
    setNotice(undefined);
    try {
      const refreshed = await query.refetch();
      if (!refreshed.isError) {
        setReloadNonce((prev) => prev + 1);
      }
    } finally {
      setReloading(false);
    }
  }

  return (
    <DialogContent
      className="sm:max-w-lg"
      finalFocus={triggerRef}
      showCloseButton={!busy && !reloading}
    >
      <DialogHeader>
        <DialogTitle>公开页面健康检查策略</DialogTitle>
        <DialogDescription>
          仅执行无登录态公开页只读核查。抓取受阻（401/403/429/5xx/WAF/超时）仅做告警，绝不自动建单；仅连续确认异常达到阈值时自动登记发布后内容问题。
        </DialogDescription>
      </DialogHeader>

      {notice && (
        <p className="rounded-lg border border-border-subtle bg-surface-raised p-2.5 text-xs text-text-primary" role="status">
          {notice}
        </p>
      )}

      {query.isPending ? (
        <p className="text-sm text-text-secondary" aria-busy="true">正在读取平台健康检查配置…</p>
      ) : query.isError || !query.data ? (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
          <p>{query.error instanceof Error ? query.error.message : '读取配置失败'}</p>
          <Button disabled={reloading} onClick={() => void handleReload()} size="sm" type="button" variant="outline">
            {reloading ? '重试中…' : '重试'}
          </Button>
        </div>
      ) : (
        <PlatformHealthCheckForm
          canEdit={canEdit}
          csrfToken={csrfToken}
          key={`${platformId}:${reloadNonce}`}
          onBusyChange={onBusyChange}
          onClose={onClose}
          onNotice={setNotice}
          onReload={handleReload}
          onSaved={onSaved}
          reloading={reloading}
          settings={query.data}
        />
      )}
    </DialogContent>
  );
}

function PlatformHealthCheckForm({
  settings,
  canEdit,
  csrfToken,
  reloading,
  onBusyChange,
  onClose,
  onNotice,
  onReload,
  onSaved,
}: {
  settings: PlatformHealthSettings;
  canEdit: boolean;
  csrfToken: string | null;
  reloading: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onNotice: (message: string | undefined) => void;
  onReload: () => Promise<void>;
  onSaved?: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(settings.health_check_enabled);
  const [intervalHours, setIntervalHours] = useState(String(settings.health_check_interval_hours));
  const [threshold, setThreshold] = useState(String(settings.health_check_anomaly_threshold));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; canReload: boolean }>();
  const submittingRef = useRef(false);

  async function handleSave() {
    if (!canEdit || submittingRef.current || reloading) return;
    const intervalRaw = intervalHours.trim();
    const thresholdRaw = threshold.trim();
    if (!positiveIntPattern.test(intervalRaw)) {
      setError({ message: '巡检周期必须为 1–720 小时之间的整数。', canReload: false });
      return;
    }
    const parsedInterval = Number(intervalRaw);
    if (!Number.isSafeInteger(parsedInterval) || parsedInterval < 1 || parsedInterval > 720) {
      setError({ message: '巡检周期必须为 1–720 小时之间的整数。', canReload: false });
      return;
    }
    if (!positiveIntPattern.test(thresholdRaw)) {
      setError({ message: '连续确认异常自动建单阈值必须为 1–10 之间的整数。', canReload: false });
      return;
    }
    const parsedThreshold = Number(thresholdRaw);
    if (!Number.isSafeInteger(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > 10) {
      setError({ message: '连续确认异常自动建单阈值必须为 1–10 之间的整数。', canReload: false });
      return;
    }
    if (!csrfToken) {
      setError({ message: '缺少会话 CSRF Token，请刷新页面后重试。', canReload: false });
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    onBusyChange(true);
    setError(undefined);
    onNotice(undefined);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      const result = await api.PATCH(
        '/api/v1/platform-profiles/{platform_profile_id}/health-check-settings',
        {
          body: {
            health_check_enabled: enabled,
            health_check_interval_hours: parsedInterval,
            health_check_anomaly_threshold: parsedThreshold,
            expected_revision: settings.revision,
          },
          params: {
            path: { platform_profile_id: settings.platform_profile_id },
            header: { 'X-CSRF-Token': csrfToken },
          },
        },
      );
      if (!continuation.isCurrent()) return;
      if (!result.data) {
        throw new Error(extractApiError('更新公开页面健康检查配置', result.response.status, result.error));
      }
      // 先完成父页面重载再写入缓存并提示成功，避免 onSaved 异常被吞或提前解除防重入保护
      if (onSaved) await onSaved();
      if (!continuation.isCurrent()) return;
      queryClient.setQueryData(
        platformHealthCheckSettingsQueryOptions(settings.platform_profile_id).queryKey,
        result.data,
      );
      onNotice('公开页面健康检查配置已保存。');
    } catch (caught) {
      if (continuation && !continuation.isCurrent()) return;
      setError({
        message: caught instanceof Error ? caught.message : String(caught),
        canReload: true,
      });
    } finally {
      if (!continuation || continuation.isCurrent()) {
        submittingRef.current = false;
        setSaving(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {error && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
          <p>{error.message}</p>
          {error.canReload && (
            <Button disabled={saving || reloading} onClick={() => void onReload()} size="sm" type="button" variant="outline">
              {reloading ? '正在重载…' : '重新加载最新配置'}
            </Button>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 rounded-lg border border-border-subtle p-3">
        <input
          checked={enabled}
          disabled={!canEdit || saving || reloading}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>启用周期性公开页面健康检查（默认关闭）</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-text-secondary">巡检周期（小时，1–720）</span>
          <Input
            disabled={!canEdit || saving || reloading}
            max={720}
            min={1}
            onChange={(event) => setIntervalHours(event.target.value)}
            step={1}
            type="number"
            value={intervalHours}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-text-secondary">连续确认异常建单阈值（1–10 次）</span>
          <Input
            disabled={!canEdit || saving || reloading}
            max={10}
            min={1}
            onChange={(event) => setThreshold(event.target.value)}
            step={1}
            type="number"
            value={threshold}
          />
        </label>
      </div>

      <p className="text-xs text-text-muted">当前修订号：{settings.revision}</p>

      <DialogFooter>
        <Button disabled={saving || reloading} onClick={onClose} type="button" variant="outline">
          关闭
        </Button>
        {canEdit && (
          <Button disabled={saving || reloading} onClick={() => void handleSave()} type="button">
            {saving ? '保存中…' : '保存配置'}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

export { PlatformHealthCheckSettingsButton, platformHealthCheckSettingsQueryOptions };
