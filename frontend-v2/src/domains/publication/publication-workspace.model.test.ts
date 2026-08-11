import { describe, expect, it } from 'vitest';

import type { components } from '@/shared/api/generated/schema';
import { createdWork, workspaceContext } from './publication-work.test-fixtures';
import {
  canonicalPublicationWorkspaceHash,
  isCanonicalPublicationWorkspaceHash,
  publicationCoreActions,
  publicationVerificationPayload,
  publicationWorkspaceActions,
  publicationWorkspaceSections,
} from './publication-workspace.model';

describe('Publication workspace model', () => {
  it('只接受六个 canonical hash，缺失和未知值回到 summary', () => {
    expect(publicationWorkspaceSections).toEqual([
      'summary', 'preparation', 'result', 'verification', 'content-version', 'close',
    ]);
    expect(canonicalPublicationWorkspaceHash('#result')).toBe('result');
    expect(canonicalPublicationWorkspaceHash('unknown')).toBe('summary');
    expect(isCanonicalPublicationWorkspaceHash('')).toBe(false);
    expect(isCanonicalPublicationWorkspaceHash('summary')).toBe(true);
  });

  it('只把服务端 token 映射为 Core 动作，不伪造 Verify/Switch', () => {
    const work = {
      ...createdWork,
      available_actions: [
        'UPDATE_PREPARATION', 'MARK_PLATFORM_REVIEW', 'VERIFY', 'SWITCH_CONTENT_VERSION', 'CLOSE',
      ],
    } as typeof createdWork;
    expect(publicationCoreActions(work).map(({ action, intent }) => [action, intent])).toEqual([
      ['UPDATE_PREPARATION', 'primary'],
      ['MARK_PLATFORM_REVIEW', 'secondary'],
      ['CLOSE', 'danger'],
    ]);
  });

  it('只按 token 与精确 candidate 呈现 Verification 动作', () => {
    const awaiting = {
      ...workspaceContext,
      work: {
        ...workspaceContext.work,
        primary_task: 'RUN_FIRST_VERIFICATION',
        available_actions: ['VERIFY', 'SWITCH_CONTENT_VERSION', 'CLOSE'],
      },
    } satisfies components['schemas']['PublicationWorkspaceContext'];
    expect(publicationWorkspaceActions(awaiting).map(({ action, intent }) => [action, intent]))
      .toEqual([['VERIFY', 'primary'], ['CLOSE', 'danger']]);

    const candidate = {
      id: '20000000-0000-4000-8000-000000000002',
      version: 4,
      title: '修订批准内容',
      summary: '修订摘要',
      content_hash: 'replacement-hash',
    };
    expect(publicationWorkspaceActions({ ...awaiting, switch_candidate: candidate })
      .map(({ action }) => action)).toEqual(['VERIFY', 'SWITCH_CONTENT_VERSION', 'CLOSE']);
  });

  it('正文选择穷尽映射 PASSED/FAILED payload', () => {
    expect(publicationVerificationPayload({ match: 'MATCH', comment: '' }, 7)).toEqual({
      outcome: 'PASSED', content_matches: true, expected_revision: 7, comment: '',
    });
    expect(publicationVerificationPayload({ match: 'MISMATCH', comment: '正文不一致' }, 8))
      .toEqual({
        outcome: 'FAILED', content_matches: false, expected_revision: 8, comment: '正文不一致',
      });
  });
});
