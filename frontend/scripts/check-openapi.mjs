/** 在临时目录重新生成 API 类型，验证提交产物与冻结 OpenAPI 一致。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'partsignal-openapi-'));
const generated = join(directory, 'schema.d.ts');

try {
  execFileSync(join(process.cwd(), 'node_modules/.bin/openapi-typescript'), ['../contracts/openapi.yaml', '-o', generated], { stdio: 'inherit' });
  const expected = readFileSync(join(process.cwd(), 'src/shared/api/schema.d.ts'), 'utf8');
  const actual = readFileSync(generated, 'utf8');
  if (actual !== expected) {
    throw new Error('OpenAPI 类型已漂移，请运行 npm run api:generate');
  }
  process.stdout.write('OpenAPI 类型与冻结契约一致。\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
