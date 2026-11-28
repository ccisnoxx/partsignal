import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { InlineBanner } from '@/design-system/feedback/inline-banner';
import { Badge } from '@/design-system/primitives/badge';
import { Button } from '@/design-system/primitives/button';
import { Input } from '@/design-system/primitives/input';
import {
  failManualObservation,
  previewManualObservation,
  submitManualObservation,
  type DailyChecklistItem,
  type ManualPreviewOut,
} from './daily-checklist.api';
import {
  linkStatusLabels,
  makeIdempotencyKey,
  manualFailLabels,
  promptCategoryLabels,
  type ManualFailCode,
} from './daily-checklist.model';

type Props = {
  item: DailyChecklistItem;
  csrfToken: string | null;
  onCompleted: () => Promise<void>;
  onClose: () => void;
};

export function DailyChecklistCapture({ item, csrfToken, onCompleted, onClose }: Props) {
  const [answerText, setAnswerText] = useState('');
  const [actualPrompt, setActualPrompt] = useState('');
  const [webSearch, setWebSearch] = useState<'UNKNOWN' | 'YES' | 'NO'>('YES');
  const [citStatus, setCitStatus] = useState<'COMPLETE' | 'NONE' | 'PARTIAL' | 'UNKNOWN'>('NONE');
  const [missingReason, setMissingReason] = useState('');
  const [citationsText, setCitationsText] = useState('');
  const [confirmAll, setConfirmAll] = useState(true);
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState<ManualPreviewOut | null>(null);
  const [failCode, setFailCode] = useState<ManualFailCode>('MANUAL_TIMEOUT');
  const [failSummary, setFailSummary] = useState('');
  const [showFail, setShowFail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedHint, setCopiedHint] = useState(false);

  const parsedUrls = citationsText
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http://') || u.startsWith('https://'));

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      return previewManualObservation(
        item.run_id,
        {
          answer_text: answerText,
          citations: parsedUrls.map((original_url) => ({ original_url })),
        },
        csrfToken,
      );
    },
    onSuccess: (data) => {
      setPreview(data);
      if (data.extracted_urls.length > 0 && parsedUrls.length === 0) {
        setCitationsText(data.extracted_urls.join('\n'));
        setCitStatus('COMPLETE');
      }
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '规则预判失败'),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      if (!answerText.trim()) throw new Error('请粘贴模型回答原文');
      const finalUrls =
        parsedUrls.length > 0 ? parsedUrls : (preview?.extracted_urls ?? []);
      const effectiveCitStatus =
        finalUrls.length > 0 && citStatus === 'NONE' ? 'COMPLETE' : citStatus;
      const needReason = effectiveCitStatus === 'PARTIAL' || effectiveCitStatus === 'UNKNOWN';
      if (needReason && !missingReason.trim()) {
        throw new Error('部分可见或未检查引用必须填写原因说明');
      }
      return submitManualObservation(
        item.run_id,
        {
          expected_draft_revision: 0,
          answer_text: answerText,
          answer_format: 'TEXT',
          web_search_observed: webSearch === 'UNKNOWN' ? null : webSearch === 'YES',
          citations: finalUrls.map((original_url, idx) => ({
            original_url,
            position: idx + 1,
            extraction_source: 'MANUAL',
          })),
          citation_observation: {
            status: effectiveCitStatus,
            missing_reason: needReason ? missingReason.trim() : null,
          },
          collected_at: new Date().toISOString(),
          actual_prompt_text: actualPrompt.trim() || null,
          inline_review: {
            confirm_all: confirmAll,
            subject_decisions: [],
            citation_decisions: [],
            comment: comment.trim(),
          },
        },
        makeIdempotencyKey(item.run_id),
        csrfToken,
      );
    },
    onSuccess: async () => {
      setErrorMsg(null);
      await onCompleted();
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '提交人工观测失败'),
  });

  const failMutation = useMutation({
    mutationFn: async () => {
      if (!csrfToken) throw new Error('缺少 CSRF 令牌');
      if (!failSummary.trim()) throw new Error('请填写采集异常说明');
      return failManualObservation(
        item.run_id,
        {
          expected_run_revision: item.revision,
          error_code: failCode,
          error_summary: failSummary.trim(),
        },
        csrfToken,
      );
    },
    onSuccess: async () => {
      setErrorMsg(null);
      await onCompleted();
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '标记采集异常失败'),
  });

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(item.prompt_text);
      setCopiedHint(true);
      setTimeout(() => setCopiedHint(false), 2000);
    } catch {
      setCopiedHint(false);
    }
  }

  return (
    <section className="rounded-lg border border-primary/40 bg-surface p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{promptCategoryLabels[item.prompt_category]}</Badge>
            <Badge variant="secondary">{item.platform_name}</Badge>
            <span className="text-xs text-text-muted">{item.profile_name}</span>
          </div>
          <h3 className="text-base font-medium">{item.prompt_text}</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={copyPrompt}>
            {copiedHint ? '已复制问题' : '复制问题'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            收起
          </Button>
        </div>
      </div>

      {errorMsg && <InlineBanner role="alert" tone="danger">{errorMsg}</InlineBanner>}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-text-muted">粘贴回答原文（系统自动作为文本证据保存）</label>
          <Button
            size="sm"
            variant="outline"
            disabled={!answerText.trim() || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? '预判中…' : '自动规则预判（别名 / URL / 文章匹配）'}
          </Button>
        </div>
        <textarea
          className="min-h-36 w-full rounded-md border border-border bg-background p-3 text-sm"
          placeholder="前往平台新建对话查询后，直接把完整回答粘贴到这里…"
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
        />
      </div>

      {preview && (
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2 text-xs">
          <div className="font-medium">规则预判结果（只读，提交前可调整）</div>
          <div className="flex flex-wrap gap-2">
            {preview.subjects.map((sub) => (
              <Badge key={sub.subject_id} variant={sub.mentioned ? 'default' : 'outline'}>
                {sub.display_name}：{sub.mentioned ? `提及 ${sub.mention_count} 次` : '未提及'}
                {sub.recommendation === 'RECOMMENDED' ? ' · 推荐' : ''}
              </Badge>
            ))}
          </div>
          {preview.citation_suggestions.length > 0 && (
            <ul className="space-y-1">
              {preview.citation_suggestions.map((c) => (
                <li key={c.normalized_url} className="flex flex-wrap items-center gap-2">
                  <span className="truncate max-w-md text-text-muted">{c.original_url}</span>
                  {c.suggested_link_status ? (
                    <Badge variant={c.suggested_link_status === 'AUTO_EXACT' ? 'default' : 'secondary'}>
                      {linkStatusLabels[c.suggested_link_status]} · {c.suggested_publication_title}
                    </Badge>
                  ) : (
                    <span className="text-text-muted">未匹配我方发布台账</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="text-xs text-text-muted">联网/搜索状态</label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={webSearch}
            onChange={(e) => setWebSearch(e.target.value as 'UNKNOWN' | 'YES' | 'NO')}
          >
            <option value="YES">已联网搜索</option>
            <option value="NO">未联网</option>
            <option value="UNKNOWN">无法观察/未知</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted">引用观察情况</label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={citStatus}
            onChange={(e) => setCitStatus(e.target.value as typeof citStatus)}
          >
            <option value="NONE">已完整检查且无引用</option>
            <option value="COMPLETE">已完整检查并登记引用 URL</option>
            <option value="PARTIAL">部分可见（不强制算未引用）</option>
            <option value="UNKNOWN">未检查（不强制算未引用）</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted">实际改问原文（未改问请留空）</label>
          <Input
            placeholder="仅实际修改了问题措辞时填写"
            value={actualPrompt}
            onChange={(e) => setActualPrompt(e.target.value)}
          />
        </div>
      </div>

      {(citStatus === 'PARTIAL' || citStatus === 'UNKNOWN') && (
        <div>
          <label className="text-xs text-text-muted">部分可见/未检查原因 *</label>
          <Input
            placeholder="如：手机端折叠未展开来源列表"
            value={missingReason}
            onChange={(e) => setMissingReason(e.target.value)}
          />
        </div>
      )}

      <div>
        <label className="text-xs text-text-muted">引用 URL（每行一条，可由上方规则预判自动填入）</label>
        <textarea
          className="mt-1 min-h-16 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          placeholder="https://zhuanlan.zhihu.com/p/..."
          value={citationsText}
          onChange={(e) => setCitationsText(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={confirmAll}
              onChange={(e) => setConfirmAll(e.target.checked)}
            />
            同屏确认分析结果（无候选待审时立即计入看板）
          </label>
          <Input
            className="w-56"
            placeholder="可选备注"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowFail((v) => !v)}>
            标记采集异常
          </Button>
          <Button
            size="sm"
            disabled={submitMutation.isPending || !answerText.trim()}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? '提交中…' : '保存并进入下一条'}
          </Button>
        </div>
      </div>

      {showFail && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={failCode}
            onChange={(e) => setFailCode(e.target.value as ManualFailCode)}
          >
            {Object.entries(manualFailLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Input
            className="flex-1 min-w-48"
            placeholder="记录异常原因（独立统计，不伪装为未命中）"
            value={failSummary}
            onChange={(e) => setFailSummary(e.target.value)}
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={failMutation.isPending}
            onClick={() => failMutation.mutate()}
          >
            确认标记失败
          </Button>
        </div>
      )}
    </section>
  );
}
