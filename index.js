/** Host half: exposes token usage snapshots from DSH sessions. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const name = 'dsh-token-burned';
export const inject = ['connection', 'sessionProjections'];
export const ROUTE = '/api/dsh-token-burned.snapshot';

const DAY = 86400000;
const empty = () => ({ today: 0, recent30: 0, byModel: {}, byHour: Array(24).fill(0), days: Array(30).fill(0), updatedAt: null });
// Day buckets must follow the *local* calendar: the client labels them "today"
// and divides by seconds since local midnight. Bucketing on UTC days made
// "today" flip over at 20:00 in America/New_York and report the wrong total.
const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
// Rounded day distance keeps DST transitions (23h/25h days) on the right day.
const dayOffset = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);
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
const legacyStatePaths = () => [join(process.env.HOME || process.cwd(), 'dsh-token-burned.json'), join(process.env.XDG_STATE_HOME || '', 'dsh-token-burned.json')].filter(Boolean);

export function apply(ctx) {
  const stats = empty();
  // Entries are one provider settlement per session/turn/step. Keeping the
  // settlement (rather than adding every replay) makes retries and projection
  // replays idempotent, while allowing a later usage sample to replace it.
  const entries = new Map();
  const file = statePath();
  let loaded = false;
  let saveChain = Promise.resolve();

  const rebuild = () => {
    const now = Date.now();
    const next = empty();
    for (const item of entries.values()) {
      const at = new Date(item.at).getTime();
      if (!Number.isFinite(at)) continue;
      const age = dayOffset(at, now);
      if (age < 0 || age >= 30) continue;
      const n = number(item.tokens);
      next.recent30 += n;
      next.days[29 - age] += n;
      if (age === 0) {
        next.today += n;
        next.byModel[item.model] = (next.byModel[item.model] || 0) + n;
        next.byHour[new Date(at).getHours()] += n;
      }
      next.updatedAt = next.updatedAt && next.updatedAt > item.at ? next.updatedAt : item.at;
    }
    Object.assign(stats, next);
  };
  const persist = () => {
    const payload = JSON.stringify({ version: 1, entries: [...entries.values()] });
    saveChain = saveChain.then(async () => {
      try {
        await mkdir(file.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
        // writeFile is the persistence primitive available to this plugin.
        await writeFile(file, payload, 'utf8');
      } catch { /* persistence is best effort; live data remains available */ }
    });
    return saveChain;
  };
  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      let saved;
      try { saved = JSON.parse(await readFile(file, 'utf8')); } catch {
        for (const legacy of legacyStatePaths()) { try { saved = JSON.parse(await readFile(legacy, 'utf8')); break; } catch {} }
      }
      if (!saved) return;
      for (const item of Array.isArray(saved?.entries) ? saved.entries : []) {
        if (item?.key && Number.isFinite(Number(item.tokens)) && item.at) entries.set(item.key, {
          key: item.key, tokens: number(item.tokens), model: String(item.model || '当前模型'), at: item.at
        });
      }
      rebuild();
    } catch { /* first run or unavailable storage */ }
  };
  void load();

  const add = (session, event) => {
    if (event?.type !== 'assistant/message' || !event.data?.usage) return;
    const n = tokensOf(event.data.usage);
    if (!n) return;
    const data = event.data;
    const id = sessionIdOf(session);
    const key = `${id}:${data.turn ?? event.seq ?? event.time ?? Date.now()}:${data.step ?? 'message'}`;
    const at = timeOf(event).toISOString();
    entries.set(key, { key, tokens: n, model: String(modelOf(session, event)), at });
    rebuild();
    void persist();
  };
  ctx.on?.('session/event', add);
  ctx.inject?.(['connection'], (scope) => {
    const dispose = scope.connection.fetch.register({ path: ROUTE, methods: ['GET'], fetch: async () => {
      await load();
      rebuild();
      return new Response(JSON.stringify(stats), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } });
    scope.effect(() => () => Promise.resolve(dispose?.()).catch(() => {}));
  });
}
