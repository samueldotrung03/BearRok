// Copies the postings already in the local student memories into the shared opportunities table.
// Run once after the table is set up:  npm run opportunities:backfill
import { readFileSync } from 'node:fs';
import type { StudentMemory } from '../src/agents/types.ts';
import { config } from '../src/config.ts';
import { openCatalog } from '../src/opportunities/index.ts';

let students: Record<string, StudentMemory> = {};
try {
  students = JSON.parse(readFileSync(config.localDataFile, 'utf8')).students ?? {};
} catch {
  console.log(`no local memories at ${config.localDataFile}; nothing to copy`);
}

const catalog = await openCatalog(config.opportunitiesDb.url, config.opportunitiesDb.dir);
let wrote = 0;
for (const memory of Object.values(students)) wrote += await catalog.upsert(memory.learned?.opportunities ?? []);
const counts = await catalog.counts();
console.log(`wrote ${wrote} postings from ${Object.keys(students).length} students to ${catalog.where}`);
console.log(`the table now holds ${counts.live} real postings and ${counts.prepared} samples`);
await catalog.close();
