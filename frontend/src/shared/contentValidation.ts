/** 统一人工首稿与人工修订的标签校验和服务端字段错误识别。 */
import { ApiError } from './api/client';

export const CONTENT_TAG_ERROR = '请至少添加一个非空标签';

export function hasValidContentTags(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((tag) => typeof tag === 'string' && tag.trim().length > 0);
}

export const contentTagRules = [{
  required: true,
  validator: (_rule: unknown, value: unknown) => hasValidContentTags(value)
    ? Promise.resolve()
    : Promise.reject(new Error(CONTENT_TAG_ERROR)),
}];

export function isContentTagsValidationError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return false;
  const issues = error.details.errors;
  return Array.isArray(issues) && issues.some((issue) => {
    if (typeof issue !== 'object' || issue === null || !('loc' in issue)) return false;
    const location = issue.loc;
    return Array.isArray(location) && location[0] === 'body' && location[1] === 'tags';
  });
}
