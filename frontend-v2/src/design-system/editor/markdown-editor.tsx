import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { basicSetup, EditorView } from 'codemirror';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

import { Button } from '@/design-system/primitives/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs';
import { cn } from '@/shared/lib/utils';

const previewPlugins = [rehypeSanitize];
const blockedPreviewElements = ['img'] as const;

type MarkdownPreviewProps = {
  value: string;
  className?: string;
  ariaLabel?: string;
};

function MarkdownPreview({ ariaLabel = 'Markdown 预览', className, value }: MarkdownPreviewProps) {
  return (
    <article
      aria-label={ariaLabel}
      className={cn(
        'max-h-[36rem] min-h-72 min-w-0 overflow-auto p-4 text-sm leading-6 text-text-primary',
        'focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
      tabIndex={0}
    >
      <ReactMarkdown
        components={{
          a: ({ children, href, title }) => <a className="text-primary underline underline-offset-2" href={href} title={title}>{children}</a>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-border-strong pl-3 text-text-secondary">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.8125rem]">{children}</code>,
          h1: ({ children }) => <h1 className="mt-5 mb-3 text-2xl font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-5 mb-2 text-xl font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h3>,
          li: ({ children }) => <li className="ml-5">{children}</li>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1">{children}</ol>,
          p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
          pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-surface-raised p-3 font-mono text-[0.8125rem]">{children}</pre>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1">{children}</ul>,
        }}
        disallowedElements={blockedPreviewElements}
        rehypePlugins={previewPlugins}
        skipHtml
      >
        {value}
      </ReactMarkdown>
    </article>
  );
}

type CodeMirrorSurfaceProps = {
  ariaLabel: string;
  onChange?: (value: string) => void;
  readOnly: boolean;
  value: string;
};

function CodeMirrorSurface({ ariaLabel, onChange, readOnly, value }: CodeMirrorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const syncingRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      doc: valueRef.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { minHeight: '18rem', fontSize: '0.8125rem' },
          '.cm-content': { minHeight: '18rem', padding: '0.75rem 0' },
          '.cm-scroller': { maxHeight: '36rem', overflow: 'auto' },
          '.cm-gutters': { backgroundColor: 'var(--surface-raised)', color: 'var(--text-secondary)' },
          '&.cm-focused': { outline: 'var(--focus-ring-width) solid var(--border-focus)', outlineOffset: '-3px' },
        }),
      ],
      parent: hostRef.current,
    });
    view.scrollDOM.tabIndex = 0;
    view.scrollDOM.setAttribute('aria-label', `${ariaLabel}滚动区域`);
    const focusEditor = (event: FocusEvent) => {
      if (event.target === view.scrollDOM) view.focus();
    };
    view.scrollDOM.addEventListener('focus', focusEditor);
    viewRef.current = view;
    return () => {
      view.scrollDOM.removeEventListener('focus', focusEditor);
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
  }, [value]);

  return <div className="overflow-hidden rounded-b-lg bg-surface-panel [&_.cm-editor]:min-w-0" ref={hostRef} />;
}

type MarkdownEditorMode = 'edit' | 'preview';

type MarkdownEditorConflict = {
  message: string;
  onReload: () => void;
};

type MarkdownEditorBaseProps = {
  value: string;
  ariaLabel: string;
  conflict?: MarkdownEditorConflict;
  defaultMode?: MarkdownEditorMode;
  className?: string;
};

type MarkdownEditorProps = MarkdownEditorBaseProps & (
  | {
      onChange: (value: string) => void;
      readOnly?: false;
      dirty?: boolean;
      revision?: number;
    }
  | {
      onChange?: never;
      readOnly: true;
      dirty?: false;
      revision?: number;
    }
);

function MarkdownEditor({
  ariaLabel,
  className,
  conflict,
  defaultMode = 'edit',
  dirty = false,
  onChange,
  readOnly = false,
  revision,
  value,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownEditorMode>(defaultMode);
  const previewValue = useDeferredValue(value);
  const characters = [...value].length;
  const lines = value.split('\n').length;

  return (
    <section aria-label={ariaLabel} className={cn('min-w-0 overflow-hidden rounded-xl border border-border-default bg-surface-panel', className)}>
      {conflict && (
        <div className="flex flex-col gap-3 border-b border-danger/30 bg-danger/5 p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div>
            <p className="font-medium text-danger">检测到 revision 冲突</p>
            <p className="mt-1 text-sm text-text-secondary">{conflict.message}</p>
          </div>
          <Button onClick={conflict.onReload} type="button" variant="outline">重新加载最新版本</Button>
        </div>
      )}
      <Tabs
        onValueChange={(value) => {
          if (value === 'edit' || value === 'preview') setMode(value);
        }}
        value={mode}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-raised px-3 py-2">
          <TabsList aria-label="编辑模式" variant="line">
            <TabsTrigger className="text-text-secondary" value="edit">编辑</TabsTrigger>
            <TabsTrigger className="text-text-secondary" value="preview">预览</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            {readOnly && <span className="rounded-full border border-border-default px-2 py-0.5">只读快照</span>}
            {!readOnly && dirty && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-text-primary">未保存</span>}
            {revision !== undefined && <span>Revision {revision}</span>}
            <span>{characters} 字符 · {lines} 行</span>
          </div>
        </div>
        <TabsContent className="mt-0" value="edit">
          <CodeMirrorSurface ariaLabel={ariaLabel} onChange={onChange} readOnly={readOnly} value={value} />
        </TabsContent>
        <TabsContent className="mt-0" value="preview">
          <MarkdownPreview value={previewValue} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

export { MarkdownEditor, MarkdownPreview };
export type { MarkdownEditorConflict, MarkdownEditorMode, MarkdownEditorProps, MarkdownPreviewProps };
