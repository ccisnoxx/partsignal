/** Markdown 修订表单保持唯一正文源，并明确展示未保存、提交中和失败状态。 */
import { SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Select, Space, Tabs, Tag, Typography } from 'antd';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../shared/api/client';
import type { ContentVersion, Schema } from '../../shared/api/types';

type RevisionDraft = Schema<'ContentRevisionCreate'>;

export function RevisionForm({
  content,
  loading,
  error,
  onDirtyChange,
  onSubmit,
}: {
  content: ContentVersion;
  loading: boolean;
  error?: unknown;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (body: RevisionDraft) => void;
}) {
  const initialDraft: RevisionDraft = {
    title: content.title,
    summary: content.summary,
    body_markdown: content.body_markdown,
    tags: content.tags,
    change_summary: '',
  };
  const [draft, setDraft] = useState(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const errorRef = useRef<HTMLDivElement>(null);
  const deferredMarkdown = useDeferredValue(draft.body_markdown);
  // 长正文预览让位于输入更新；解析结果只在 deferred 值变化时重新计算。
  const preview = useMemo(
    () => DOMPurify.sanitize(marked.parse(deferredMarkdown) as string),
    [deferredMarkdown],
  );
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return (
    <Form<RevisionDraft>
      className="revision-form"
      layout="vertical"
      initialValues={initialDraft}
      disabled={loading}
      scrollToFirstError={{ behavior: 'smooth', block: 'center', focus: true }}
      onValuesChange={(_, values) => {
        setDraft(values);
        setDirty(true);
        onDirtyChange(true);
      }}
      onFinish={onSubmit}
    >
      <Alert
        type="info"
        showIcon
        title="人工修订会创建新的不可变内容版本，Markdown 仍是唯一可编辑正文源。"
      />
      <Tabs
        activeKey={view}
        onChange={(key) => setView(key as 'edit' | 'preview')}
        items={[
          { key: 'edit', label: '编辑 Markdown' },
          { key: 'preview', label: '预览修订' },
        ]}
      />
      <div hidden={view !== 'edit'}>
        <div className="revision-metadata-grid">
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: '请输入标题' }]}><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
          <Form.Item className="revision-summary-field" name="summary" label="摘要" rules={[{ required: true, whitespace: true, message: '请输入摘要' }]}><Input.TextArea rows={2} /></Form.Item>
        </div>
        <Form.Item className="revision-editor-field" name="body_markdown" label="Markdown 正文" rules={[{ required: true, whitespace: true, message: '请输入 Markdown 正文' }]}>
          <Input.TextArea rows={22} className="markdown-source revision-markdown-source" />
        </Form.Item>
        <Form.Item name="change_summary" label="变更说明" rules={[{ required: true, whitespace: true, message: '请说明本次修改' }]}>
          <Input placeholder="说明为什么创建这个新版本" />
        </Form.Item>
      </div>
      <section hidden={view !== 'preview'} className="revision-preview" aria-label="人工修订预览">
        <Typography.Title level={3}>{draft.title || '未填写标题'}</Typography.Title>
        <Typography.Paragraph type="secondary">{draft.summary || '未填写摘要'}</Typography.Paragraph>
        <Space wrap>{draft.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>
        <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      </section>
      <div ref={errorRef} tabIndex={-1}>
        {error ? <Alert role="alert" type="error" showIcon title="创建修订失败" description={errorMessage(error)} /> : null}
      </div>
      <div className="form-save-bar revision-save-bar" aria-live="polite">
        <div className="form-save-feedback">
          <Typography.Text strong>{loading ? '正在创建新版本' : error ? '创建失败，修订内容仍保留' : dirty ? '有未保存修改' : '尚未修改'}</Typography.Text>
          <Typography.Text type="secondary">提交成功后将打开新版本，不会修改当前版本。</Typography.Text>
        </div>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading} disabled={!dirty}>
          创建新版本
        </Button>
      </div>
    </Form>
  );
}
