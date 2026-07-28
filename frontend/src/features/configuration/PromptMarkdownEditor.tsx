/** Prompt Markdown 的唯一正文编辑器，提供行号、草稿统计和显式保存状态。 */
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Popconfirm, Space, Typography } from 'antd';
import { useMemo, useState, type UIEvent } from 'react';

export type PromptSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

const stateLabels: Record<PromptSaveState, string> = {
  idle: '已加载',
  dirty: '未保存修改',
  saving: '保存中',
  saved: '已保存',
  error: '保存失败',
  conflict: '版本冲突',
};

type PromptMarkdownEditorProps = {
  value: string;
  ariaLabel: string;
  configured: boolean;
  disabled?: boolean;
  saveState: PromptSaveState;
  error?: unknown;
  outputLength: string;
  canDelete?: boolean;
  deleting?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDelete?: () => void;
  onReload?: () => void;
};

export function PromptMarkdownEditor({
  value,
  ariaLabel,
  configured,
  disabled,
  saveState,
  error,
  outputLength,
  canDelete,
  deleting,
  onChange,
  onSave,
  onDelete,
  onReload,
}: PromptMarkdownEditorProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = value.split('\n').length;
  const characterCount = useMemo(() => [...value.replace(/\s/gu, '')].length, [value]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'),
    [lineCount],
  );
  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => setScrollTop(event.currentTarget.scrollTop);
  const statusClass = saveState === 'conflict' || saveState === 'error'
    ? 'is-danger'
    : saveState === 'dirty' ? 'is-warning' : saveState === 'saved' ? 'is-success' : '';

  return <section className="prompt-markdown-editor" aria-label="Prompt Markdown 编辑区">
    <header className="prompt-editor-toolbar">
      <Space size={8} wrap>
        <Typography.Text strong>Prompt 编辑</Typography.Text>
        <Typography.Text type="secondary">Markdown</Typography.Text>
        <span className={`prompt-editor-state ${statusClass}`} role="status" aria-live="polite">
          {stateLabels[saveState]}
        </span>
      </Space>
      <Space size={8} wrap>
        {canDelete && onDelete && <Popconfirm
          title="删除当前 Prompt？"
          description="仅未被平台绑定的 Prompt 可以删除；历史生成快照不会被改写。"
          okText="删除 Prompt"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleting }}
          onConfirm={onDelete}
        >
          <Button danger size="small" icon={<DeleteOutlined />} loading={deleting}>删除 Prompt</Button>
        </Popconfirm>}
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          loading={saveState === 'saving'}
          disabled={disabled || saveState !== 'dirty' || !value.trim()}
          onClick={onSave}
        >{configured ? '保存 Prompt' : '首次保存'}</Button>
      </Space>
    </header>
    {(saveState === 'conflict' || saveState === 'error') && <Alert
      role="alert"
      type="error"
      showIcon
      title={saveState === 'conflict' ? '服务端 Prompt 已发生变化，本地草稿未被覆盖。' : error instanceof Error ? error.message : 'Prompt 保存失败'}
      action={onReload && <Button size="small" onClick={onReload}>重新加载当前值</Button>}
    />}
    {!configured && <Alert type="warning" showIcon title="尚未配置 Prompt；首次保存后才可用于新生成作业。" />}
    <div className="prompt-editor-surface">
      <pre className="prompt-editor-lines" aria-hidden="true" style={{ transform: `translateY(${-scrollTop}px)` }}>{lineNumbers}</pre>
      <textarea
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onScroll={handleScroll}
      />
    </div>
    <footer className="prompt-editor-footer">
      <span>字数：{characterCount}</span>
      <span>行数：{lineCount}</span>
      <span>预计输出：{outputLength}</span>
      <span>Markdown</span>
    </footer>
  </section>;
}
