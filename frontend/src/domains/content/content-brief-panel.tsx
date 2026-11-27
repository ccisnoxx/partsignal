import { Badge } from '@/design-system/primitives/badge';
import { campaignStatusRegistry, formatRatePercent } from '@/domains/campaigns/campaign.model';
import { intentLabels } from '@/domains/geo/query-topic-list.model';
import type { components } from '@/shared/api/generated/schema';

type ContentBriefSnapshotOut = components['schemas']['ContentBriefSnapshotOut'];
type ContentCampaignSummary = components['schemas']['ContentCampaignSummary'];

type ContentBriefPanelProps = {
  brief: ContentBriefSnapshotOut | null;
  campaign: ContentCampaignSummary | null;
  compact?: boolean;
};

function ContentBriefPanel({ brief, campaign, compact = false }: ContentBriefPanelProps) {
  if (!brief && !campaign) {
    return (
      <p className="text-sm text-text-muted">
        该任务为历史存量或无 Brief 快照的联动/修复任务，无冻结内容 Brief。
      </p>
    );
  }

  return (
    <div className={compact ? 'space-y-3 text-xs' : 'space-y-4 text-sm'}>
      {campaign && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted/40 px-3 py-2">
          <span className="text-text-muted">所属内容活动：</span>
          <a
            className="font-medium text-primary underline underline-offset-2"
            href={`/content/campaigns/${encodeURIComponent(campaign.id)}`}
          >
            {campaign.name}
          </a>
          <Badge variant={campaignStatusRegistry[campaign.status].tone}>
            {campaignStatusRegistry[campaign.status].label}
          </Badge>
        </div>
      )}

      {brief ? (
        <dl className={compact ? 'space-y-2' : 'grid gap-3 md:grid-cols-2'}>
          <BriefField label="目标问题" value={brief.target_question} />
          <BriefField
            label="搜索意图与内容角度"
            value={`${intentLabels[brief.search_intent]} · ${brief.content_angle}`}
          />
          {brief.target_audience && <BriefField label="目标受众" value={brief.target_audience} />}
          {brief.content_format && <BriefField label="内容形式" value={brief.content_format} />}
          {brief.cta && <BriefField label="行动号召（CTA）" value={brief.cta} />}
          {brief.must_answer_questions.length > 0 && (
            <BriefListField items={brief.must_answer_questions} label="必须回答的问题" />
          )}
          {brief.required_fact_points.length > 0 && (
            <BriefListField items={brief.required_fact_points} label="必须覆盖的产品事实" />
          )}
          {brief.forbidden_expressions.length > 0 && (
            <BriefListField
              items={brief.forbidden_expressions}
              label="禁止表达"
              tone="warning"
            />
          )}
          {brief.target_keywords.length > 0 && (
            <BriefTagsField items={brief.target_keywords} label="目标关键词" />
          )}
          {(brief.success_metrics.target_discovery_rate != null
            || brief.success_metrics.target_mention_rate != null
            || brief.success_metrics.target_recommendation_rate != null
            || brief.success_metrics.target_citation_rate != null) && (
            <BriefField
              label="GEO 目标指标"
              value={[
                brief.success_metrics.target_discovery_rate != null
                  ? `发现率 ${formatRatePercent(brief.success_metrics.target_discovery_rate)}`
                  : null,
                brief.success_metrics.target_mention_rate != null
                  ? `提及率 ${formatRatePercent(brief.success_metrics.target_mention_rate)}`
                  : null,
                brief.success_metrics.target_recommendation_rate != null
                  ? `推荐率 ${formatRatePercent(brief.success_metrics.target_recommendation_rate)}`
                  : null,
                brief.success_metrics.target_citation_rate != null
                  ? `引用率 ${formatRatePercent(brief.success_metrics.target_citation_rate)}`
                  : null,
              ].filter(Boolean).join(' · ')}
            />
          )}
          {brief.success_metrics.notes && (
            <BriefField label="成功标准备注" value={brief.success_metrics.notes} />
          )}
        </dl>
      ) : (
        <p className="text-text-muted">无冻结 Brief 快照（兼容历史/修复任务）。</p>
      )}
    </div>
  );
}

function BriefField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap text-text-primary">{value}</dd>
    </div>
  );
}

function BriefListField({
  items,
  label,
  tone,
}: {
  items: string[];
  label: string;
  tone?: 'warning';
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd>
        <ul className="list-disc space-y-0.5 pl-4">
          {items.map((item) => (
            <li className={tone === 'warning' ? 'text-warning-foreground' : 'text-text-primary'} key={item}>
              {item}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function BriefTagsField({ items, label }: { items: string[]; label: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} variant="outline">{item}</Badge>
        ))}
      </dd>
    </div>
  );
}

export { ContentBriefPanel };
export type { ContentBriefPanelProps };
