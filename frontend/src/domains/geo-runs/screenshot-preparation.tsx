import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { capturePrincipalContinuation, type PrincipalContinuation } from '@/app/auth/principal-epoch';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { screenshotIssue } from './manual.model';
import { composeScreenshots } from './screenshot-composition';

type Item = { id: string; file: File; url: string };
type Selection = { items: Item[]; owner: PrincipalContinuation };
type Props = {
  disabled: boolean;
  locked: boolean;
  inputId?: string;
  describedBy?: string;
  invalid?: boolean;
  onUpload: (file: File) => void;
  onBlockingChange: (blocking: boolean) => void;
};

function ScreenshotPreparation({ disabled, locked, inputId, describedBy, invalid, onUpload, onBlockingChange }: Props) {
  const client = useQueryClient();
  const [selection, setSelection] = useState<Selection>();
  const [output, setOutput] = useState<{ file: File; url: string }>();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState('');
  const urls = useRef(new Set<string>());
  const operation = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    const resources = urls.current;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      resources.forEach((url) => URL.revokeObjectURL(url));
      resources.clear();
    };
  }, []);
  useEffect(() => onBlockingChange(Boolean(selection)), [selection, onBlockingChange]);
  const frozen = disabled || locked || composing;

  function release(url: string) {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }
  function invalidateOutput() {
    if (output) release(output.url);
    setOutput(undefined);
  }
  function select(files: File[]) {
    if (frozen || !files.length) return;
    const issue = files.map((file) => ({ file, issue: screenshotIssue(file) })).find((item) => item.issue);
    if (issue) {
      setError(`${issue.file.name}：${issue.issue}`);
      return;
    }
    setError('');
    if (!selection && files.length === 1) {
      onUpload(files[0]!);
      return;
    }
    const added: Item[] = [];
    try {
      const owner = selection?.owner ?? capturePrincipalContinuation(client);
      owner.assertCurrent();
      for (const file of files) {
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        added.push({ id: crypto.randomUUID(), file, url });
      }
      invalidateOutput();
      setSelection({ items: [...(selection?.items ?? []), ...added], owner });
    } catch (reason) {
      added.forEach((item) => release(item.url));
      setError(message(reason));
    }
  }
  function update(current: Selection, items: Item[]) {
    invalidateOutput();
    setError('');
    setSelection(items.length ? { ...current, items } : undefined);
  }
  function move(current: Selection, index: number, delta: number) {
    const items = [...current.items];
    [items[index], items[index + delta]] = [items[index + delta]!, items[index]!];
    update(current, items);
  }
  async function compose(current: Selection) {
    const controller = new AbortController();
    operation.current = controller;
    setComposing(true);
    setError('');
    invalidateOutput();
    try {
      current.owner.assertCurrent();
      const file = await composeScreenshots(current.items.map((item) => item.file), controller.signal);
      if (!mounted.current) return;
      current.owner.assertCurrent();
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      setOutput({ file, url });
    } catch (reason) {
      if (mounted.current) setError(controller.signal.aborted ? '已取消合成，本地截图和顺序已保留' : message(reason));
    } finally {
      operation.current = undefined;
      if (mounted.current) setComposing(false);
    }
  }
  function upload(file: File, owner: PrincipalContinuation) {
    try {
      owner.assertCurrent();
      onUpload(file);
    } catch (reason) {
      setError(message(reason));
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-text-secondary">
        单张截图直接上传；多张先在本地排序、合成预览，确认后上传一张 PNG。原图不修改，整理内容刷新或离开后不保留。
      </p>
      <Input
        accept="image/png,image/jpeg,image/webp"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label="上传人工采集截图"
        disabled={frozen}
        id={inputId}
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          select(files);
        }}
        ref={picker}
        type="file"
      />
      {selection && (
        <section aria-label="本地截图整理，尚未上传" className="min-w-0 space-y-3">
          <h4 className="font-medium">本地截图顺序 · {selection.items.length} 张</h4>
          <p className="text-sm text-text-secondary">按下列顺序自上而下原像素拼接，不缩放或裁剪。宽度不同的部分留空；合成结果仍须不超过 10 MiB。</p>
          <ol className="space-y-3">
            {selection.items.map((item, index) => (
              <li className="min-w-0 space-y-2 border-b border-border-subtle pb-3" key={item.id}>
                <p className="break-all text-sm">截图 {index + 1}：{item.file.name}</p>
                <img alt={`本地截图 ${index + 1}：${item.file.name}`} className="max-h-64 max-w-full object-contain" src={item.url} />
                <div className="flex flex-wrap gap-2">
                  <Button aria-label={`上移截图 ${index + 1}`} className="min-h-11 sm:min-h-8" disabled={frozen || index === 0} onClick={() => move(selection, index, -1)} type="button" variant="outline">上移</Button>
                  <Button aria-label={`下移截图 ${index + 1}`} className="min-h-11 sm:min-h-8" disabled={frozen || index === selection.items.length - 1} onClick={() => move(selection, index, 1)} type="button" variant="outline">下移</Button>
                  <Button aria-label={`移除截图 ${index + 1}`} className="min-h-11 sm:min-h-8" disabled={locked || composing} onClick={() => {
                    release(item.url);
                    update(selection, selection.items.filter((entry) => entry.id !== item.id));
                    picker.current?.focus();
                  }} type="button" variant="outline">移除</Button>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {selection.items.length > 1 && <Button className="min-h-11 sm:min-h-8" disabled={frozen} onClick={() => void compose(selection)} type="button" variant="outline">合成并预览截图</Button>}
            {selection.items.length === 1 && <Button className="min-h-11 sm:min-h-8" disabled={frozen} onClick={() => upload(selection.items[0]!.file, selection.owner)} type="button" variant="outline">上传所选截图</Button>}
            <Button className="min-h-11 sm:min-h-8" disabled={locked || composing} onClick={() => {
              selection.items.forEach((item) => release(item.url));
              update(selection, []);
              picker.current?.focus();
            }} type="button" variant="outline">放弃本地截图整理</Button>
            {composing && <Button className="min-h-11 sm:min-h-8" onClick={() => operation.current?.abort()} type="button" variant="outline">取消合成</Button>}
          </div>
          {composing && <p role="status">正在合成截图…</p>}
          {output && (
            <section aria-label="合成截图预览，尚未上传" className="min-w-0 space-y-2">
              <p className="text-sm" role="status">合成完成 · PNG · {(output.file.size / 1024 / 1024).toFixed(2)} MiB，请检查完整性和敏感信息后上传。</p>
              <img alt="按当前顺序合成的完整截图" className="max-h-[36rem] max-w-full object-contain" src={output.url} />
              <a className="block text-sm text-interaction-primary underline" href={output.url} rel="noopener noreferrer" target="_blank">查看原尺寸合成图</a>
              <Button className="min-h-11 sm:min-h-8" disabled={frozen} onClick={() => upload(output.file, selection.owner)} type="button" variant="outline">上传合成截图</Button>
            </section>
          )}
        </section>
      )}
      {error && <p className="break-words text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : '截图整理失败，请核对后重试';
}

export { ScreenshotPreparation };
