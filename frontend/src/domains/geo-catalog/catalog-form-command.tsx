import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { CatalogRequestError, catalogKeys } from './catalog.api';
import { type Subject } from './catalog.model';
import { CatalogNotice, catalogErrorMessage } from './catalog-controls';

function useCatalogFormCommand<T extends FieldValues>(form: UseFormReturn<T>, subject: Subject | undefined, onSaved: (subject: Subject) => void) {
  const client = useQueryClient();
  const [baseline, setBaseline] = useState(subject);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ execute, continuation }: { execute: () => Promise<Subject>; continuation: PrincipalContinuation }) => {
      if (baseline) await client.cancelQueries({ queryKey: catalogKeys.detail(baseline.id) });
      continuation.assertCurrent();
      return execute();
    },
  });

  async function save(execute: () => Promise<Subject>, reset: (canonical: Subject) => void) {
    if (inFlight.current || conflict) return;
    let continuation: PrincipalContinuation | undefined;
    inFlight.current = true;
    setError(undefined);
    form.clearErrors();
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ execute, continuation });
      if (!continuation?.isCurrent() || !mounted.current) return;
      // 取消期间网络可能已经完成；提交结果前再次丢弃旧 GET。
      await client.cancelQueries({ queryKey: catalogKeys.detail(canonical.id) });
      if (!continuation?.isCurrent() || !mounted.current) return;
      client.setQueryData(catalogKeys.detail(canonical.id), canonical);
      setBaseline(canonical);
      reset(canonical);
      onSaved(canonical);
    } catch (failure) {
      if (continuation && !continuation.isCurrent() || !mounted.current) return;
      setError(failure);
      setConflict(failure instanceof CatalogRequestError && failure.detail?.code === 'REVISION_CONFLICT');
      if (failure instanceof CatalogRequestError && failure.detail) {
        const issues = failure.detail.details.errors;
        if (Array.isArray(issues)) for (const issue of issues) {
          if (!issue || typeof issue !== 'object' || !('loc' in issue) || !('msg' in issue)) continue;
          const loc = issue.loc;
          if (Array.isArray(loc) && loc.length === 2 && loc[0] === 'body' && typeof loc[1] === 'string' && typeof issue.msg === 'string' && loc[1] in form.getValues()) {
            form.setError(loc[1] as Path<T>, { type: 'server', message: issue.msg });
          }
        }
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function reload(read: () => Promise<Subject>) {
    if (refreshing || inFlight.current) return;
    let continuation: PrincipalContinuation | undefined;
    setRefreshing(true);
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await read();
      if (!continuation.isCurrent() || !mounted.current) return;
      setBaseline(canonical);
      setConflict(false);
      setError(undefined);
      form.clearErrors();
      // 只采用最新 revision，RHF 本地输入保持不变，必须由用户再次提交。
    } catch (failure) {
      if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure);
    } finally {
      if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false);
    }
  }
  return { baseline, error, conflict, refreshing, pending: mutation.isPending, save, reload };
}

function CatalogFormFeedback({ error, conflict, refreshing, onReload, latest, fields }: {
  error: unknown; conflict: boolean; refreshing: boolean; onReload?: () => void;
  latest?: Subject; fields: FieldValues;
}) {
  const errors = Object.entries(fields).flatMap(([id, value]) => value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
    ? [{ id, message: value.message, fieldId: `catalog-${id}` }] : []);
  return <>
    <ErrorSummary errors={errors} />
    {Boolean(error) && <CatalogNotice error>{catalogErrorMessage(error)}</CatalogNotice>}
    {conflict && <CatalogNotice>
      <p>对象已被其他操作更新。本地输入已保留；请读取最新版本并核对后再次提交。</p>
      {onReload && <Button disabled={refreshing} onClick={onReload} type="button" variant="outline">{refreshing ? '读取中…' : '加载最新版本并保留输入'}</Button>}
    </CatalogNotice>}
    {latest && <p className="break-words text-sm text-text-muted">表单基线 Revision {latest.revision} · 基线服务端名称：{latest.display_name} · 监测说明：{latest.description || '未填写'}</p>}
  </>;
}
export { useCatalogFormCommand, CatalogFormFeedback };
