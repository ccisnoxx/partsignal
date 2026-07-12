/** Markdown 修订表单保持唯一正文源，并只负责本地预览展示。 */
import { SaveOutlined } from '@ant-design/icons';
import { Button, Form, Input, Select } from 'antd';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useState } from 'react';
import type { ContentVersion, Schema } from '../../shared/api/types';

export function RevisionForm({
  content,
  loading,
  onSubmit,
}: {
  content: ContentVersion;
  loading: boolean;
  onSubmit: (body: Schema<'ContentRevisionCreate'>) => void;
}) {
  const [markdown, setMarkdown] = useState(content.body_markdown);
  const preview = DOMPurify.sanitize(marked.parse(markdown) as string);
  return (
    <Form<Schema<'ContentRevisionCreate'>>
      layout="vertical"
      initialValues={{
        title: content.title,
        summary: content.summary,
        body_markdown: content.body_markdown,
        tags: content.tags,
      }}
      onFinish={onSubmit}
    >
      <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item name="summary" label="摘要" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
      <Form.Item name="body_markdown" label="Markdown 正文" rules={[{ required: true }]}>
        <Input.TextArea rows={18} className="markdown-source" onChange={(event) => setMarkdown(event.target.value)} />
      </Form.Item>
      <Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item>
      <Form.Item name="change_summary" label="变更说明" rules={[{ required: true }]}><Input /></Form.Item>
      <details>
        <summary>预览本次修订</summary>
        <article className="markdown-preview compact" dangerouslySetInnerHTML={{ __html: preview }} />
      </details>
      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>
        创建新版本
      </Button>
    </Form>
  );
}
