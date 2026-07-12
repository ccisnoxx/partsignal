/** 管理员配置平台类型、Prompt、具体平台规则与 OpenAI-compatible 渠道。 */
import { Tabs, Typography } from 'antd';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AuditPanel, PlatformsPanel } from '../settings/SettingsPage';
import { AIChannelsPanel } from './AIChannelsPanel';
import { PlatformTypesPanel } from './PlatformTypesPanel';

export function ConfigurationPage() {
  const auth = useAuth();
  if (!auth.isAdmin) return <Navigate to="/" replace />;
  return <div className="page-stack"><header className="page-heading"><div><Typography.Text className="eyebrow">MODEL GOVERNANCE</Typography.Text><Typography.Title>配置中心</Typography.Title><Typography.Paragraph>渠道凭据永不回显；Prompt 和模型参数变更只影响后续作业。</Typography.Paragraph></div></header><Tabs items={[{ key: 'ai', label: 'AI 渠道与模型', children: <AIChannelsPanel /> }, { key: 'types', label: '平台类型与 Prompt', children: <PlatformTypesPanel /> }, { key: 'profiles', label: '具体平台规则', children: <PlatformsPanel /> }, { key: 'audit', label: '审计日志', children: <AuditPanel /> }]} /></div>;
}
