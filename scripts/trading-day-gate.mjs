#!/usr/bin/env node
// trading-day-gate.mjs — skip deploy when no new trading day happened.
// Usage: node scripts/trading-day-gate.mjs <headLatestJsonPath>
// Exit 0 + "changed"/"unchanged" on stdout. "unchanged" = previous US trading
// session produced no new bars (weekend, market holiday) → workflow skips
// commit/build/deploy.
import { readFile } from 'node:fs/promises';

function newestBarDate(doc) {
  let newest = null;
  for (const s of doc.symbols || []) {
    const dates = (s.technical || []).map(t => t.date).filter(Boolean);
    if (dates.length) {
      const d = dates[dates.length - 1];
      if (!newest || d > newest) newest = d;
    }
  }
  return newest;
}

const [newPath, headPath] = process.argv.slice(2);
const fresh = JSON.parse(await readFile(newPath, 'utf8'));
const freshDate = newestBarDate(fresh);
if (!headPath) {
  console.log('changed'); // nothing to compare against → proceed
  process.exit(0);
}
let head = null;
try { head = JSON.parse(await readFile(headPath, 'utf8')); } catch { /* no HEAD version */ }
if (!head) { console.log('changed'); process.exit(0); }
const headDate = newestBarDate(head);
console.log(freshDate && headDate && freshDate === headDate ? 'unchanged' : 'changed');
