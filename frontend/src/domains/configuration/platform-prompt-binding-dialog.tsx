import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/design-system/primitives/select';
import type { components } from '@/shared/api/generated/schema';
import {
  bindPlatformPromptVersion,
  platformPromptBindingQueryOptions,
  promptKeys,
} from './prompt.api';

function PlatformPromptVersionBindButton({
  platformProfileId,
  csrfToken,
  onBound,
}: {
  platformProfileId: string;
  csrfToken: string | null;
  onBound?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        切换 / 回滚 Prompt 版本
      </Button>
      {open && (
        <PlatformPromptVersionBindDialog
          csrfToken={csrfToken}
          onBound={onBound}
          onClose={() => setOpen(false)}
          platformProfileId={platformProfileId}
        />
      )}
    </>
  );
}

function PlatformPromptVersionBindDialog({
  platformProfileId,
  csrfToken,
  onClose,
  onBound,
}: {
  platformProfileId: string;
  csrfToken: string | null;
  onClose: () => void;
  onBound?: () => void;
}) {
  const queryClient = useQueryClient();
  const bindingQuery = useQuery(platformPromptBindingQueryOptions(platformProfileId));
  const [saving, setSaving] = useState(false);

  return (
    <Dialog onOpenChange={(next) => { if (!next && !saving) onClose(); }} open>
      <DialogContent className="sm:max-w-lg" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>切换或回滚 Prompt 版本</DialogTitle>
          <DialogDescription>
            将当前平台显式锁定到任一已发布（PUBLISHED）的不可变 Prompt 版本；出现效果退化时可一键回滚至历史版本。
          </DialogDescription>
        </DialogHeader>

        {bindingQuery.isPending ? (
          <p className="text-sm text-text-secondary" aria-busy="true">正在读取当前版本绑定…</p>
        ) : bindingQuery.isError || !bindingQuery.data ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert">
            <p>{bindingQuery.error instanceof Error ? bindingQuery.error.message : '读取绑定信息失败'}</p>
            <Button onClick={() => void bindingQuery.refetch()} size="sm" type="button" variant="outline">
              重试
            </Button>
          </div>
        ) : (
          <PlatformPromptVersionBindForm
            binding={bindingQuery.data}
            csrfToken={csrfToken}
            key={`${bindingQuery.data.platform_profile_id}:${bindingQuery.data.platform_revision}:${bindingQuery.data.available_versions.map((v) => v.id).join(',')}`}
            onBound={onBound}
            onClose={onClose}
            onRefresh={() => bindingQuery.refetch()}
            onSavingChange={setSaving}
            platformProfileId={platformProfileId}
            queryClient={queryClient}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlatformPromptVersionBindForm({
  binding,
  csrfToken,
  onBound,
  onClose,
  onRefresh,
  onSavingChange,
  platformProfileId,
  queryClient,
}: {
  binding: components['schemas']['PlatformPromptBindingOut'];
  csrfToken: string | null;
  onBound?: () => void;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
  onSavingChange: (saving: boolean) => void;
  platformProfileId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [selectedId, setSelectedId] = useState(binding.bound_version?.id ?? '');
  const [error, setError] = useState<string>();
  const submittingRef = useRef(false);
  const mutation = useMutation({
    mutationFn: () =>
      bindPlatformPromptVersion(
        platformProfileId,
        {
          expected_revision: binding.platform_revision,
          platform_prompt_version_id: selectedId,
        },
        csrfToken,
      ),
  });

  const items = binding.available_versions.map((ver) => ({
    value: ver.id,
    label: `${ver.prompt_name} · v${ver.version}${ver.change_summary ? `（${ver.change_summary}）` : ''}`,
  }));

  async function handleBind() {
    if (submittingRef.current) return;
    if (!selectedId) {
      setError('请选择要绑定的已发布 Prompt 版本');
      return;
    }
    submittingRef.current = true;
    setError(undefined);
    onSavingChange(true);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      await mutation.mutateAsync();
      if (!continuation.isCurrent()) return;
      await queryClient.invalidateQueries({
        queryKey: promptKeys.platformBinding(platformProfileId),
      });
      if (!continuation.isCurrent()) return;
      onBound?.();
      onClose();
    } catch (err) {
      if (continuation && !continuation.isCurrent()) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!continuation || continuation.isCurrent()) {
        submittingRef.current = false;
        onSavingChange(false);
      }
    }
  }

  async function handleRefresh() {
    setError(undefined);
    await onRefresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary">
        当前生效：
        {binding.bound_version
          ? `${binding.bound_version.prompt_name} · v${binding.bound_version.version}`
          : '尚未绑定已发布版本'}
      </p>

      {error && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
          <p>{error}</p>
          <Button onClick={() => void handleRefresh()} size="sm" type="button" variant="outline">
            刷新最新状态
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-text-muted">暂无可供绑定的已发布 Prompt 版本。</p>
      ) : (
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary" htmlFor="platform-bind-pv">
            目标已发布 Prompt 版本
          </label>
          <Select
            disabled={mutation.isPending}
            items={items}
            onValueChange={(next) => next && setSelectedId(next)}
            value={selectedId}
          >
            <SelectTrigger id="platform-bind-pv">
              <SelectValue placeholder="请选择 Prompt 版本" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <DialogFooter>
        <Button disabled={mutation.isPending} onClick={onClose} type="button" variant="outline">
          取消
        </Button>
        {items.length > 0 && (
          <Button disabled={mutation.isPending || !selectedId} onClick={() => void handleBind()} type="button">
            {mutation.isPending ? '绑定中…' : '确认绑定版本'}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

export { PlatformPromptVersionBindButton };
