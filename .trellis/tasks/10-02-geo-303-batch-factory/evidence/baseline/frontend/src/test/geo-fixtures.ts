/** 测试专用同源语料；不是 API DTO，业务响应仍使用 generated OpenAPI 类型。 */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as unknown;
}

export function loadGeoFixtures() {
  // JSON Schema 与关系/敏感数据校验由 backend/tests/geo_fixtures.py 唯一拥有。
  // Node 测试运行时读取，避免前端构建依赖 Docker 上下文之外的文件。
  // 每次解析新对象；消费者须显式转换 unknown，不把测试数据当作 API DTO。
  return {
    corpus: readFixture('../../../backend/tests/fixtures/geo_analysis/v1/corpus.json'),
    gold: readFixture('../../../backend/tests/fixtures/geo_analysis/v1/gold/analysis.json'),
  };
}
