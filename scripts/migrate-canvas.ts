import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { migrateLegacy } from '../src/domain/migrate';

type Arguments = { input?: string; output?: string; workspaceId?: string };

function argumentsFrom(argv: string[]): Arguments {
  const result: Arguments = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!value || !['--input', '--output', '--workspace-id'].includes(flag)) throw new Error('Usage: migrate-canvas --input <legacy.json> --output <baseline.json> --workspace-id <id>');
    if (flag === '--input') result.input = value;
    if (flag === '--output') result.output = value;
    if (flag === '--workspace-id') result.workspaceId = value;
  }
  if (!result.input || !result.output || !result.workspaceId) throw new Error('Usage: migrate-canvas --input <legacy.json> --output <baseline.json> --workspace-id <id>');
  return result;
}

async function main(): Promise<void> {
  const args = argumentsFrom(process.argv.slice(2));
  const input = resolve(args.input!); const output = resolve(args.output!);
  if (input === output) throw new Error('Refusing to overwrite --input; choose a different --output path');
  const legacy = JSON.parse(await readFile(input, 'utf8')) as unknown;
  const baseline = migrateLegacy(legacy, args.workspaceId!);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`Migrated ${baseline.screens.length} screens, ${baseline.notes.length} notes, and ${baseline.journeys.length} journeys to ${output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
