import { describe, expect, it } from 'vitest';

import {
  canonicalPublicationWorkSearchRecord,
  isCanonicalPublicationWorkSearch,
  publicationStageRegistry,
  publicationWorkSearchSchema,
  publicationWorkSearchToApiParams,
  resolvePublicationOverflowActions,
  resolvePublicationPrimaryAction,
  type PublicationWorkListItem,
} from './publication-work.model';
import { workListItem } from './publication-work.test-fixtures';

describe('Publication Work list model', () => {
  it('规范化 URL 并只映射服务端支持的分页和状态参数', () => {
    const search = publicationWorkSearchSchema.parse({
      page: '2',
      pageSize: '50',
      status: 'ACTION_REQUIRED',
      unknown: 'remove-me',
    });
    expect(search).toEqual({ page: 2, pageSize: 50, status: 'ACTION_REQUIRED' });
    expect(publicationWorkSearchToApiParams(search)).toEqual({
      page: 2,
      page_size: 50,
      status: 'ACTION_REQUIRED',
    });
    expect(canonicalPublicationWorkSearchRecord(search)).toEqual({
      page: 2,
      pageSize: 50,
      status: 'ACTION_REQUIRED',
    });
  });

  it('非法或终态筛选回到显式 canonical 默认值', () => {
    const search = publicationWorkSearchSchema.parse({ page: 0, pageSize: 99, status: 'CLOSED' });
    expect(search).toEqual({ page: 1, pageSize: 20 });
    expect(isCanonicalPublicationWorkSearch({}, search)).toBe(false);
    expect(isCanonicalPublicationWorkSearch({ page: 1, pageSize: 20 }, search)).toBe(true);
  });

  it('服务端 primary_task 和 available_actions 只映射到未来 canonical href', () => {
    expect(resolvePublicationPrimaryAction(workListItem)).toEqual({
      key: 'CONTINUE_PREPARATION',
      label: '继续准备',
      intent: 'primary',
      enabled: true,
      href: `/publishing/work/${workListItem.id}#preparation`,
    });
    expect(resolvePublicationOverflowActions(workListItem)).toEqual([
      expect.objectContaining({ key: 'UPDATE_PREPARATION', href: `/publishing/work/${workListItem.id}#preparation` }),
      expect.objectContaining({ key: 'MARK_PLATFORM_REVIEW', href: `/publishing/work/${workListItem.id}#preparation` }),
      expect.objectContaining({ key: 'CLOSE', href: `/publishing/work/${workListItem.id}#close` }),
    ]);
    expect(publicationStageRegistry.ACTION_REQUIRED).toEqual({ label: '需处理', tone: 'destructive' });
  });

  it('primary 已提升的同一业务动作不在 overflow 重复展示', () => {
    const platformReview: PublicationWorkListItem = {
      ...workListItem,
      status: 'PLATFORM_REVIEW',
      workflow_stage: 'PLATFORM_REVIEW',
      primary_task: 'REGISTER_RESULT',
      available_actions: ['REGISTER_RESULT', 'UPDATE_PREPARATION', 'CLOSE'],
    };
    expect(resolvePublicationOverflowActions(platformReview).map((action) => action.key))
      .toEqual(['UPDATE_PREPARATION', 'CLOSE']);
  });
});
