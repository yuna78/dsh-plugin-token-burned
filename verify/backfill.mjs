#!/usr/bin/env node
/**
 * One-shot backfill: rebuild the 30-day history from DSH session transcripts.
 *
 * WHY: the dock lost its state file on every restart before 0.2.0, so days
 * recorded earlier are missing from `storages/dsh-token-burned.json`. The raw
 * provider usage still exists in `~/.dsh/sessions/**\/session.v4.jsonl.zstd`.
 *
 * WHAT IT WRITES: a sidecar next to the state file —
 *   `storages/dsh-token-burned.baseline.json` — holding one total per calendar
 * day (~30 numbers). Historical days never need hour/model detail (the chart
 * only ever shows today), so dumping the raw entries would cost ~31 MB and force
 * every snapshot to recompute ~250k rows. Days that still have raw entries
 * ignore their baseline, so nothing is counted twice.
 *
 * WHY A SIDECAR AND NOT THE STATE FILE: a running host rewrites its state file
 * from its in-memory map on the next usage event, so history written into that
 * file while the host is up gets silently discarded. The plugin only *reads* the
 * sidecar (at startup), and per-day "largest wins" makes re-running idempotent.
 * No downtime and no restart-to-write dance is needed: run this, then restart
 * the host (or let the next start pick it up). Today's number always comes from
 * live events, so today is never backfilled.
 *
 * Usage:
 *   node verify/backfill.mjs             # report only (default)
 *   node verify/backfill.mjs --write     # write the sidecar
 *   node verify/backfill.mjs --days=60   # scan a wider window
 */
import { readdir, stat, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';

const DAY = 86400000;
const MAX_AGE_DAYS = 30;

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const DAYS = Number((args.find((a) => a.startsWith('--days=')) || '--days=30').slice(7)) || 30;

const STATE = process.env.DSH_TOKEN_BURNED_STATE
  ? join(process.env.DSH_TOKEN_BURNED_STATE, 'storages', 'dsh-token-burned.json')
  : join(homedir(), '.dsh', 'storages', 'dsh-token-burned.json');
const SIDECAR = STATE.replace(/\.json$/, '') + '.baseline.json';
const SESSIONS = join(homedir(), '.dsh', 'sessions');

const offset = -new Date().getTimezoneOffset();
const dateOf = (ts) => new Date(ts + offset * 60000).toISOString().slice(0, 10);
const ageOf = (date, todayDate) => Math.round((Date.parse(todayDate) - Date.parse(date)) / DAY);
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

const tokensOf = (u) => {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return n(u?.inputTokens ?? u?.input_tokens) + n(u?.cacheReadTokens ?? u?.cache_read_tokens)
    + n(u?.cacheWriteTokens ?? u?.cache_write_tokens) + n(u?.outputTokens ?? u?.output_tokens);
};

async function walk(dir, acc, since) {
  let found;
  try { found = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of found) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(p, acc, since); continue; }
    if (!entry.name.endsWith('.jsonl.zstd')) continue;
    try { if ((await stat(p)).mtimeMs >= since) acc.push(p); } catch { /* session removed mid-scan */ }
  }
  return acc;
}

const sessionIdOf = (file) => {
  const dir = file.replace(/\/session\.v4\.jsonl\.zstd$/, '').split('/').pop();
  return dir.startsWith('session-') ? dir : `session-${dir}`;
};

function scanFile(file, onEvent) {
  return new Promise((resolve) => {
    const sessionId = sessionIdOf(file);
    const child = spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('error', () => resolve());
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (line.indexOf('"usage"') === -1) return;
      let o;
      try { o = JSON.parse(line); } catch { return; }
      if (o.type !== 'assistant/message' || !o.data || !o.data.usage) return;
      const tokens = tokensOf(o.data.usage);
      const at = Number(o.time ?? o.timestamp);
      if (!tokens || !Number.isFinite(at)) return;
      onEvent({ sessionId, at, tokens });
    });
    rl.on('close', () => resolve());
  });
}

// --- current state ------------------------------------------------------------
let state = { version: 3, entries: [], baseline: {} };
let stateBytes = 0;
try {
  const raw = await readFile(STATE, 'utf8');
  stateBytes = Buffer.byteLength(raw);
  state = JSON.parse(raw);
} catch {
  console.error(`no readable state file at ${STATE} — sessions are still scanned.`);
}
const liveEntries = Array.isArray(state.entries) ? state.entries : [];

let sidecar = {};
let sidecarBytes = 0;
try {
  const raw = await readFile(SIDECAR, 'utf8');
  sidecarBytes = Buffer.byteLength(raw);
  const parsed = JSON.parse(raw);
  sidecar = parsed?.baseline && typeof parsed.baseline === 'object' ? parsed.baseline : parsed;
} catch { /* first run */ }

// Both sources count. Per day the largest total wins, mirroring the host's merge.
const baseline = Object.assign({}, state.baseline && typeof state.baseline === 'object' ? state.baseline : {});
for (const [date, tokens] of Object.entries(sidecar)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
  baseline[date] = Math.max(Number(baseline[date]) || 0, Number(tokens) || 0);
}

const todayDate = dateOf(Date.now());
console.log(`state file : ${STATE}  (${(stateBytes / 1024).toFixed(0)} KB, ${liveEntries.length} entries)`);
console.log(`sidecar    : ${SIDECAR}  (${sidecarBytes ? (sidecarBytes / 1024).toFixed(1) + ' KB, ' + Object.keys(sidecar).length + ' days' : 'absent'})`);
console.log(`sessions   : ${SESSIONS}`);
console.log(`window     : ${DAYS} days   utc offset: ${offset} min   today: ${todayDate}`);
console.log(WRITE ? 'mode       : WRITE (sidecar only — the state file is never touched)' : 'mode       : dry-run (nothing is written)');
console.log('');

// --- scan ---------------------------------------------------------------------
const files = await walk(SESSIONS, [], Date.now() - DAYS * DAY);
console.log(`scanning ${files.length} transcripts...`);

const perDay = new Map();
// Which days already have raw entries? Those days win over any baseline.
const rawDays = new Set();
for (const item of liveEntries) {
  const at = Date.parse(item.at);
  if (Number.isFinite(at)) rawDays.add(dateOf(at));
}

let scanned = 0;
for (const file of files) {
  await scanFile(file, ({ at, tokens }) => {
    const date = dateOf(at);
    perDay.set(date, (perDay.get(date) || 0) + tokens);
  });
  scanned += 1;
  if (scanned % 500 === 0) process.stderr.write(`  ${scanned}/${files.length}\n`);
}

// --- report -------------------------------------------------------------------
const added = {};
for (const [date, tokens] of [...perDay].sort()) {
  const age = ageOf(date, todayDate);
  if (!Number.isFinite(age) || age < 0 || age >= MAX_AGE_DAYS) continue;
  if (age === 0) continue;            // today is live event data, never backfilled
  if (rawDays.has(date)) continue;    // raw entries already cover this day
  const previous = Number(baseline[date]) || 0;
  const merged = Math.max(previous, tokens);
  if (merged === previous) continue;
  added[date] = merged;
}

const rows = Object.entries(added).sort();
console.log('');
console.log('daily totals to write (transcript tokens → merged):');
let sum = 0;
for (const [date, tokens] of rows) {
  sum += tokens;
  const age = ageOf(date, todayDate);
  console.log(`  age ${String(age).padStart(2)}  ${date}  ${fmt(tokens).padStart(10)} tokens`);
}
console.log(`  ${rows.length} days, ${fmt(sum)} tokens`);

const nextSidecar = Object.assign({}, sidecar, added);
const projected = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), baseline: nextSidecar }, null, 0);
console.log('');
console.log(`sidecar: ${(sidecarBytes / 1024).toFixed(1)} KB → ~${(Buffer.byteLength(projected) / 1024).toFixed(1)} KB (${Object.keys(nextSidecar).length} days)`);
console.log(`state file stays at ${(stateBytes / 1024).toFixed(0)} KB (untouched)`);

if (!WRITE) {
  console.log('');
  console.log('dry-run complete. Apply with --write, then restart the DSH host.');
  process.exit(0);
}

// --- write --------------------------------------------------------------------
if (sidecarBytes) await copyFile(SIDECAR, `${SIDECAR}.bak`).catch(() => {});
await writeFile(`${SIDECAR}.tmp`, projected, 'utf8');
await rename(`${SIDECAR}.tmp`, SIDECAR);
console.log('');
console.log(`written. ${sidecarBytes ? `backup: ${SIDECAR}.bak` : 'no previous sidecar to back up.'}`);
console.log('restart the host; the calendar and the 30-day total should include the restored days.');
