import { describe, expect, it } from 'vitest';

import { createdWork } from './publication-work.test-fixtures';
import {
  canonicalPublicationWorkspaceHash,
  isCanonicalPublicationWorkspaceHash,
  publicationCoreActions,
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
});
