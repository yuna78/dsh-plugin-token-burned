/** Host half: exposes token usage snapshots from DSH sessions. */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const name = 'dsh-token-burned';
export const inject = ['connection', 'sessionProjections'];
export const ROUTE = '/api/dsh-token-burned.snapshot';

const DAY = 86400000;
const HOUR = 3600000;
const MAX_AGE_DAYS = 30;
const KEEP_DAYS = 31;

const empty = () => ({ today: 0, recent30: 0, byModel: {}, byHour: Array(24).fill(0), days: Array(MAX_AGE_DAYS).fill(0), updatedAt: null, offsetMinutes: null });
const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const tokensOf = (u) => number(u?.inputTokens ?? u?.input_tokens) + number(u?.cacheReadTokens ?? u?.cache_read_tokens) + number(u?.cacheWriteTokens ?? u?.cache_write_tokens) + number(u?.outputTokens ?? u?.output_tokens);
const modelOf = (s, event) => event?.data?.model || event?.data?.modelId || s?.requestContext?.()?.model || s?.model || '当前模型';
const sessionIdOf = (s) => String(s?.id ?? s?.sessionId ?? s?.meta?.id ?? s?.session?.id ?? 'unknown');
const timeOf = (event) => {
  const value = event?.time ?? event?.timestamp ?? event?.data?.time;
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
const statePath = () => join(process.env.DSH_TOKEN_BURNED_STATE || process.env.DSH_HOME || join(process.env.HOME || process.cwd(), '.dsh'), 'storages', 'dsh-token-burned.json');
// Backfilled history lives beside the state file, not inside it. A running host
// rewrites the state file from its in-memory map on the next usage event, so a
// one-shot backfill could not survive being written while the host is up. The
// sidecar is only ever read (merged at startup), never rewritten by the host.
const baselinePath = () => statePath().replace(/\.json$/, '') + '.baseline.json';
const legacyStatePaths = () => [join(process.env.HOME || process.cwd(), 'dsh-token-burned.json'), join(process.env.XDG_STATE_HOME || '', 'dsh-token-burned.json')].filter(Boolean);

// --- Timezone -----------------------------------------------------------------
// "Today" and "which hour" belong to the *viewer*, not to this process. A host
// running with TZ=UTC bucketed hours as UTC while the browser labelled them as
// local time, so morning activity appeared under the wrong hour names. The
// client therefore sends its own UTC offset (`off`, minutes east of UTC) and the
// host buckets with it; `null` falls back to this process's timezone.
const clampOffset = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(-840, Math.min(840, Math.round(n)));
};
const hostOffsetAt = (ts) => -new Date(ts).getTimezoneOffset();
const resolveOffset = (requested, ts) => (requested === null ? hostOffsetAt(ts) : requested);
// With a fixed numeric offset every day is exactly 24h, so plain division is
// safe and DST can no longer move an entry into the wrong bucket.
const dayNumberOf = (ts, off) => Math.floor((ts + off * 60000) / DAY);
const hourNumberOf = (ts, off) => Math.floor(((ts + off * 60000) % DAY) / HOUR);

export function apply(ctx) {
  const stats = empty();
  // Entries are one provider settlement per session/turn/step. Keeping the
  // settlement (rather than adding every replay) makes retries and projection
  // replays idempotent, while allowing a later usage sample to replace it.
  const entries = new Map();
  const file = statePath();
  let loaded = false;
  let saveChain = Promise.resolve();
  let activeOffset = null;
  // Per-calendar-date totals for days that exist only in session transcripts.
  // Kept as ~30 numbers so the history is not a multi-megabyte entry dump; raw
  // entries (today) always win for the same day, so nothing is double counted.
  const baseline = {};
  const sidecar = baselinePath();
  // Both sources (state file, sidecar) are merged by "largest wins" so re-running
  // the backfill, or a stale sidecar next to a newer state file, is idempotent.
  const mergeBaseline = (source) => {
    if (!source || typeof source !== 'object') return;
    for (const [date, tokens] of Object.entries(source)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      baseline[date] = Math.max(number(baseline[date]), number(tokens));
    }
  };

  const prune = (now) => {
    const off = hostOffsetAt(now);
    const today = dayNumberOf(now, off);
    for (const [key, item] of entries) {
      const at = Date.parse(item.at);
      if (!Number.isFinite(at) || today - dayNumberOf(at, off) >= KEEP_DAYS) entries.delete(key);
    }
    const todayDate = new Date(now + off * 60000).toISOString().slice(0, 10);
    for (const date of Object.keys(baseline)) {
      const age = Math.round((Date.parse(todayDate) - Date.parse(date)) / DAY);
      if (!Number.isFinite(age) || age < 0 || age >= KEEP_DAYS) delete baseline[date];
    }
  };

  const rebuild = (requested) => {
    const now = Date.now();
    const off = resolveOffset(requested, now);
    const today = dayNumberOf(now, off);
    const next = empty();
    next.offsetMinutes = off;
    const hasRaw = new Array(MAX_AGE_DAYS).fill(false);
    for (const item of entries.values()) {
      const at = Date.parse(item.at);
      if (!Number.isFinite(at)) continue;
      const age = today - dayNumberOf(at, off);
      if (age < 0 || age >= MAX_AGE_DAYS) continue;
      const n = number(item.tokens);
      next.days[MAX_AGE_DAYS - 1 - age] += n;
      hasRaw[age] = true;
      if (age === 0) {
        next.today += n;
        next.byModel[item.model] = (next.byModel[item.model] || 0) + n;
        next.byHour[hourNumberOf(at, off)] += n;
      }
      next.updatedAt = next.updatedAt && next.updatedAt > item.at ? next.updatedAt : item.at;
    }
    // Days present only in session transcripts come from the per-day baseline.
    // A day with raw entries ignores its baseline, so nothing is counted twice.
    const todayDate = new Date(now + off * 60000).toISOString().slice(0, 10);
    for (const [date, tokens] of Object.entries(baseline)) {
      const parsed = Date.parse(date);
      if (!Number.isFinite(parsed)) continue;
      const age = Math.round((Date.parse(todayDate) - parsed) / DAY);
      if (age < 0 || age >= MAX_AGE_DAYS || hasRaw[age]) continue;
      const n = number(tokens);
      next.days[MAX_AGE_DAYS - 1 - age] = n;
      if (age === 0) next.today = n;
    }
    next.recent30 = next.days.reduce((sum, v) => sum + v, 0);
    Object.assign(stats, next);
    return next;
  };

  // Never serialise before history is loaded: the old code could write from a
  // fresh process whose Map held only the newest event, truncating every earlier
  // record on each restart. Writes are also atomic (tmp + rename) so an
  // interrupted write cannot destroy the previous file.
  const persist = () => {
    saveChain = saveChain.then(async () => {
      await ready;
      try {
        const payload = JSON.stringify({ version: 3, entries: [...entries.values()], baseline: baseline });
        const dir = file.replace(/[/\\][^/\\]+$/, '');
        const tmp = file + '.tmp';
        await mkdir(dir, { recursive: true });
        await writeFile(tmp, payload, 'utf8');
        await rename(tmp, file);
      } catch { /* persistence is best effort; live data remains available */ }
    }).catch(() => { /* keep the write chain alive */ });
    return saveChain;
  };

  const loadOnce = async () => {
    if (loaded) return;
    loaded = true;
    try {
      let saved;
      try {
        saved = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        for (const legacy of legacyStatePaths()) {
          try { saved = JSON.parse(await readFile(legacy, 'utf8')); break; } catch { /* try next */ }
        }
      }
      for (const item of Array.isArray(saved?.entries) ? saved.entries : []) {
        if (!item?.key || !item.at || !Number.isFinite(Number(item.tokens))) continue;
        // Keep anything the live process already recorded for this key.
        if (entries.has(item.key)) continue;
        entries.set(item.key, { key: item.key, tokens: number(item.tokens), model: String(item.model || '当前模型'), at: item.at });
      }
      const savedBaseline = saved?.baseline;
      if (savedBaseline && typeof savedBaseline === 'object') mergeBaseline(savedBaseline);
      // The one-shot backfill writes this file; it is absent until someone runs
      // `npm run backfill -- --write`.
      try {
        const backfilled = JSON.parse(await readFile(sidecar, 'utf8'));
        mergeBaseline(backfilled?.baseline && typeof backfilled.baseline === 'object' ? backfilled.baseline : backfilled);
      } catch { /* no backfill has been applied */ }
    } catch { /* first run or unavailable storage */ }
    prune(Date.now());
    rebuild(activeOffset);
  };

  // A rejected `ready` would poison the write chain and 500 the endpoint
  // forever, so the readiness promise itself never rejects.
  const ready = loadOnce().catch(() => {});

  const add = (session, event) => {
    if (event?.type !== 'assistant/message' || !event.data?.usage) return;
    const n = tokensOf(event.data.usage);
    if (!n) return;
    const data = event.data;
    const id = sessionIdOf(session);
    const key = `${id}:${data.turn ?? event.seq ?? event.time ?? Date.now()}:${data.step ?? 'message'}`;
    const at = timeOf(event).toISOString();
    entries.set(key, { key, tokens: n, model: String(modelOf(session, event)), at });
    // A long-lived host would otherwise never evict anything past KEEP_DAYS.
    prune(Date.now());
    rebuild(activeOffset);
    void persist();
  };
  ctx.on?.('session/event', add);

  ctx.inject?.(['connection'], (scope) => {
    const dispose = scope.connection.fetch.register({ path: ROUTE, methods: ['GET'], fetch: async (request) => {
      await ready;
      let offset = null;
      try { offset = clampOffset(new URL(request.url).searchParams.get('off')); } catch { offset = null; }
      activeOffset = offset;
      const snapshot = rebuild(offset);
      return new Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } });
    scope.effect(() => () => Promise.resolve(dispose?.()).catch(() => {}));
  });
}
