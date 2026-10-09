#!/usr/bin/env node
/**
 * Backfill tokenStats projection rows into ~/.dsh/storages/session_projcache.
 *
 * For every cached session record with a matching session log, decompress the
 * multi-frame zstd log, fold all events through dsh-token-stats' projection,
 * and store the folded state as a {ver:1, seq:<lastSeq>, val} row. Rows are
 * only written when the projection is missing or older than the folded cut,
 * and the live session (log written within the last 5 minutes) is skipped.
 *
 * Usage: node tools/backfill.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { foldTokenStatsEvents } from '../lib/index.js';

const HOME = process.env.HOME;
const cacheDir = HOME + '/.dsh/storages/session_projcache/sessions';
const sessionsRoots = [HOME + '/.dsh/sessions'];
const dry = process.argv.includes('--dry');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decompressMultiFrame(buf) {
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i);
  }
  if (offsets.length === 0) throw new Error('no zstd frames');
  let out = Buffer.alloc(0);
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k];
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
    out = Buffer.concat([out, zstdDecompressSync(buf.subarray(start, end))]);
  }
  return out;
}

function findLog(sessionId) {
  for (const root of sessionsRoots) {
    for (const ws of readdirSync(root)) {
      const p = join(root, ws, sessionId, 'session.v4.jsonl.zstd');
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

let written = 0, fresh = 0, skippedLive = 0, noLog = 0, failed = 0;
for (const file of readdirSync(cacheDir)) {
  if (!file.endsWith('.json')) continue;
  const sessionId = file.replace(/\.json$/, '');
  const path = join(cacheDir, file);
  let record;
  try { record = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  const rows = record?.record?.rows;
  if (rows === undefined) continue;
  const existing = rows.tokenStats;
  const log = findLog(sessionId);
  if (log === undefined) { noLog++; continue; }
  // Skip the live session: the running app owns its cache file.
  if (Date.now() - statSync(log).mtimeMs < 5 * 60_000) { skippedLive++; continue; }
  let events;
  try {
    events = decompressMultiFrame(readFileSync(log)).toString('utf8')
      .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  } catch (e) { console.error(sessionId, 'decompress failed:', e.message); failed++; continue; }
  const lastSeq = events.filter((e) => typeof e.seq === 'number').at(-1)?.seq ?? -1;
  if (existing !== undefined && existing.seq >= lastSeq) { fresh++; continue; }
  try {
    const state = foldTokenStatsEvents(events);
    rows.tokenStats = { ver: 1, seq: lastSeq, val: state };
    if (!dry) {
      const tmp = path + '.tmp';
      writeFileSync(tmp, JSON.stringify(record));
      writeFileSync(path, readFileSync(tmp));
      import('node:fs').then((fs) => fs.unlinkSync(tmp));
    }
    written++;
    console.log(`${sessionId}: seq=${lastSeq} tokens=${state.totalTokens} days=${Object.keys(state.byDay).length}`);
  } catch (e) { console.error(sessionId, 'fold failed:', e.message); failed++; }
}
console.log(`written=${written} fresh=${fresh} skippedLive=${skippedLive} noLog=${noLog} failed=${failed}${dry ? ' (dry run)' : ''}`);
