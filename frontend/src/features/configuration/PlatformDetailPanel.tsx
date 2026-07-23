/** 平台管理详情面板只展示服务端聚合事实，并连接既有配置与引用页面。 */
import { CloseOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Tag, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { platformProfileQueryOptions } from '../../shared/api/queryOptions';
import { QueryFailure, QueryLoading } from '../../shared/components/AsyncState';
import { PlatformAvatar } from '../../shared/components/PlatformAvatar';
import { StatusTag } from '../../shared/components/StatusTag';
import { useQuery } from '@tanstack/react-query';
import type { PlatformProfile } from '../../shared/api/types';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function formatDateTime(value: string | null) {
  return value ? dateTimeFormatter.format(new Date(value)) : '暂无记录';
}

export function PlatformDetailPanel({
  platformId,
  onClose,
  onEdit,
  onToggle,
  onDelete,
  toggleLoading,
  deleteLoading,
}: {
  platformId: string;
  onClose: () => void;
  onEdit: (profile: PlatformProfile) => void;
  onToggle: (profile: PlatformProfile) => void;
  onDelete: (profile: PlatformProfile) => void;
  toggleLoading: boolean;
  deleteLoading: boolean;
}) {
  const detail = useQuery(platformProfileQueryOptions(platformId));
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [detail.data, platformId]);

  if (detail.isLoading) return <div className="platform-detail-panel"><QueryLoading label="正在加载平台详情" /></div>;
  if (detail.error || !detail.data) {
    return <div className="platform-detail-panel"><div className="platform-detail-header"><Typography.Title ref={titleRef} tabIndex={-1} level={4}>平台详情</Typography.Title><Button type="text" aria-label="关闭平台详情" icon={<CloseOutlined />} onClick={onClose} /></div><QueryFailure error={detail.error ?? new Error('平台详情不存在')} onRetry={() => void detail.refetch()} /></div>;
  }

  const { profile, account_summary: accounts, reference_summary: references } = detail.data;
  const rulesHref = `/configuration/platform-rules?platform_profile_id=${profile.id}`;
  const promptHref = `/configuration/prompts?platform_profile_id=${profile.id}`;
  const accountsHref = `/settings?tab=accounts&platform_profile_id=${profile.id}`;
  const referencesHref = `/tasks?platform_profile_id=${profile.id}`;

  return <aside className="platform-detail-panel" aria-label={`${profile.name} 平台详情`}>
    <div className="platform-detail-header">
      <Typography.Title ref={titleRef} tabIndex={-1} level={4}>平台详情</Typography.Title>
      <Button type="text" aria-label="关闭平台详情" icon={<CloseOutlined />} onClick={onClose} />
    </div>
    <div className="platform-detail-scroll">
      <div className="platform-detail-identity"><PlatformAvatar name={profile.name} logo={profile.logo} size={32} /><strong>{profile.name}</strong><StatusTag status={profile.is_active ? 'ENABLED' : 'DISABLED'} /></div>

      <section className="platform-detail-section" aria-labelledby="platform-detail-basic">
        <Typography.Title id="platform-detail-basic" level={5}>基本信息</Typography.Title>
        <Descriptions column={1} colon={false} size="small" items={[
          { label: '所属平台类型', children: profile.platform_type?.name ?? '未归类' },
          { label: '官方网站', children: profile.website_url ? <a href={profile.website_url} target="_blank" rel="noreferrer">{profile.website_url}</a> : '—' },
          { label: '允许域名', children: profile.allowed_domains.length ? profile.allowed_domains.join('、') : '—' },
        ]} />
      </section>

      <section className="platform-detail-section" aria-labelledby="platform-detail-rule">
        <Typography.Title id="platform-detail-rule" level={5}>当前规则</Typography.Title>
        <Descriptions column={1} colon={false} size="small" items={[
          { label: '当前规则版本', children: profile.active_version ? `V${profile.active_version.version}` : <Tag color="error">无有效规则</Tag> },
          { label: '发布状态', children: profile.active_version ? <Tag color="success">已发布</Tag> : '—' },
          { label: '最后更新时间', children: formatDateTime(detail.data.current_rule_activated_at) },
        ]} />
        <Link className="platform-detail-link" to={rulesHref}>查看规则详情 <RightOutlined /></Link>
      </section>

      <section className="platform-detail-section" aria-labelledby="platform-detail-prompt">
        <Typography.Title id="platform-detail-prompt" level={5}>Prompt 配置状态</Typography.Title>
        <Descriptions column={1} colon={false} size="small" items={[
          { label: '配置完整性', children: profile.prompt_configured ? <Tag color="success">配置完整</Tag> : <Tag color="warning">缺少 Prompt</Tag> },
          { label: '最后更新时间', children: formatDateTime(detail.data.prompt_updated_at) },
        ]} />
        <Link className="platform-detail-link" to={promptHref}>查看 Prompt 详情 <RightOutlined /></Link>
      </section>

      <section className="platform-detail-section" aria-labelledby="platform-detail-accounts">
        <Typography.Title id="platform-detail-accounts" level={5}>发布账号摘要</Typography.Title>
        <Descriptions column={1} colon={false} size="small" items={[
          { label: '发布账号数量', children: `${accounts.total} 个` },
          { label: '启用账号', children: `${accounts.enabled} 个` },
          { label: '停用账号', children: `${accounts.disabled} 个` },
        ]} />
        <Link className="platform-detail-link" to={accountsHref}>查看账号列表 <RightOutlined /></Link>
      </section>

      <section className="platform-detail-section" aria-labelledby="platform-detail-references">
        <Typography.Title id="platform-detail-references" level={5}>关联引用情况</Typography.Title>
        <Descriptions column={1} colon={false} size="small" items={[
          { label: '被内容引用次数（近 30 天）', children: references.recent_30_days },
          { label: '被内容引用次数（全部）', children: references.all_time },
        ]} />
        <Link className="platform-detail-link" to={referencesHref}>查看引用分析 <RightOutlined /></Link>
      </section>
    </div>
    <div className="platform-detail-footer">
      <div className="platform-detail-actions">
        <Button onClick={() => onEdit(profile)}>编辑平台</Button>
        <Button className="platform-toggle-button" loading={toggleLoading} onClick={() => onToggle(profile)}>{profile.is_active ? '停用平台' : '启用平台'}</Button>
        <Button danger loading={deleteLoading} onClick={() => onDelete(profile)}>删除平台</Button>
      </div>
      <Alert type="warning" showIcon={false} title="存在平台规则版本或发布账号时不能删除平台；如需停止新业务，请停用平台。" />
    </div>
  </aside>;
}
