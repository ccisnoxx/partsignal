import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }));
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function expectSecretsAbsent(directory: string, secrets: readonly string[]): Promise<void> {
  for (const file of await listFiles(directory)) {
    const content = await readFile(file);
    if (secrets.some((secret) => content.includes(Buffer.from(secret)))) {
      throw new Error(`敏感值进入 Playwright 测试产物：${path.relative(directory, file)}`);
    }
  }
}

export { expectSecretsAbsent };
