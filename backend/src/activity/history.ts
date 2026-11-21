// Where run reports are kept: the last HISTORY_LIMIT per student. The server keeps them in a small
// JSON file beside the local store; tests keep them in memory.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HISTORY_LIMIT, type RunReport } from './types.ts';

export interface RunHistory {
  /** Newest first. */
  list(key: string): RunReport[];
  add(key: string, report: RunReport): void;
}

/** Newest first, one per run (same id and start), at most HISTORY_LIMIT. */
export function keep(list: RunReport[]): RunReport[] {
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .filter((r) => {
      const id = `${r.id}@${r.startedAt}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, HISTORY_LIMIT);
}

export class MemoryRunHistory implements RunHistory {
  protected data: Record<string, RunReport[]> = {};
  list(key: string) {
    return this.data[key] ?? [];
  }
  add(key: string, report: RunReport) {
    this.data[key] = keep([report, ...this.list(key)]);
    this.changed();
  }
  protected changed() {}
}

export class FileRunHistory extends MemoryRunHistory {
  private file: string;
  constructor(file: string) {
    super();
    this.file = file;
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      // A damaged file is not fatal: history starts again, and the next run rewrites it.
      console.error(`could not read run history ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  protected changed() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      console.error(`could not save run history ${this.file}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
