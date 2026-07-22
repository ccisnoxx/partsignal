/** 复用渠道创建与编辑字段，并保持凭据只存在于创建表单生命周期。 */
import {
  ApiOutlined,
  CloudOutlined,
  CodeOutlined,
  GoogleOutlined,
  OpenAIOutlined,
} from '@ant-design/icons';
import { Alert, Button, Form, Input, InputNumber, Modal, Select } from 'antd';
import type { ReactNode } from 'react';
import { errorMessage } from '../../shared/api/client';
import type { AIChannel, AIChannelSummary, Schema } from '../../shared/api/types';

export type AIChannelFormValues = {
  name: string;
  description: string;
  protocol_type: Schema<'AIProtocolType'>;
  provider_brand: Schema<'AIProviderBrand'>;
  base_url: string;
  timeout_seconds: number;
  api_key?: string;
};

export const providerBrandLabels: Record<Schema<'AIProviderBrand'>, string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  GOOGLE: 'Google',
  AZURE_OPENAI: 'Azure OpenAI',
  ZHIPU: '智谱 AI',
  QWEN: '通义千问',
  CUSTOM: '自定义品牌',
};

const providerBrandIcons: Record<Schema<'AIProviderBrand'>, ReactNode> = {
  OPENAI: <OpenAIOutlined />,
  ANTHROPIC: <span aria-hidden="true">AI</span>,
  GOOGLE: <GoogleOutlined />,
  AZURE_OPENAI: <CloudOutlined />,
  ZHIPU: <span aria-hidden="true">智</span>,
  QWEN: <span aria-hidden="true">千</span>,
  CUSTOM: <ApiOutlined />,
};

export function AIProviderMark({ brand }: { brand: Schema<'AIProviderBrand'> }) {
  return (
    <span className={`ai-provider-mark ai-provider-mark-${brand.toLowerCase()}`} aria-label={providerBrandLabels[brand]}>
      {providerBrandIcons[brand]}
    </span>
  );
}

type EditableChannel = Pick<
  AIChannel | AIChannelSummary,
  'name' | 'description' | 'protocol_type' | 'provider_brand' | 'base_url'
> & { timeout_seconds?: number };

export function AIChannelFormModal({
  open,
  channel,
  loading,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  channel?: EditableChannel;
  loading: boolean;
  error?: unknown;
  onCancel: () => void;
  onSubmit: (values: AIChannelFormValues) => void;
}) {
  const editing = !!channel;
  return (
    <Modal
      title={editing ? '编辑渠道' : '新增渠道'}
      open={open}
      width={560}
      footer={null}
      destroyOnHidden
      onCancel={onCancel}
      className="ai-channel-form-modal"
    >
      {error !== undefined && <Alert role="alert" type="error" showIcon title={errorMessage(error)} />}
      <Form<AIChannelFormValues>
        key={editing ? `${channel.name}-${channel.base_url}` : 'new-channel'}
        layout="vertical"
        initialValues={{
          name: channel?.name,
          description: channel?.description ?? '',
          protocol_type: channel?.protocol_type ?? 'openai-compatible-chat-completions',
          provider_brand: channel?.provider_brand ?? 'CUSTOM',
          base_url: channel?.base_url,
          timeout_seconds: channel?.timeout_seconds ?? 60,
        }}
        onFinish={onSubmit}
      >
        <div className="ai-form-grid">
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, whitespace: true }, { max: 160 }]}>
            <Input autoFocus placeholder="例如：生产 OpenAI" />
          </Form.Item>
          <Form.Item name="provider_brand" label="供应商品牌" rules={[{ required: true }]}>
            <Select
              options={Object.entries(providerBrandLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </div>
        <Form.Item name="description" label="描述" rules={[{ max: 500 }]}>
          <Input.TextArea rows={3} showCount maxLength={500} placeholder="说明渠道用途、环境或负责人" />
        </Form.Item>
        <Form.Item name="protocol_type" label="协议类型" rules={[{ required: true }]}>
          <Select
            suffixIcon={<CodeOutlined />}
            options={[{
              value: 'openai-compatible-chat-completions',
              label: 'OpenAI-compatible Chat Completions',
            }]}
          />
        </Form.Item>
        <Form.Item name="base_url" label="API 根地址" rules={[{ required: true }, { type: 'url' }]}>
          <Input placeholder="https://provider.example/v1" />
        </Form.Item>
        {!editing && (
          <Form.Item name="api_key" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        )}
        <Form.Item name="timeout_seconds" label="超时时间" rules={[{ required: true }]}>
          <InputNumber min={10} max={600} suffix="秒" style={{ width: '100%' }} />
        </Form.Item>
        <div className="ai-modal-actions">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            {editing ? '保存修改' : '创建渠道'}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
