// The For You poster: the presentation agent's design is kept only where its facts are backed by
// the posting or the flyer, and every card with a settled picture gets one, with the flyer read.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ImageFinder, ImageSubject } from '../src/agents/images.ts';
import { checkPoster, type PosterDraft } from '../src/agents/poster.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Opportunity } from '../src/agents/types.ts';

const NOW = new Date('2026-11-19T12:00:00Z');

const posting = (over: Partial<Opportunity> = {}): Opportunity =>
  ({
    id: 'p1', type: 'hackathon', title: 'Infer-a-thon with Superlinked', organizer: 'Superlinked', sourceUrl: 'https://superlinked.com/', actionUrl: null,
    format: 'online', location: null, field: 'AI', tags: [], eligibility: null, eligibleYears: null, deadline: '2026-12-05T23:59:00Z', startTime: null,
    image: null, evidence: [], origin: 'live', fitExplanation: 'Online AI hackathon.', unknowns: [], foundAt: '', lastCheckedAt: '', baseScore: 0.8,
    foundBy: 'm1', alsoSeenAt: [], application: null, ...over,
  }) as Opportunity;

const draft = (over: Partial<PosterDraft> = {}): PosterDraft => ({
  layout: 'flyer', typeface: 'sans', uppercase: false, details: 'boxed', arrangement: 'image-top', art: { x: 0.5, y: 0, w: 0.5, h: 0.6 }, palette: { background: '#1f1e2a', text: '#ffffff', accent: '#f4471f' },
  kicker: '7-DAY ONLINE HACKATHON', headline: 'Infer-a-thon', headlineAccent: 'with Superlinked', pitch: 'Build AI apps with small open models.',
  highlight: 'small open models', stats: [{ value: '$1,500', label: 'Prize pool' }, { value: 'Dec 5', label: 'Deadline' }], chips: ['100% online'],
  badge: 'REGISTRATIONS OPEN', focus: 'top', flyerText: '7-DAY ONLINE HACKATHON Infer-a-thon $1,500 PRIZE POOL Dec 5 DEADLINE 100% ONLINE', ...over,
});

test('poster: facts printed on the flyer the agent read are kept', () => {
  const p = checkPoster(draft(), posting(), true);
  assert.deepEqual(p.stats.map((s) => s.value), ['$1,500', 'Dec 5']);
  assert.equal(p.kicker, '7-DAY ONLINE HACKATHON');
  assert.deepEqual(p.chips, ['100% online']);
  assert.equal(p.layout, 'flyer');
  assert.equal('flyerText' in p, false, 'the transcript stays on the backend');
});

test('poster: a prize, date or number found in neither the posting nor the flyer is left off', () => {
  const p = checkPoster(draft({ stats: [{ value: '$5,000', label: 'Prize pool' }, { value: 'Dec 5', label: 'Deadline' }, { value: 'Jan 9', label: 'Demo day' }], chips: ['Teams of 2-4', '100% online'], badge: '48 HOURS' }), posting(), true);
  assert.deepEqual(p.stats.map((s) => s.value), ['Dec 5'], 'the deadline is the posting\'s own; the prize and demo day are invented');
  assert.deepEqual(p.chips, ['100% online']);
  assert.equal(p.badge, null);
});

test('poster: without a flyer read, its transcript backs nothing and the flyer layout is not used', () => {
  const p = checkPoster(draft(), posting(), false);
  assert.deepEqual(p.stats.map((s) => s.value), ['Dec 5'], 'only the posting\'s own deadline');
  assert.equal(p.layout, 'bold');
});

test('poster: the picture crop is kept inside the picture, and a sliver is dropped', () => {
  assert.deepEqual(checkPoster(draft({ art: { x: 0.6, y: -0.2, w: 0.8, h: 0.5 } }), posting(), true).art, { x: 0.6, y: 0, w: 0.4, h: 0.5 });
  assert.equal(checkPoster(draft({ art: { x: 0, y: 0, w: 0.05, h: 1 } }), posting(), true).art, null);
  assert.equal(checkPoster(draft({ art: null }), posting(), true).art, null);
});

test('poster: bad colours are replaced and long lines are cut to the poster\'s room', () => {
  const p = checkPoster(draft({ palette: { background: 'navy', text: '#fff', accent: '#ff0000' }, headline: 'A'.repeat(80) }), posting(), true);
  assert.match(p.palette.background, /^#[0-9a-f]{6}$/i);
  assert.match(p.palette.text, /^#[0-9a-f]{6}$/i);
  assert.equal(p.palette.accent, '#ff0000');
  assert.ok(p.headline.length <= 40);
});

test('poster: every card with its picture gets a poster, and the presentation agent reads the event\'s flyer', async () => {
  const flyers: (string | null)[] = [];
  const saved: string[] = [];
  class Designer extends SimBrain {
    override async designPoster(o: Opportunity, flyer: string | null) {
      flyers.push(flyer);
      if (flyer) assert.ok(existsSync(flyer), 'the flyer is on disk while the agent reads it');
      return draft({ headline: o.title.slice(0, 30), stats: [], chips: [], badge: null, kicker: '', flyerText: null });
    }
  }
  const finder = {
    find: async (o: ImageSubject) => ({ url: `https://pictures.example.org/${encodeURIComponent(o.title)}.jpg`, kind: 'event' as const, credit: null, creditUrl: null }),
    download: async () => {
      const file = join(tmpdir(), `poster-test-${saved.length}-${process.pid}.jpg`);
      writeFileSync(file, 'x');
      saved.push(file);
      return file;
    },
  } as unknown as ImageFinder;
  const s = new AgentSystem(new Designer({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, images: finder });
  await s.trigger('first');
  const feed = s.student().feed.map((f) => f.opportunity);
  assert.ok(feed.length > 0);
  assert.ok(feed.every((o) => o.poster && o.poster.headline), 'every card has a poster');
  assert.ok(flyers.length >= feed.length && flyers.every((f) => f !== null), 'the flyer was given to the agent');
  assert.ok(saved.every((f) => !existsSync(f)), 'each flyer file is deleted afterwards');

  // Stored cards from before posters existed get one straight away, without a search.
  const memory = JSON.parse(JSON.stringify(s.memorySnapshot()));
  for (const o of memory.learned.opportunities) {
    delete o.poster;
    delete o.posterTriedAt;
  }
  const next = new AgentSystem(new Designer({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, images: finder });
  next.restore(memory);
  await next.fillPictures();
  assert.ok(next.student().feed.every((f) => f.opportunity.poster), 'filled in on load');
  assert.equal(next.student().runCount, s.student().runCount, 'no search was run');

  // A poster designed before the picture was part of it (no arrangement) is designed again.
  const older = JSON.parse(JSON.stringify(next.memorySnapshot()));
  for (const o of older.learned.opportunities) delete o.poster.arrangement;
  flyers.length = 0;
  const again = new AgentSystem(new Designer({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, images: finder });
  again.restore(older);
  await again.fillPictures();
  assert.ok(again.student().feed.every((f) => f.opportunity.poster?.arrangement === 'image-top'), 'redesigned with the picture placed');
  assert.ok(flyers.length > 0);
});

test('poster: the simulated agents design none, and the card is asked again only a day later', async () => {
  const finder = { find: async () => ({ url: 'https://pictures.example.org/x.jpg', kind: 'logo' as const, credit: null, creditUrl: null }) } as unknown as ImageFinder;
  const s = new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, images: finder });
  await s.trigger('first');
  const feed = s.student().feed.map((f) => f.opportunity);
  assert.ok(feed.length > 0 && feed.every((o) => o.poster === null && o.posterTriedAt), 'no poster, and the try is recorded');
});

/** A plain 200 x 100 PNG, so the crop has a real picture to cut. */
function png(width = 200, height = 100): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('poster: the part of the flyer shown is cut out and checked, and moved when it shows printed words', { skip: process.platform !== 'darwin' && 'cutting pictures uses macOS sips' }, async () => {
  const reviews: { box: { x: number; y: number; w: number; h: number }; part: string }[] = [];
  class Reviewer extends SimBrain {
    override async designPoster() {
      return draft({ art: { x: 0, y: 0, w: 1, h: 0.4 }, stats: [], chips: [], badge: null, kicker: '', flyerText: null });
    }
    override async reviewPosterArt(_full: string, part: string, box: { x: number; y: number; w: number; h: number }) {
      assert.ok(existsSync(part), 'the cut-out part is on disk while it is checked');
      reviews.push({ box, part });
      // First look: the top strip is the flyer's printed title; the illustration is lower right.
      return box.y === 0 ? { hasWords: true, cutsSubject: false, mostlyEmpty: false, art: { x: 0.5, y: 0.4, w: 0.5, h: 0.6 } } : { hasWords: false, cutsSubject: false, mostlyEmpty: false, art: box };
    }
  }
  const finder = {
    find: async () => ({ url: 'https://pictures.example.org/flyer.png', kind: 'event' as const, credit: null, creditUrl: null }),
    download: async () => {
      const file = join(tmpdir(), `poster-review-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
      writeFileSync(file, png());
      return file;
    },
  } as unknown as ImageFinder;
  const s = new AgentSystem(new Reviewer({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, images: finder });
  await s.trigger('first');
  const feed = s.student().feed.map((f) => f.opportunity);
  assert.ok(feed.length > 0);
  assert.ok(feed.every((o) => JSON.stringify(o.poster?.art) === JSON.stringify({ x: 0.5, y: 0.4, w: 0.5, h: 0.6 })), 'moved off the printed words');
  assert.equal(reviews.filter((r) => r.box.y === 0).length, feed.length, 'each first choice was checked');
  assert.equal(reviews.filter((r) => r.box.y === 0.4).length, feed.length, 'and each new part was checked too');
  assert.ok(reviews.every((r) => !existsSync(r.part)), 'cut-out parts are deleted');
});

test('icon: a card with no logo gets an icon drawn in its flyer\'s style; a logo card gets none; an unsafe drawing is refused', async () => {
  const asked: { title: string; flyer: string | null; palette: unknown }[] = [];
  class Drawer extends SimBrain {
    override async designPoster(o: Opportunity) {
      return draft({ headline: o.title.slice(0, 30), stats: [], chips: [], badge: null, kicker: '', flyerText: null });
    }
    override async drawIcon(o: Opportunity, palette: unknown, flyer: string | null) {
      asked.push({ title: o.title, flyer, palette });
      if (flyer) assert.ok(existsSync(flyer), 'the flyer is on disk while the icon is drawn');
      return asked.length === 1 ? '<svg viewBox="0 0 512 512"><script>alert(1)</script></svg>' : '<svg viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b2a6b"/></svg>';
    }
  }
  let n = 0;
  const finder = {
    find: async () => ({ url: `https://pictures.example.org/${n++}.jpg`, kind: n % 2 ? ('event' as const) : ('logo' as const), credit: null, creditUrl: null }),
    download: async () => {
      const file = join(tmpdir(), `icon-test-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
      writeFileSync(file, 'x');
      return file;
    },
  } as unknown as ImageFinder;
  const s = new AgentSystem(new Drawer({ speed: 0, now: () => NOW }), { now: () => NOW, feedTarget: 0, images: finder });
  await s.trigger('first');
  const feed = s.student().feed.map((f) => f.opportunity);
  const logos = feed.filter((o) => o.imageKind === 'logo');
  const others = feed.filter((o) => o.imageKind !== 'logo');
  assert.ok(logos.length > 0 && others.length > 0);
  assert.ok(logos.every((o) => o.icon === undefined), 'a logo card is not given an icon');
  assert.equal(asked.length, others.length, 'one icon asked for per card with no logo');
  assert.ok(asked.every((a) => a.flyer !== null && a.palette), 'drawn with the flyer and the poster\'s colours');
  assert.equal(others.filter((o) => o.icon === null).length, 1, 'the drawing with a script was refused');
  assert.ok(others.filter((o) => o.icon).every((o) => o.icon!.startsWith('data:image/svg+xml;base64,')));
});
