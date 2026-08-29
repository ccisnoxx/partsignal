/** 临时重新生成 API 类型，确保提交产物与根 OpenAPI 合同一致。 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const expected = join(process.cwd(), 'src/shared/api/generated/schema.d.ts');
const directory = mkdtempSync(join(tmpdir(), 'partsignal-v2-openapi-'));
const actual = join(directory, 'schema.d.ts');

try {
  if (!existsSync(expected)) {
    throw new Error('缺少 OpenAPI 生成类型，请先运行 npm run api:generate');
  }

  execFileSync(
    join(process.cwd(), 'node_modules/.bin/openapi-typescript'),
    ['../contracts/openapi.yaml', '-o', actual],
    { stdio: 'inherit' },
  );

  if (readFileSync(actual, 'utf8') !== readFileSync(expected, 'utf8')) {
    throw new Error('OpenAPI 类型已漂移，请运行 npm run api:generate');
  }

  process.stdout.write('OpenAPI 类型与根合同一致。\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
