import { describe, expect, it } from 'vitest';

import {
  buildBatchCells,
  extractBatchPreviewFromError,
  parseAngleLines,
} from './content-batch.model';

describe('content-batch.model', () => {
  it('deduplicates content angles ignoring case and extra spaces', () => {
    expect(parseAngleLines('国产替代选型\n  国产替代选型 \nDC-DC  对比\ndc-dc 对比')).toEqual([
      '国产替代选型',
      'DC-DC  对比',
    ]);
  });

  it('builds Cartesian matrix cells and auto-prefills fact restrictions', () => {
    const cells = buildBatchCells({
      productIds: ['p-1'],
      topicIds: ['t-1'],
      platformIds: ['pl-1', 'pl-2'],
      angles: ['选型指南', '应用排障'],
      options: {
        products: [
          {
            id: 'p-1',
            part_number: 'PS-100',
            brand: 'PartSignal',
            approved_fact_versions: [
              {
                id: 'fv-2',
                version: 2,
                classification: 'PUBLIC',
                content_restrictions: '禁止承诺免验证直接替换；禁止夸大效率',
                approved_claims_summary: '输入 5.5-36V',
              },
            ],
          },
        ],
        platforms: [
          { id: 'pl-1', name: '知乎' },
          { id: 'pl-2', name: '官网' },
        ],
        topics: [
          {
            id: 't-1',
            canonical_question: 'TPS5430 有哪些国产替代？',
            intent_type: 'REPLACEMENT',
            description: '',
          },
        ],
        campaigns: [],
        requested_product: null,
        requested_campaign: null,
      },
      sharedAudience: '电源工程师',
      sharedContentFormat: '选型文章',
      sharedCta: '联系申请样品',
      sharedKeywordsText: 'TPS5430, 国产替代',
      sharedForbiddenText: '',
      sharedNotes: '目标提升推荐率',
    });

    expect(cells).toHaveLength(4);
    expect(cells[0]?.fact_version_id).toBe('fv-2');
    expect(cells[0]?.brief.forbidden_expressions).toEqual([
      '禁止承诺免验证直接替换',
      '禁止夸大效率',
    ]);
    expect(cells[0]?.brief.target_keywords).toEqual(['TPS5430', '国产替代']);
    expect(cells[2]?.brief.content_angle).toBe('应用排障');
  });

  it('extracts preview payload from structured 409 error', () => {
    const preview = {
      campaign_id: null,
      total_cells: 1,
      creatable_count: 0,
      blocker_cell_count: 1,
      warning_cell_count: 0,
      can_commit: false,
      requires_warning_acknowledgement: false,
      cells: [],
    };
    expect(extractBatchPreviewFromError({ detail: { details: { preview } } })).toEqual(preview);
    expect(extractBatchPreviewFromError(new Error('plain'))).toBeUndefined();
  });
});
