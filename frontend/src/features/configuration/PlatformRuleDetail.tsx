/** 平台规则只读详情与同平台版本字段差异。 */
import {
  ContactsOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  LinkOutlined,
  MessageOutlined,
  MoreOutlined,
  OrderedListOutlined,
  StopOutlined,
  TableOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Modal, Select, Tag, Typography } from 'antd';
import { useMemo, useState, type ReactNode } from 'react';
import type { Schema } from '../../shared/api/types';
import { StatusTag } from '../../shared/components/StatusTag';

export type RuleVersionSummary = Schema<'PlatformProfileVersionSummary'>;
type PlatformRules = Schema<'PlatformRules'>;

type RuleDescriptor = {
  key: string;
  label: string;
  icon: ReactNode;
  text: (rules: PlatformRules) => string;
  content?: (rules: PlatformRules) => ReactNode;
};

const booleanLabel = (value: boolean) => value ? '允许' : '不允许';

const ruleDescriptors: RuleDescriptor[] = [
  { key: 'target_audience', label: '目标受众', icon: <TeamOutlined />, text: (rules) => rules.target_audience },
  { key: 'title_range', label: '标题长度建议', icon: <FontSizeOutlined />, text: (rules) => `${rules.title_min}–${rules.title_max} 字` },
  { key: 'body_range', label: '正文长度范围', icon: <FileTextOutlined />, text: (rules) => `${rules.body_min}–${rules.body_max} 字` },
  { key: 'tone', label: '内容语气', icon: <MessageOutlined />, text: (rules) => rules.tone },
  { key: 'allow_external_links', label: '是否允许外链', icon: <LinkOutlined />, text: (rules) => booleanLabel(rules.allow_external_links) },
  { key: 'allow_tables', label: '是否允许表格', icon: <TableOutlined />, text: (rules) => booleanLabel(rules.allow_tables) },
  { key: 'allow_contact', label: '是否允许联系方式', icon: <ContactsOutlined />, text: (rules) => booleanLabel(rules.allow_contact) },
  { key: 'prohibited_phrases', label: '禁用表达', icon: <StopOutlined />, text: (rules) => rules.prohibited_phrases.join('、') || '无' },
  {
    key: 'sections',
    label: '可用栏目与地址',
    icon: <OrderedListOutlined />,
    text: (rules) => rules.sections.map((section) => `${section.name} ${section.url}`).join('\n') || '无',
    content: (rules) => rules.sections.length ? (
      <div className="platform-rule-section-links">
        {rules.sections.map((section) => <a key={`${section.name}-${section.url}`} href={section.url} target="_blank" rel="noreferrer"><span>{section.name}</span><small>{section.url}</small></a>)}
      </div>
    ) : '无',
  },
];

export function ruleDifferenceCount(current: PlatformRules, baseline?: PlatformRules): number {
  if (!baseline) return 0;
  return ruleDescriptors.filter((descriptor) => descriptor.text(current) !== descriptor.text(baseline)).length;
}

export function PlatformRuleDetail({
  platformName,
  version,
  versions,
  onEdit,
  onActivate,
  onRetire,
  onDelete,
}: {
  platformName: string;
  version: RuleVersionSummary;
  versions: RuleVersionSummary[];
  onEdit: (version: RuleVersionSummary) => void;
  onActivate: (version: RuleVersionSummary) => void;
  onRetire: (version: RuleVersionSummary) => void;
  onDelete: (version: RuleVersionSummary) => void;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [comparisonSelection, setComparisonSelection] = useState<{ versionId: string; comparisonId: string }>();
  const comparisonCandidates = useMemo(
    () => versions.filter((item) => item.id !== version.id),
    [version.id, versions],
  );
  const defaultComparison = useMemo(
    () => comparisonCandidates
      .filter((item) => item.version < version.version)
      .sort((left, right) => right.version - left.version)[0] ?? comparisonCandidates[0],
    [comparisonCandidates, version.version],
  );
  const comparisonId = comparisonSelection?.versionId === version.id
    ? comparisonSelection.comparisonId
    : defaultComparison?.id;
  const comparison = comparisonCandidates.find((item) => item.id === comparisonId);
  const differences = comparison
    ? ruleDescriptors.filter((descriptor) => descriptor.text(version.rules) !== descriptor.text(comparison.rules))
    : [];
  const menuItems = [
    version.available_actions.includes('EDIT') ? { key: 'edit', label: '编辑草稿' } : null,
    version.available_actions.includes('ACTIVATE') ? { key: 'activate', label: '激活版本' } : null,
    version.available_actions.includes('RETIRE') ? { key: 'retire', label: '退役草稿', danger: true } : null,
    version.available_actions.includes('DELETE') ? { key: 'delete', label: '删除版本', danger: true } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <section className="platform-rule-detail-panel" aria-label={`规则详情：${platformName} V${version.version}`}>
      <header className="platform-rule-detail-header">
        <div>
          <Typography.Title level={4}>{platformName} / V{version.version}</Typography.Title>
          <StatusTag status={version.status} />
        </div>
        <div className="platform-rule-detail-actions">
          <Button disabled={!comparisonCandidates.length} onClick={() => setDiffOpen(true)}>查看差异</Button>
          <Dropdown
            trigger={['click']}
            disabled={!menuItems.length}
            menu={{
              items: menuItems,
              onClick: ({ key }) => {
                if (key === 'edit') onEdit(version);
                if (key === 'activate') onActivate(version);
                if (key === 'retire') onRetire(version);
                if (key === 'delete') onDelete(version);
              },
            }}
          >
            <Button aria-label={`更多操作：规则版本 V${version.version}`} icon={<MoreOutlined />}>更多操作</Button>
          </Dropdown>
        </div>
      </header>
      <div className="platform-rule-detail-scroll">
        {ruleDescriptors.map((descriptor) => (
          <div className="platform-rule-row" key={descriptor.key}>
            <span className="platform-rule-row-icon" aria-hidden="true">{descriptor.icon}</span>
            <strong>{descriptor.label}</strong>
            <div>{descriptor.content?.(version.rules) ?? descriptor.text(version.rules)}</div>
          </div>
        ))}
      </div>
      <Modal
        title={`规则差异 · V${version.version}`}
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        footer={<Button onClick={() => setDiffOpen(false)}>关闭</Button>}
        width={760}
        destroyOnHidden
      >
        {comparisonCandidates.length ? (
          <>
            <div className="platform-rule-diff-toolbar">
              <Typography.Text type="secondary">对比版本</Typography.Text>
              <Select
                aria-label="选择规则对比版本"
                value={comparisonId}
                onChange={(value) => setComparisonSelection({ versionId: version.id, comparisonId: value })}
                options={comparisonCandidates.map((item) => ({ value: item.id, label: `V${item.version} · ${item.status}` }))}
              />
              <Tag color={differences.length ? 'blue' : 'green'}>{differences.length} 项变化</Tag>
            </div>
            {comparison && (differences.length ? (
              <div className="platform-rule-diff-list">
                {differences.map((descriptor) => (
                  <article key={descriptor.key}>
                    <strong>{descriptor.label}</strong>
                    <div><small>V{comparison.version}</small><p>{descriptor.text(comparison.rules)}</p></div>
                    <div><small>V{version.version}</small><p>{descriptor.text(version.rules)}</p></div>
                  </article>
                ))}
              </div>
            ) : <Typography.Text type="secondary">两个版本没有规则字段变化。</Typography.Text>)}
          </>
        ) : <Typography.Text type="secondary">这是该平台的首个版本，暂无可对比版本。</Typography.Text>}
      </Modal>
    </section>
  );
}
