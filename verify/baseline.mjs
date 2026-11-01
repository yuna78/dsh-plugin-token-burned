/**
 * Regression test for the backfilled-history merge (state file + sidecar).
 *
 * The rule being locked down: a calendar day that has live raw entries must
 * ignore its backfilled total (otherwise the day is counted twice), a day
 * without raw entries takes the baseline, and both the state file and the
 * sidecar feed the same map by "largest wins".
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'tb-baseline-'));
process.env.DSH_TOKEN_BURNED_STATE = root;
await mkdir(join(root, 'storages'), { recursive: true });

const { ROUTE, apply } = await import('../index.js');

const DAY = 86400000;
const off = -new Date().getTimezoneOffset(); // minutes east of UTC, same as the client
const todayDate = new Date(Date.now() + off * 60000).toISOString().slice(0, 10);
const dateAt = (daysAgo) => new Date(Date.parse(todayDate + 'T00:00:00.000Z') - daysAgo * DAY).toISOString().slice(0, 10);
// Noon of that calendar day, expressed as an instant the host buckets back into it.
const stampAt = (daysAgo) => new Date(Date.parse(dateAt(daysAgo) + 'T12:00:00.000Z') - off * 60000).toISOString();

const state = {
  version: 3,
  entries: [
    { key: 'a:1:1', tokens: 100, model: 'test-model', at: stampAt(0) },
    { key: 'b:2:1', tokens: 50, model: 'test-model', at: stampAt(1) },
  ],
  // A raw day must ignore its baseline even when the baseline is far larger.
  baseline: { [dateAt(1)]: 999999, [dateAt(2)]: 700 },
};
await writeFile(join(root, 'storages', 'dsh-token-burned.json'), JSON.stringify(state), 'utf8');
// The one-shot backfill's output: a sidecar beside the state file.
await writeFile(join(root, 'storages', 'dsh-token-burned.baseline.json'), JSON.stringify({
  version: 1,
  baseline: { [dateAt(3)]: 500, [dateAt(1)]: 888888 },
}), 'utf8');

let routeFetch = null;
// Mirror the Host: `connection` is handed to `apply` directly and the route is
// registered through it. A stub that only implements `inject` would hide a route
// that never gets registered — the dock then reads whoever else owns the path.
const ctx = {
  on: () => {},
  connection: { fetch: { register: (spec) => { routeFetch = spec.fetch; return () => {}; } } },
  effect: (fn) => fn(),
};
apply(ctx);

assert.equal(typeof routeFetch, 'function', 'apply must register the route on ctx.connection.fetch');

const response = await routeFetch(new Request(`http://host${ROUTE}?off=${off}`));
const snap = await response.json();

assert.equal(snap.today, 100, 'today comes from live entries');
// days[] is oldest→newest: index 29 is today, 28 yesterday, and so on.
assert.equal(snap.days[29], 100, 'today comes from live entries');
assert.equal(snap.days[28], 50, 'yesterday keeps its raw entries and ignores a larger baseline');
assert.equal(snap.days[27], 700, 'a day without raw entries takes the state-file baseline');
assert.equal(snap.days[26], 500, 'a day without raw entries takes the sidecar baseline');
assert.equal(snap.recent30, 100 + 50 + 700 + 500, '30-day total is the sum of all days');
assert.equal(snap.byModel['test-model'], 100, 'model breakdown stays live-only');
assert.ok(snap.updatedAt, 'updatedAt is reported');

const second = await (await routeFetch(new Request(`http://host${ROUTE}?off=${off}`))).json();
assert.deepEqual(second, snap, 'repeated snapshots are stable (no double counting)');

await rm(root, { recursive: true, force: true });
console.log('token-burned baseline: PASS');
