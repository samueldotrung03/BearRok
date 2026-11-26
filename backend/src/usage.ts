// Usage tracking: what students do in the app, added up into the numbers that show whether they
// come back and act on what the agents find.
//
// One row per thing that happened: a day a signed-in student used the app, a save, like, dislike,
// open or apply, and a finished agent run. A student is stored under a one-way code made from
// their account id, never a name, an email or anything from their profile. The rows live in the
// same Postgres database as the shared opportunities table.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import type { StudentMemory } from './agents/types.ts';
import type { Sql } from './opportunities/db.ts';
import type { Store } from './store/index.ts';
import { canonicalUrl } from './validate.ts';

/** Whether the action was on a real posting, an invented sample, or one the memory no longer holds. */
export type UsageData = 'live' | 'sample' | 'unknown';

export interface UsageEvent {
  /** Names the event, so the same one read twice from a memory is stored once. */
  key: string;
  student: string;
  action: 'visit' | 'save' | 'like' | 'dislike' | 'open' | 'apply' | 'run';
  /** The posting's link for a reaction, the run's number for a run, the day for a visit. */
  subject: string;
  data: UsageData;
  /** Postings added to the feed, for a run. 1 for everything else. */
  amount: number;
  at: string;
}

export interface UsageSummary {
  asOf: string;
  /** Signed-in students with any row at all. */
  students: number;
  /** Students who used the app in the last 7 and the last 30 days. */
  activeThisWeek: number;
  activeThisMonth: number;
  /**
   * Of the students whose first day was at least 14 days ago, how many came back in their second
   * week (days 7 to 13 after the first). The rate is null until someone is that old.
   */
  weekTwoReturn: { eligible: number; returned: number; rate: number | null };
  /**
   * Real postings only. found: added to feeds by live runs. saved and applied: one per student
   * and posting. appliedPerSaved counts only applications to postings that student had saved.
   */
  postings: { found: number; saved: number; applied: number; savedPerFound: number | null; appliedPerSaved: number | null };
  /** How many times each thing happened, apart for real postings, samples and unknown. */
  actions: Record<UsageData, Record<string, number>>;
}

const SCHEMA = `
create table if not exists usage_events (
  key     text primary key,
  student text not null,
  action  text not null,
  subject text not null,
  data    text not null,
  amount  integer not null default 1,
  at      timestamptz not null,
  day     date not null
);
create index if not exists usage_events_action_day on usage_events (action, day);
create index if not exists usage_events_student on usage_events (student)
`;

const isGuest = (id: string) => id.startsWith('guest:');
/** The code a student is stored under. The account id cannot be read back out of it. */
export const anonymous = (id: string) => createHash('sha256').update(`bearrok-usage:${id}`).digest('hex').slice(0, 24);
const valid = (at: string | null | undefined): at is string => Boolean(at) && !Number.isNaN(Date.parse(at!));
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

/**
 * The events a student's memory holds: every reaction in it and every finished run. Guests share
 * one memory between everyone who is not signed in, so they are not counted.
 */
export function eventsIn(id: string, memory: StudentMemory): UsageEvent[] {
  if (isGuest(id)) return [];
  const student = anonymous(id);
  const learned = memory.learned;
  const postings = new Map((learned?.opportunities ?? []).map((o) => [o.id, o]));
  const events: UsageEvent[] = [];
  for (const i of learned?.interactions ?? []) {
    if (!valid(i.at)) continue;
    const posting = postings.get(i.opportunityId);
    events.push({
      key: `${student}|${i.action}|${i.opportunityId}|${i.at}`,
      student,
      action: i.action,
      subject: (posting && canonicalUrl(posting.sourceUrl)) || i.opportunityId,
      data: !posting ? 'unknown' : posting.origin === 'live' ? 'live' : 'sample',
      amount: 1,
      at: i.at,
    });
  }
  const last = learned?.lastRun;
  for (const run of learned?.runs ?? []) {
    if (run.status === 'running' || !valid(run.finishedAt)) continue;
    // Only the latest run says whether it was live; an older outline does not.
    const mode = last && last.number === run.number && last.startedAt === run.startedAt ? last.mode : null;
    events.push({
      key: `${student}|run|${run.number}|${run.startedAt}`,
      student,
      action: 'run',
      subject: String(run.number),
      data: mode === 'live' ? 'live' : mode === 'simulated' ? 'sample' : 'unknown',
      amount: run.stats?.added ?? 0,
      at: run.finishedAt,
    });
  }
  return events;
}

export class UsageLog {
  private sql: Sql;
  /** Events already stored by this process, so an unchanged memory costs no query. */
  private written = new Set<string>();
  private last: Promise<unknown> = Promise.resolve();
  private told = false;
  private report: (message: string) => void;

  private constructor(sql: Sql, report: (message: string) => void) {
    this.sql = sql;
    this.report = report;
  }

  /** Creates the table if this database has none yet. */
  static async open(sql: Sql, report: (message: string) => void = console.error): Promise<UsageLog> {
    for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await sql.query(statement);
    return new UsageLog(sql, report);
  }

  /** Stores the events not stored before. Returns how many rows were sent. */
  async record(events: UsageEvent[]): Promise<number> {
    const fresh = events.filter((e) => !this.written.has(e.key));
    for (let i = 0; i < fresh.length; i += 200) {
      const batch = fresh.slice(i, i + 200);
      const params: unknown[] = [];
      const rows = batch.map((e) => {
        params.push(e.key, e.student, e.action, e.subject, e.data, e.amount, e.at, e.at.slice(0, 10));
        const n = params.length;
        return `($${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
      });
      await this.sql.query(`insert into usage_events (key, student, action, subject, data, amount, at, day) values ${rows.join(', ')} on conflict (key) do nothing`, params);
      for (const e of batch) this.written.add(e.key);
    }
    return fresh.length;
  }

  /**
   * Stores events without making the caller wait, one write at a time in the order they came.
   * A problem with the database is reported once and never reaches the student.
   */
  queue(events: UsageEvent[]): void {
    if (!events.some((e) => !this.written.has(e.key))) return;
    this.last = this.last
      .then(() => this.record(events))
      .then(
        () => (this.told = false),
        (e) => {
          if (!this.told) this.report(`could not write usage: ${e instanceof Error ? e.message : e}`);
          this.told = true;
        },
      );
  }

  /** A signed-in student used the app today. Counted once a day (days are in UTC). */
  visit(id: string, now = new Date()): void {
    if (isGuest(id)) return;
    const student = anonymous(id);
    const at = now.toISOString();
    const day = at.slice(0, 10);
    this.queue([{ key: `${student}|visit|${day}`, student, action: 'visit', subject: day, data: 'live', amount: 1, at }]);
  }

  /** Removes everything stored about a student, for when they delete their account. */
  forget(id: string): void {
    const student = anonymous(id);
    this.last = this.last
      .then(() => this.sql.query('delete from usage_events where student = $1', [student]))
      .then(
        () => {
          for (const key of this.written) if (key.startsWith(`${student}|`)) this.written.delete(key);
        },
        (e) => this.report(`could not remove a student's usage: ${e instanceof Error ? e.message : e}`),
      );
  }

  /** Resolves when everything queued so far has been written or reported. */
  idle(): Promise<unknown> {
    return this.last;
  }

  async summary(now = new Date()): Promise<UsageSummary> {
    const today = now.toISOString().slice(0, 10);
    const row = async <T>(text: string, params: unknown[] = []) => (await this.sql.query<T>(text, params)).rows;
    type N = number | string;
    const [all] = await row<{ n: N }>('select count(distinct student) as n from usage_events');
    const [active] = await row<{ week: N; month: N }>(
      `select count(distinct student) filter (where day > $1::date - 7) as week,
              count(distinct student) filter (where day > $1::date - 30) as month
       from usage_events where action = 'visit' and day <= $1::date`,
      [today],
    );
    const [back] = await row<{ eligible: N; returned: N }>(
      `with first as (select student, min(day) as d0 from usage_events where action = 'visit' group by student)
       select count(*) filter (where d0 <= $1::date - 14) as eligible,
              count(*) filter (where d0 <= $1::date - 14 and exists (
                select 1 from usage_events e where e.student = first.student and e.action = 'visit' and e.day between first.d0 + 7 and first.d0 + 13
              )) as returned
       from first`,
      [today],
    );
    const pairs = (action: string) => `select distinct student, subject from usage_events where action = '${action}' and data = 'live'`;
    const [posts] = await row<{ found: N; saved: N; applied: N; both: N }>(
      `select (select coalesce(sum(amount), 0) from usage_events where action = 'run' and data = 'live') as found,
              (select count(*) from (${pairs('save')}) s) as saved,
              (select count(*) from (${pairs('apply')}) a) as applied,
              (select count(*) from (${pairs('apply')} intersect ${pairs('save')}) b) as both`,
    );
    const counted = await row<{ action: string; data: UsageData; n: N }>('select action, data, count(*) as n from usage_events group by action, data');
    const actions: UsageSummary['actions'] = { live: {}, sample: {}, unknown: {} };
    for (const r of counted) (actions[r.data] ?? actions.unknown)[r.action] = Number(r.n);
    const eligible = Number(back?.eligible ?? 0);
    const returned = Number(back?.returned ?? 0);
    const found = Number(posts?.found ?? 0);
    const saved = Number(posts?.saved ?? 0);
    return {
      asOf: now.toISOString(),
      students: Number(all?.n ?? 0),
      activeThisWeek: Number(active?.week ?? 0),
      activeThisMonth: Number(active?.month ?? 0),
      weekTwoReturn: { eligible, returned, rate: rate(returned, eligible) },
      postings: { found, saved, applied: Number(posts?.applied ?? 0), savedPerFound: rate(saved, found), appliedPerSaved: rate(Number(posts?.both ?? 0), saved) },
      actions,
    };
  }
}

type Memory = Pick<Store, 'loadStudent' | 'saveStudent' | 'deleteStudent'>;

/**
 * Every time a student's memory is saved, the reactions and runs in it are also written to the
 * usage table. The save never waits on that. Deleting the student removes their rows too.
 */
export function trackUsage(memory: Memory, usage: UsageLog): Memory {
  return {
    loadStudent: (id) => memory.loadStudent(id),
    saveStudent: (id: string, m: StudentMemory) => {
      usage.queue(eventsIn(id, m));
      return memory.saveStudent(id, m);
    },
    deleteStudent: (id) => {
      if (!isGuest(id)) usage.forget(id);
      return memory.deleteStudent(id);
    },
  };
}

const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/**
 * GET /api/metrics, for the team only: it answers a request that carries METRICS_TOKEN in the
 * Authorization header, and nobody when no token is set.
 */
export function mountMetrics(app: Hono, usage: UsageLog, token: string | null) {
  app.get('/api/metrics', async (c) => {
    if (!token) return c.json({ error: 'usage numbers are off on this server: METRICS_TOKEN is not set' }, 404);
    const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!same(given, token)) return c.json({ error: 'not allowed' }, 401);
    return c.json(await usage.summary());
  });
}
