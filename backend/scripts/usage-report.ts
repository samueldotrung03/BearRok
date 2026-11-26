// Prints the usage numbers: students, who came back, saves and applications.
// npm run usage:report            the numbers as they stand
// npm run usage:report -- --fill  first copies the reactions and runs already in the local student memories
// With no DATABASE_URL the database is a folder on this computer: stop the backend first, since
// only one program can have that folder open.
import { readFileSync } from 'node:fs';
import type { StudentMemory } from '../src/agents/types.ts';
import { config } from '../src/config.ts';
import { openDatabase } from '../src/opportunities/index.ts';
import { eventsIn, UsageLog } from '../src/usage.ts';

const sql = await openDatabase(config.opportunitiesDb.url, config.opportunitiesDb.dir);
const usage = await UsageLog.open(sql);
if (process.argv.includes('--fill')) {
  let students: Record<string, StudentMemory> = {};
  try {
    students = JSON.parse(readFileSync(config.localDataFile, 'utf8')).students ?? {};
  } catch {
    console.log(`no local memories at ${config.localDataFile}; nothing to copy`);
  }
  let sent = 0;
  for (const [id, memory] of Object.entries(students)) sent += await usage.record(eventsIn(id, memory));
  console.log(`copied ${sent} events from ${Object.keys(students).length} local memories (guests are not counted)`);
}
console.log(`usage in ${sql.where}`);
console.log(JSON.stringify(await usage.summary(), null, 2));
await sql.close();
