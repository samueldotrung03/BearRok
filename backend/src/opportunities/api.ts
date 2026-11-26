// Read access to the shared opportunities table, under /api/opportunities.
import type { Hono } from 'hono';
import type { OpportunityCatalog, OpportunityQuery } from './store.ts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: string | undefined) => (value && DAY.test(value) ? value : undefined);
const whole = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : undefined);

export function mountOpportunities(app: Hono, catalog: OpportunityCatalog) {
  // ?q=words &type=internship &origin=live|prepared|all &deadlineFrom=YYYY-MM-DD &deadlineTo= &limit= &offset=
  app.get('/api/opportunities', async (c) => {
    const p = c.req.query();
    const query: OpportunityQuery = {
      q: p.q,
      type: p.type,
      origin: p.origin === 'prepared' || p.origin === 'all' ? p.origin : 'live',
      deadlineFrom: day(p.deadlineFrom),
      deadlineTo: day(p.deadlineTo),
      limit: whole(p.limit),
      offset: whole(p.offset),
    };
    return c.json(await catalog.list(query));
  });

  app.get('/api/opportunities/counts', async (c) => c.json(await catalog.counts()));
}
