import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import { Textarea } from '@/design-system/primitives/textarea';
import type { components } from '@/shared/api/generated/schema';
import {
  decisionKindLabels,
  formatOpportunityChoiceLabel,
  formatShortDateTime,
  geoInterventionActionTypeLabels,
  geoInterventionActionTypes,
  geoInterventionEditableStatuses,
  geoInterventionStatusRegistry,
  type BaselineChoice,
  type GeoInterventionActionType,
  type GeoInterventionEditableStatus,
  type GeoInterventionFormDraft,
  type GeoInterventionOut,
} from './geo-intervention.model';

type GeoInterventionFormFieldsProps = {
  mode: 'create' | 'edit';
  busy: boolean;
  draft: GeoInterventionFormDraft;
  onDraftChange: (patch: Partial<GeoInterventionFormDraft>) => void;
  editTarget: GeoInterventionOut | null;
  lockedCampaignId?: string;
  lockedCampaignName?: string;
  lockedOpportunityId?: string;
  lockedOpportunityTitle?: string;
  opportunities: components['schemas']['GeoOpportunityListItem'][];
  opportunitiesTotal: number;
  opportunitiesLoading: boolean;
  opportunitiesError: string | null;
  onRetryOpportunities: () => void;
  campaigns: components['schemas']['ContentCampaignListItem'][];
  campaignsTotal: number;
  campaignsLoading: boolean;
  campaignsError: string | null;
  onRetryCampaigns: () => void;
  assignees: components['schemas']['WorkAssigneeOption'][];
  assigneesLoading: boolean;
  assigneesLoaded: boolean;
  assigneesError: string | null;
  onRetryAssignees: () => void;
  baselineChoices: BaselineChoice[];
  decisionChoices: components['schemas']['GeoOpportunityDecision'][];
  evidenceLoading: boolean;
  evidenceError: string | null;
  onRetryEvidence: () => void;
};

function OptionErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px]"
      role="alert"
    >
      <span className="min-w-0 break-words">{message}</span>
      <Button onClick={onRetry} size="sm" type="button" variant="outline">
        重试
      </Button>
    </div>
  );
}

export function GeoInterventionFormFields({
  mode,
  busy,
  draft,
  onDraftChange,
  editTarget,
  lockedCampaignId,
  lockedCampaignName,
  lockedOpportunityId,
  lockedOpportunityTitle,
  opportunities,
  opportunitiesTotal,
  opportunitiesLoading,
  opportunitiesError,
  onRetryOpportunities,
  campaigns,
  campaignsTotal,
  campaignsLoading,
  campaignsError,
  onRetryCampaigns,
  assignees,
  assigneesLoading,
  assigneesLoaded,
  assigneesError,
  onRetryAssignees,
  baselineChoices,
  decisionChoices,
  evidenceLoading,
  evidenceError,
  onRetryEvidence,
}: GeoInterventionFormFieldsProps) {
  const selectableCampaigns = campaigns.filter(
    (item) => item.status !== 'ARCHIVED' || item.id === editTarget?.campaign_id,
  );
  const currentCampaignMissing = Boolean(
    editTarget?.campaign_id
      && !selectableCampaigns.some((item) => item.id === editTarget.campaign_id),
  );
  const currentAssigneeMissing = Boolean(
    editTarget?.assignee_id && !assignees.some((u) => u.id === editTarget.assignee_id),
  );
  const currentBaselineMissing = Boolean(
    draft.baselineId && !baselineChoices.some((b) => b.id === draft.baselineId),
  );
  const currentDecisionMissing = Boolean(
    draft.decisionId && !decisionChoices.some((d) => d.id === draft.decisionId),
  );
  const editableStatuses = editTarget
    ? geoInterventionEditableStatuses(editTarget.status)
    : (['PLANNED'] as const);

  return (
    <>
      {mode === 'create' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            {lockedOpportunityId || opportunitiesError ? (
              <span className="block text-xs font-medium text-text-secondary">
                关联 GEO 机会 *
              </span>
            ) : (
              <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-opp">
                关联 GEO 机会 *
              </label>
            )}
            {lockedOpportunityId ? (
              <div className="rounded-md border border-border-subtle bg-surface-subtle/40 px-2.5 py-2 text-xs">
                {lockedOpportunityTitle || lockedOpportunityId}
              </div>
            ) : opportunitiesError ? (
              <OptionErrorBanner message={opportunitiesError} onRetry={onRetryOpportunities} />
            ) : (
              <>
                <select
                  className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
                  disabled={busy || opportunitiesLoading}
                  id="geo-int-opp"
                  onChange={(e) => onDraftChange({ opportunityId: e.target.value, baselineId: '' })}
                  value={draft.opportunityId}
                >
                  <option value="">
                    {opportunitiesLoading
                      ? '正在加载 GEO 机会…'
                      : opportunities.length === 0
                        ? '暂无可关联的 GEO 机会'
                        : '请选择 GEO 机会'}
                  </option>
                  {opportunities.map((opp) => (
                    <option key={opp.id} value={opp.id}>
                      {formatOpportunityChoiceLabel(opp)}
                    </option>
                  ))}
                </select>
                {opportunitiesTotal > opportunities.length && (
                  <p className="text-[11px] text-text-muted">
                    当前仅展示前 {opportunities.length} 条（共 {opportunitiesTotal} 条），其余机会请到 GEO 机会工作台打开详情创建。
                  </p>
                )}
              </>
            )}
          </div>

          <div className="space-y-1">
            {lockedCampaignId ? (
              <span className="block text-xs font-medium text-text-secondary">
                关联内容活动（可选）
              </span>
            ) : (
              <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-camp">
                关联内容活动（可选）
              </label>
            )}
            {lockedCampaignId ? (
              <div className="rounded-md border border-border-subtle bg-surface-subtle/40 px-2.5 py-2 text-xs">
                {lockedCampaignName || lockedCampaignId}
              </div>
            ) : (
              <>
                <select
                  className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
                  disabled={busy || campaignsLoading}
                  id="geo-int-camp"
                  onChange={(e) => onDraftChange({ campaignId: e.target.value })}
                  value={draft.campaignId}
                >
                  <option value="">
                    {campaignsLoading ? '正在加载内容活动…' : '不关联内容活动'}
                  </option>
                  {selectableCampaigns.map((camp) => (
                    <option key={camp.id} value={camp.id}>
                      {camp.name}
                    </option>
                  ))}
                </select>
                {campaignsError && (
                  <OptionErrorBanner message={campaignsError} onRetry={onRetryCampaigns} />
                )}
                {campaignsTotal > campaigns.length && (
                  <p className="text-[11px] text-text-muted">
                    当前仅展示前 {campaigns.length} 个活动（共 {campaignsTotal} 个）。
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-status">
              干预状态 *
            </label>
            <select
              className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
              disabled={busy}
              id="geo-int-status"
              onChange={(e) =>
                onDraftChange({ status: e.target.value as GeoInterventionEditableStatus })
              }
              value={draft.status}
            >
              {editableStatuses.map((item) => (
                <option key={item} value={item}>
                  {geoInterventionStatusRegistry[item].label}（{item}）
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-camp">
              关联内容活动（可选）
            </label>
            <select
              className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
              disabled={busy || campaignsLoading}
              id="geo-int-camp"
              onChange={(e) => onDraftChange({ campaignId: e.target.value })}
              value={draft.campaignId}
            >
              <option value="">
                {campaignsLoading ? '正在加载内容活动…' : '不关联内容活动'}
              </option>
              {currentCampaignMissing && editTarget?.campaign_id && (
                <option value={editTarget.campaign_id}>
                  {editTarget.campaign_name ?? editTarget.campaign_id}（当前关联）
                </option>
              )}
              {selectableCampaigns.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.status === 'ARCHIVED' ? `${camp.name}（已归档 · 当前关联）` : camp.name}
                </option>
              ))}
            </select>
            {campaignsError && (
              <OptionErrorBanner message={campaignsError} onRetry={onRetryCampaigns} />
            )}
            {campaignsTotal > campaigns.length && (
              <p className="text-[11px] text-text-muted">
                当前仅展示前 {campaigns.length} 个活动（共 {campaignsTotal} 个）。
              </p>
            )}
            <p className="text-[11px] text-text-muted">
              若该干预已登记运营费用台账，服务端将拒绝变更所属活动。
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-title">
            干预标题 *
          </label>
          <Input
            disabled={busy}
            id="geo-int-title"
            maxLength={200}
            onChange={(e) => onDraftChange({ title: e.target.value })}
            placeholder="例如：补充 TPS5430 热阻对比内容并复测"
            value={draft.title}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-action">
            计划行动类型 *
          </label>
          <select
            className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
            disabled={busy}
            id="geo-int-action"
            onChange={(e) =>
              onDraftChange({ plannedActionType: e.target.value as GeoInterventionActionType })
            }
            value={draft.plannedActionType}
          >
            {geoInterventionActionTypes.map((actionType) => (
              <option key={actionType} value={actionType}>
                {geoInterventionActionTypeLabels[actionType]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-hyp">
          优化假设 *（1–2000 字）
        </label>
        <Textarea
          disabled={busy}
          id="geo-int-hyp"
          maxLength={2000}
          onChange={(e) => onDraftChange({ hypothesis: e.target.value })}
          placeholder="说明待验证的 GEO 改善假设、覆盖内容范围与观察重点"
          rows={3}
          value={draft.hypothesis}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-assignee">
            负责人（可选）
          </label>
          <select
            className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
            disabled={busy || assigneesLoading}
            id="geo-int-assignee"
            onChange={(e) => onDraftChange({ assigneeId: e.target.value })}
            value={draft.assigneeId}
          >
            <option value="">{assigneesLoading ? '正在加载成员…' : '未分派'}</option>
            {currentAssigneeMissing && editTarget?.assignee_id && (
              <option value={editTarget.assignee_id}>
                {editTarget.assignee_display_name ?? editTarget.assignee_id}
                {assigneesLoaded ? '（非活跃账号，请改派或清空）' : '（当前负责人）'}
              </option>
            )}
            {assignees.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name}（{user.username}）
              </option>
            ))}
          </select>
          {assigneesError && (
            <OptionErrorBanner message={assigneesError} onRetry={onRetryAssignees} />
          )}
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-baseline">
            关联复测基线（可选）
          </label>
          <select
            className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
            disabled={busy || !draft.opportunityId || evidenceLoading}
            id="geo-int-baseline"
            onChange={(e) => onDraftChange({ baselineId: e.target.value })}
            value={draft.baselineId}
          >
            <option value="">
              {!draft.opportunityId
                ? '请先选择 GEO 机会'
                : evidenceLoading
                  ? '正在加载基线列表…'
                  : '不绑定特定基线'}
            </option>
            {currentBaselineMissing && (
              <option value={draft.baselineId}>已绑定基线 {draft.baselineId.slice(0, 8)}</option>
            )}
            {baselineChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          {evidenceError && draft.opportunityId && (
            <OptionErrorBanner message={evidenceError} onRetry={onRetryEvidence} />
          )}
        </div>
      </div>

      {mode === 'edit' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary" htmlFor="geo-int-decision">
            关联机会处理结论（可选）
          </label>
          <select
            className="h-9 w-full rounded-md border border-border-default bg-surface-panel px-2 text-xs"
            disabled={busy || evidenceLoading}
            id="geo-int-decision"
            onChange={(e) => onDraftChange({ decisionId: e.target.value })}
            value={draft.decisionId}
          >
            <option value="">
              {evidenceLoading ? '正在加载处理结论…' : '暂不关联处理结论'}
            </option>
            {currentDecisionMissing && (
              <option value={draft.decisionId}>已绑定结论 {draft.decisionId.slice(0, 8)}</option>
            )}
            {decisionChoices.map((dec) => (
              <option key={dec.id} value={dec.id}>
                {decisionKindLabels[dec.decision]} · {dec.reason_code}（
                {formatShortDateTime(dec.created_at)}）
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="space-y-2 rounded-lg border border-border-subtle p-3">
        <legend className="px-1 text-xs font-medium text-text-secondary">
          目标指标（可选，填写 0–100 百分比）
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ['发现率 (%)', 'discoveryPct', '如 60'],
              ['提及率 (%)', 'mentionPct', '如 50'],
              ['推荐率 (%)', 'recommendationPct', '如 40'],
              ['引用率 (%)', 'citationPct', '如 30'],
              ['准确率 (%)', 'accuracyPct', '如 95'],
            ] as const
          ).map(([label, key, placeholder]) => (
            <label className="space-y-1 text-xs" key={key}>
              <span className="block text-text-muted">{label}</span>
              <Input
                disabled={busy}
                inputMode="decimal"
                onChange={(e) => onDraftChange({ [key]: e.target.value })}
                placeholder={placeholder}
                value={draft[key]}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['干预执行时间（可选）', 'intervenedLocal'],
            ['复测窗口开始（可选）', 'retestStartLocal'],
            ['复测窗口结束（可选）', 'retestEndLocal'],
          ] as const
        ).map(([label, key]) => (
          <label className="space-y-1 text-xs" key={key}>
            <span className="block text-text-secondary">{label}</span>
            <Input
              disabled={busy}
              onChange={(e) => onDraftChange({ [key]: e.target.value })}
              type="datetime-local"
              value={draft[key]}
            />
          </label>
        ))}
      </div>
    </>
  );
}
