// The shared opportunities table: one row per posting, whichever student's agents found it.
//
// A student's memory keeps the postings in their own feed, with their match score and the reason
// it fits them. This table keeps only what is true of the posting itself, once, under its link,
// so it can be filtered and searched across every student.
import type { Opportunity } from '../agents/types.ts';
import { canonicalUrl } from '../validate.ts';
import type { Sql } from './db.ts';

/** A posting as the table holds it: the facts on the page, with nothing about any one student. */
export type SharedOpportunity = Omit<Opportunity, 'fitExplanation' | 'baseScore' | 'match' | 'foundBy' | 'unknowns'>;

export interface OpportunityQuery {
  /** Words to look for in the title, organizer, field, location, tags and description. */
  q?: string;
  type?: string;
  /** "live" postings were read from real pages; "prepared" ones are invented samples. */
  origin?: 'live' | 'prepared' | 'all';
  /** Dates as YYYY-MM-DD. A posting with no known deadline matches neither. */
  deadlineFrom?: string;
  deadlineTo?: string;
  limit?: number;
  offset?: number;
}

const SCHEMA = `
create table if not exists opportunities (
  url             text primary key,
  source_url      text,
  action_url      text,
  description     text,
  id              text not null,
  origin          text not null,
  type            text not null,
  title           text not null,
  organizer       text not null,
  location        text,
  field           text,
  format          text,
  tags            text[] not null default '{}',
  deadline        date,
  search_text     text not null,
  record          jsonb not null,
  first_seen_at   timestamptz not null,
  last_checked_at timestamptz not null
);
alter table opportunities add column if not exists source_url text;
alter table opportunities add column if not exists action_url text;
alter table opportunities add column if not exists description text;
create index if not exists opportunities_type on opportunities (type);
create index if not exists opportunities_deadline on opportunities (deadline);
create index if not exists opportunities_search on opportunities using gin (to_tsvector('english', search_text));
`;

const DAY = /^\d{4}-\d{2}-\d{2}/;
/** The day of a deadline, when it is written as a date. Anything else is kept only in the record. */
const dayOf = (deadline: string | null) => (deadline && DAY.test(deadline) && !Number.isNaN(Date.parse(deadline.slice(0, 10))) ? deadline.slice(0, 10) : null);

const instant = (value: string | undefined, fallback: Date) => {
  const t = value ? Date.parse(value) : NaN;
  return new Date(Number.isNaN(t) ? fallback : t).toISOString();
};

/** Drops what belongs to one student, leaving the posting. */
export function shared(o: Opportunity): SharedOpportunity {
  const { fitExplanation: _fit, baseScore: _score, match: _match, foundBy: _by, unknowns: _unknowns, ...posting } = o;
  return posting;
}

export class OpportunityCatalog {
  private sql: Sql;
  /** What was last written for each link, so an unchanged posting costs no query. */
  private written = new Map<string, string>();

  private constructor(sql: Sql) {
    this.sql = sql;
  }

  /** Creates the table if this database has none yet. */
  static async open(sql: Sql): Promise<OpportunityCatalog> {
    for (const statement of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await sql.query(statement);
    return new OpportunityCatalog(sql);
  }

  get where() {
    return this.sql.where;
  }

  /**
   * Adds postings, or refreshes the ones already there. A posting is known by its link, so the
   * same one found for two students is one row. An older copy never replaces a newer check.
   * Returns how many rows were written.
   */
  async upsert(found: Opportunity[], now = new Date()): Promise<number> {
    let wrote = 0;
    for (const o of found) {
      const url = canonicalUrl(o.sourceUrl);
      if (!url || !o.title?.trim()) continue;
      const record = shared(o);
      const body = JSON.stringify(record);
      if (this.written.get(url) === body) continue;
      const search = [o.title, o.organizer, o.field, o.location, ...(o.tags ?? []), o.description].filter(Boolean).join(' ');
      await this.sql.query(
        `insert into opportunities (url, id, origin, type, title, organizer, location, field, format, tags, deadline, search_text, record, first_seen_at, last_checked_at, source_url, action_url, description)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         on conflict (url) do update set
           id = excluded.id, origin = excluded.origin, type = excluded.type, title = excluded.title,
           organizer = excluded.organizer, location = excluded.location, field = excluded.field,
           format = excluded.format, tags = excluded.tags, deadline = excluded.deadline,
           search_text = excluded.search_text, record = excluded.record, source_url = excluded.source_url,
           action_url = excluded.action_url, description = excluded.description,
           last_checked_at = excluded.last_checked_at
         where excluded.last_checked_at >= opportunities.last_checked_at`,
        [url, o.id, o.origin, o.type, o.title, o.organizer ?? '', o.location, o.field, o.format, o.tags ?? [], dayOf(o.deadline), search, body, instant(o.foundAt, now), instant(o.lastCheckedAt, now), o.sourceUrl, o.actionUrl, o.description ?? null],
      );
      this.written.set(url, body);
      wrote++;
    }
    return wrote;
  }

  /** Postings that match, soonest deadline first, then the most recently checked. Samples only when asked for. */
  async list(query: OpportunityQuery = {}): Promise<{ total: number; opportunities: SharedOpportunity[] }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };
    const origin = query.origin ?? 'live';
    if (origin !== 'all') add('origin = ?', origin);
    if (query.type) add('type = ?', query.type);
    if (query.q?.trim()) add(`to_tsvector('english', search_text) @@ websearch_to_tsquery('english', ?)`, query.q.trim());
    if (query.deadlineFrom) add('deadline >= ?', query.deadlineFrom);
    if (query.deadlineTo) add('deadline <= ?', query.deadlineTo);
    const filter = where.length ? `where ${where.join(' and ')}` : '';
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
    const count = await this.sql.query<{ n: number | string }>(`select count(*) as n from opportunities ${filter}`, params);
    const rows = await this.sql.query<{ record: SharedOpportunity | string }>(
      `select record from opportunities ${filter} order by deadline asc nulls last, last_checked_at desc, url asc limit ${limit} offset ${offset}`,
      params,
    );
    return {
      total: Number(count.rows[0]?.n ?? 0),
      opportunities: rows.rows.map((r) => (typeof r.record === 'string' ? JSON.parse(r.record) : r.record)),
    };
  }

  /** The posting stored under a link, whatever tracking the link carries. Null when it is not in the table. */
  async byUrl(link: string): Promise<SharedOpportunity | null> {
    const url = canonicalUrl(link);
    if (!url) return null;
    const { rows } = await this.sql.query<{ record: SharedOpportunity | string }>('select record from opportunities where url = $1', [url]);
    const record = rows[0]?.record;
    return record === undefined ? null : typeof record === 'string' ? JSON.parse(record) : record;
  }

  /** How many postings the table holds, by where they came from and by kind. */
  async counts(): Promise<{ live: number; prepared: number; byType: Record<string, number> }> {
    const { rows } = await this.sql.query<{ origin: string; type: string; n: number | string }>('select origin, type, count(*) as n from opportunities group by origin, type');
    const out = { live: 0, prepared: 0, byType: {} as Record<string, number> };
    for (const r of rows) {
      const n = Number(r.n);
      if (r.origin === 'live') {
        out.live += n;
        out.byType[r.type] = (out.byType[r.type] ?? 0) + n;
      } else out.prepared += n;
    }
    return out;
  }

  close() {
    return this.sql.close();
  }
}
