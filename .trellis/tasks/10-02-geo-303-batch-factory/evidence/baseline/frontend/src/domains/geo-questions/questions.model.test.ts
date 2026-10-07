import { describe, expect, it } from 'vitest';
import { questionCreate, questionEditorIdentity, questionFormSchema, questionSearchSchema, questionSearchToParams, questionValues, shouldBlockQuestionNavigation } from './questions.model';

const id = '10000000-0000-4000-8000-00000000000a';
describe('问题库 URL 与显式表单合同', () => {
  it('规范化可恢复维度，移除无效字段及默认值，并独立保留编辑身份', () => {
    const search = questionSearchSchema.parse({ q: '  替代  ', query_topic_id: id.toUpperCase(), intent_type: 'REPLACEMENT', mention_mode: 'UNBRANDED', language_code: 'zh-CN', region_code: 'cn', priority: 'CORE', is_active: 'false', sort: 'TEXT_ASC', page: '2', page_size: '50', selected: id.toUpperCase(), unknown: 'discard' });
    expect(search).toEqual({ q: '替代', query_topic_id: id, intent_type: 'REPLACEMENT', mention_mode: 'UNBRANDED', language_code: 'zh-cn', region_code: 'CN', priority: 'CORE', is_active: false, sort: 'TEXT_ASC', page: 2, page_size: 50, selected: id });
    expect(questionSearchToParams(search)).toEqual({ q: '替代', query_topic_id: id, intent_type: 'REPLACEMENT', mention_mode: 'UNBRANDED', language_code: 'zh-cn', region_code: 'CN', priority: 'CORE', is_active: false, sort: 'TEXT_ASC', page: 2, page_size: 50 });
    expect(questionSearchSchema.parse({ selected: 'bad', mention_mode: 'guessed', language_code: '?', region_code: 'invalid', page: '1', page_size: '20', sort: 'UPDATED_DESC' })).toEqual({});
    expect(questionSearchSchema.parse({ q: 'a'.repeat(240) }).q).toHaveLength(240);
    expect(questionSearchToParams({ new: 1, copy: id })).toEqual({ page: 1, page_size: 20, sort: 'UPDATED_DESC' });
  });
  it('新建和复制优先级明确，筛选改变不切换草稿身份', () => {
    expect(questionEditorIdentity(questionSearchSchema.parse({ new: 1, selected: id, copy: id }))).toBe('new');
    expect(questionEditorIdentity(questionSearchSchema.parse({ copy: id, selected: id }))).toBe(`copy:${id}`);
    expect(shouldBlockQuestionNavigation({ pathname: '/geo/questions', search: { selected: id } }, { pathname: '/geo/questions', search: { selected: id, q: '新筛选' } })).toBe(false);
    expect(shouldBlockQuestionNavigation({ pathname: '/geo/questions', search: { selected: id } }, { pathname: '/geo/questions', search: { copy: id } })).toBe(true);
  });
  it('文本不产生点名或优先级默认值，用户选择是 payload 权威', () => {
    const values = { ...questionValues(), query_topic_id: id, prompt_text: 'PartSignal 产品的替代型号有哪些？', language_code: 'zh-CN', region_code: 'CN' };
    expect(questionFormSchema.safeParse(values).success).toBe(false);
    const explicit = { ...values, mention_mode: 'UNBRANDED' as const, priority: 'EXPLORATORY' as const };
    expect(questionCreate(explicit).mention_mode).toBe('UNBRANDED');
    expect(questionCreate({ ...explicit, prompt_text: '换成没有品牌的文本' }).mention_mode).toBe('UNBRANDED');
  });
});
