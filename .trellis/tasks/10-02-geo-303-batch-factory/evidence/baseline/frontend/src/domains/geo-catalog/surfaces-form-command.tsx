import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { ErrorSummary } from '@/design-system/forms/form-layout';
import { Button } from '@/design-system/primitives/button';
import { CatalogNotice } from './catalog-controls';
import { SurfacesRequestError, surfacesErrorMessage } from './surfaces-error';

// 草稿基线只接受保存或显式读取，普通 Query 更新不能替换正在编辑的输入。
function useSurfacesFormCommand<T extends FieldValues, R>(form: UseFormReturn<T>, initial: R | undefined, keyFor: (resource: R) => QueryKey, onSaved: (resource: R) => void) {
  const client = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({ retry: false, mutationFn: async ({ execute, continuation }: { execute: () => Promise<R>; continuation: PrincipalContinuation }) => {
    if (baseline) await client.cancelQueries({ queryKey: keyFor(baseline) });
    continuation.assertCurrent();
    return execute();
  } });
  async function save(execute: () => Promise<R>, reset: (canonical: R) => void) {
    if (inFlight.current || conflict) return;
    inFlight.current = true;
    let continuation: PrincipalContinuation | undefined;
    setError(undefined); form.clearErrors();
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await mutation.mutateAsync({ execute, continuation });
      if (!continuation.isCurrent() || !mounted.current) return;
      await client.cancelQueries({ queryKey: keyFor(canonical) });
      if (!continuation.isCurrent() || !mounted.current) return;
      client.setQueryData(keyFor(canonical), canonical);
      setBaseline(canonical); reset(canonical); onSaved(canonical);
    } catch (failure) {
      if ((continuation && !continuation.isCurrent()) || !mounted.current) return;
      setError(failure);
      setConflict(Boolean(baseline && failure instanceof SurfacesRequestError && failure.status === 409));
      if (failure instanceof SurfacesRequestError) {
        const errors = failure.detail?.details.errors;
        if (Array.isArray(errors)) for (const issue of errors) {
          if (!issue || typeof issue !== 'object' || !('loc' in issue) || !Array.isArray(issue.loc) || !('msg' in issue) || typeof issue.msg !== 'string') continue;
          const field = issue.loc.at(-1);
          if (issue.loc[0] === 'body' && typeof field === 'string' && field in form.getValues()) form.setError(field as Path<T>, { type: 'server', message: issue.msg });
        }
      }
    } finally { inFlight.current = false; }
  }
  async function reload(read: () => Promise<R>) {
    if (refreshing || inFlight.current) return;
    let continuation: PrincipalContinuation | undefined;
    setRefreshing(true);
    try {
      continuation = capturePrincipalContinuation(client);
      const canonical = await read();
      if (!continuation.isCurrent() || !mounted.current) return;
      setBaseline(canonical); setConflict(false); setError(undefined); form.clearErrors();
    } catch (failure) { if ((!continuation || continuation.isCurrent()) && mounted.current) setError(failure); }
    finally { if ((!continuation || continuation.isCurrent()) && mounted.current) setRefreshing(false); }
  }
  return { baseline, error, conflict, refreshing, pending: mutation.isPending, save, reload };
}
function SurfacesFormFeedback({ error, conflict, refreshing, onReload, fields, revision, name }: {
  error: unknown; conflict: boolean; refreshing: boolean; onReload?: () => void; fields: FieldValues; revision?: number; name?: string;
}) {
  const errors = Object.entries(fields).flatMap(([id, issue]) => issue && typeof issue === 'object' && 'message' in issue && typeof issue.message === 'string' ? [{ id, message: issue.message, fieldId: `surfaces-${id}` }] : []);
  return <>
    <ErrorSummary errors={errors} />
    {Boolean(error) && <CatalogNotice error>{surfacesErrorMessage(error)}</CatalogNotice>}
    {conflict && <CatalogNotice><p>配置已变化。本地输入已保留，请读取最新配置并核对后再次提交。</p>{onReload && <Button disabled={refreshing} onClick={onReload} type="button" variant="outline">{refreshing ? '读取中…' : '加载最新版本并保留输入'}</Button>}</CatalogNotice>}
    {revision !== undefined && <p className="break-words text-sm text-text-muted">表单基线 Revision {revision} · 服务端名称：{name}</p>}
  </>;
}
export { useSurfacesFormCommand, SurfacesFormFeedback };
