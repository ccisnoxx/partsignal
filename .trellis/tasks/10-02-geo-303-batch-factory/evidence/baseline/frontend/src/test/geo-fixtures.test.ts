import { describe, expect, it } from 'vitest';

import { loadGeoFixtures } from './geo-fixtures';

describe('GEO 同源测试语料', () => {
  it('加载版本、原回答和独立金标，保留未知值及引用顺序', () => {
    expect(loadGeoFixtures()).toMatchObject({
      corpus: {
        fixture_version: '1.0.0', dataset_id: 'geo-005-v1', synthetic: true,
        answers: expect.arrayContaining([
          expect.objectContaining({ id: 'answer-exact-model', web_search_observed: null }),
        ]),
        citations: expect.arrayContaining([
          expect.objectContaining({ answer_id: 'answer-exact-model', position: 1 }),
          expect.objectContaining({ answer_id: 'answer-exact-model', position: 2 }),
        ]),
      },
      gold: {
        fixture_version: '1.0.0', dataset_id: 'geo-005-v1', synthetic: true,
        cases: expect.arrayContaining([
          expect.objectContaining({
            id: 'gold-unordered-recommendation',
            expected: expect.objectContaining({
              recommendations: [expect.objectContaining({ rank: null }), expect.objectContaining({ rank: null })],
            }),
          }),
        ]),
      },
    });
  });

  it('各次加载互不共享可变数据，支持局部测试输入', () => {
    const first = loadGeoFixtures();
    const original = loadGeoFixtures();
    if (typeof first.corpus !== 'object' || first.corpus === null
      || typeof first.gold !== 'object' || first.gold === null) {
      throw new Error('GEO fixture 缺少语料或金标对象');
    }
    Reflect.set(first.corpus, 'answers', []);
    Reflect.set(first.gold, 'cases', []);
    expect(loadGeoFixtures()).toEqual(original);
  });
});
