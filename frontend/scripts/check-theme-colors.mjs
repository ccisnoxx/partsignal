/** 阻止业务代码重新引入绕过项目语义主题 Token 的颜色。 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../src/', import.meta.url);
const allowed = new Set(['app/theme.ts']);
const colorPattern = /#[0-9a-f]{3,8}\b|rgba?\s*\(/i;
const sourceExtensions = new Set(['.css', '.ts', '.tsx']);
const violations = [];

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (sourceExtensions.has(extname(entry.name))) {
      const name = relative(root.pathname, path);
      if (allowed.has(name)) continue;
      const lines = (await readFile(path, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (colorPattern.test(line)) violations.push(`${name}:${index + 1}: ${line.trim()}`);
      });
    }
  }
}

await inspect(root.pathname);
if (violations.length) {
  console.error(`发现绕过主题 Token 的颜色：\n${violations.join('\n')}`);
  process.exitCode = 1;
}
