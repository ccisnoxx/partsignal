import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { capturePrincipalContinuation } from '@/app/auth/principal-epoch';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import type { components } from '@/shared/api/generated/schema';
import { runPublicationPreRegisterCheck } from './publication.api';

type PreRegisterCheckOut = components['schemas']['PublicationPreRegisterCheckOut'];

type PreRegisterCheckPanelProps = {
  workId: string;
  csrfToken: string | null;
  disabled?: boolean;
  contextSignature?: string;
  getValues: () => { actualTitle: string; finalUrl: string; publishedAt: string; comment: string };
};

function PreRegisterCheckPanel(props: PreRegisterCheckPanelProps) {
  const instanceKey = `${props.workId}:${props.contextSignature ?? ''}:${props.disabled ? '1' : '0'}`;
  return <PreRegisterCheckPanelInner key={instanceKey} {...props} />;
}

function PreRegisterCheckPanelInner({
  workId,
  csrfToken,
  disabled,
  getValues,
}: PreRegisterCheckPanelProps) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<PreRegisterCheckOut>();
  const [error, setError] = useState<string>();
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleCheck() {
    if (submittingRef.current || disabled) return;
    submittingRef.current = true;
    setChecking(true);
    setError(undefined);
    let continuation: ReturnType<typeof capturePrincipalContinuation> | undefined;
    try {
      continuation = capturePrincipalContinuation(queryClient);
      const values = getValues();
      let publishedAtIso: string | null = null;
      if (values.publishedAt.trim()) {
        const parsed = new Date(values.publishedAt);
        if (!Number.isNaN(parsed.getTime())) {
          publishedAtIso = parsed.toISOString();
        }
      }
      const next = await runPublicationPreRegisterCheck(
        workId,
        {
          actual_title: values.actualTitle,
          final_url: values.finalUrl,
          published_at: publishedAtIso,
          comment: values.comment,
        },
        csrfToken,
      );
      if (!mountedRef.current || !continuation.isCurrent()) return;
      setReport(next);
    } catch (caught) {
      if (!mountedRef.current || (continuation && !continuation.isCurrent())) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current && (!continuation || continuation.isCurrent())) {
        submittingRef.current = false;
        setChecking(false);
      }
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-raised p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-text-primary">发布前 8 项合规与完整性检查</p>
        <Button
          disabled={disabled || checking}
          onClick={() => void handleCheck()}
          size="sm"
          type="button"
          variant="outline"
        >
          {checking ? '检查中…' : '执行发布前检查'}
        </Button>
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {report && (
        <div className="space-y-2 pt-1">
          <p className="font-medium text-text-secondary">
            {report.can_register
              ? `检查通过，可登记发布结果（警告 ${report.warning_count} 项）`
              : `存在 ${report.blocking_count} 项阻断问题，请修复后再登记`}
          </p>
          <ul className="space-y-1">
            {report.checks.map((item) => (
              <li className="flex items-start justify-between gap-2 rounded border border-border-subtle bg-surface-panel p-2" key={item.code}>
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{item.label}</p>
                  <p className="text-text-secondary">{item.detail}</p>
                </div>
                <Badge
                  variant={
                    item.status === 'BLOCKING'
                      ? 'destructive'
                      : item.status === 'WARNING'
                        ? 'warning'
                        : 'success'
                  }
                >
                  {item.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { PreRegisterCheckPanel, runPublicationPreRegisterCheck };
