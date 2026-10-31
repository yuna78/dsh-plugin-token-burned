#!/usr/bin/env node
/**
 * Read-only diagnostic: shows where the recorded burn actually lands in time.
 *
 * The dock used to bucket hours with the host process's timezone while the
 * browser labelled them with its own, so the same data could appear under
 * "10:00" on screen while having happened at 06:00 local. This script prints the
 * state file's entries per hour in *your shell's* timezone and in UTC side by
 * side, so the discrepancy (if any) is visible without restarting the host.
 *
 * Usage:  node verify/hours.mjs [YYYY-MM-DD]
 * Touches nothing on disk.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DAY = 86400000;
const HOUR = 3600000;
const statePath = () => join(
  process.env.DSH_TOKEN_BURNED_STATE || process.env.DSH_HOME || join(process.env.HOME || process.cwd(), '.dsh'),
  'storages',
  'dsh-token-burned.json',
);

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
const pad = (s, n) => String(s).padStart(n);
const offsetOf = (ts) => -new Date(ts).getTimezoneOffset();
const dayKey = (ts, off) => new Date(ts + off * 60000).toISOString().slice(0, 10);
const hourKey = (ts, off) => Math.floor(((ts + off * 60000) % DAY) / HOUR);

const file = statePath();
let raw;
try {
  raw = JSON.parse(await readFile(file, 'utf8'));
} catch (err) {
  console.error('cannot read state file: ' + file);
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
}

const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
  .map((e) => ({ at: Date.parse(e?.at), tokens: Number(e?.tokens) || 0, model: String(e?.model || '?') }))
  .filter((e) => Number.isFinite(e.at))
  .sort((a, b) => a.at - b.at);

if (!entries.length) {
  console.log('state file: ' + file);
  console.log('no usable entries recorded yet.');
  process.exit(0);
}

const off = offsetOf(entries[entries.length - 1].at);
const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
const stamp = (ts) => {
  const d = new Date(ts);
  return d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
};

console.log('state file : ' + file);
console.log('entries    : ' + entries.length + '   version ' + (raw?.version ?? '?'));
console.log('span       : ' + stamp(entries[0].at) + '  ..  ' + stamp(entries[entries.length - 1].at));
console.log('shell tz   : ' + tzName + '  (UTC' + (off >= 0 ? '+' : '') + off / 60 + ')');
console.log('');

// --- day totals ---------------------------------------------------------------
const days = new Map();
for (const e of entries) {
  const key = dayKey(e.at, off);
  days.set(key, (days.get(key) || 0) + e.tokens);
}
console.log('day totals (shell timezone):');
for (const [key, total] of [...days].sort()) console.log('  ' + key + '  ' + pad(fmt(total), 10) + ' tokens');
console.log('');

// --- hour histograms ----------------------------------------------------------
const target = process.argv[2] || [...days.keys()].sort().pop();
const todayUtc = dayKey(entries[entries.length - 1].at, 0);

const histogram = (label, useOffset, whichDay) => {
  const buckets = new Array(24).fill(0);
  for (const e of entries) {
    if (dayKey(e.at, useOffset) !== whichDay) continue;
    buckets[hourKey(e.at, useOffset)] += e.tokens;
  }
  const max = Math.max(1, ...buckets);
  console.log(label);
  let empty = 0;
  for (let h = 0; h < 24; h += 1) {
    if (!buckets[h]) { empty += 1; continue; }
    const width = Math.max(1, Math.round((buckets[h] / max) * 32));
    console.log('  ' + pad(String(h).padStart(2, '0') + ':00', 6) + ' ' + '#'.repeat(width) + ' ' + fmt(buckets[h]));
  }
  if (empty === 24) console.log('  (no entries in this day)');
  console.log('');
};

histogram('hour histogram for ' + target + ' (shell timezone, ' + tzName + '):', off, target);
histogram('hour histogram for ' + todayUtc + ' (UTC, what an unpatched host buckets by):', 0, todayUtc);

console.log('If the two histograms are shifted by ' + Math.abs(off / 60) + 'h, the data is intact and the old');
console.log('chart was simply labelling host-timezone hours with local labels. Nothing is lost.');
