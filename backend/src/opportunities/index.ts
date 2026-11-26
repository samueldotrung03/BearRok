// Opens the shared opportunities table and feeds it from the students' memories.
import type { StudentMemory } from '../agents/types.ts';
import type { Store } from '../store/index.ts';
import { openEmbedded, openServer } from './db.ts';
import { OpportunityCatalog } from './store.ts';

export { mountOpportunities } from './api.ts';
export { OpportunityCatalog } from './store.ts';

/** DATABASE_URL names a hosted Postgres; without it the table is kept in `dir` on this computer. */
export async function openCatalog(url: string | null, dir: string): Promise<OpportunityCatalog> {
  return OpportunityCatalog.open(url ? await openServer(url) : await openEmbedded(dir));
}

type Memory = Pick<Store, 'loadStudent' | 'saveStudent' | 'deleteStudent'>;

/**
 * Every time a student's memory is saved, the postings in it are also written to the shared
 * table. The student's save never waits on the table and never fails because of it: a problem
 * there is reported once and the postings go in with the next save.
 */
export function feedCatalog(memory: Memory, catalog: OpportunityCatalog, report: (message: string) => void = console.error): Memory {
  let told = false;
  let last: Promise<unknown> = Promise.resolve();
  return {
    loadStudent: (id) => memory.loadStudent(id),
    deleteStudent: (id) => memory.deleteStudent(id),
    saveStudent: (id: string, m: StudentMemory) => {
      const found = m.learned?.opportunities ?? [];
      // One write at a time, in the order the saves came.
      last = last
        .then(() => catalog.upsert(found))
        .then(
          () => (told = false),
          (e) => {
            if (!told) report(`could not write to the shared opportunities table: ${e instanceof Error ? e.message : e}`);
            told = true;
          },
        );
      return memory.saveStudent(id, m);
    },
  };
}
