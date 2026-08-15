#!/usr/bin/env node
/**
 * Push the app's own route names into reserved_slugs.
 *
 * Run after adding a page. The database is what actually rejects a
 * colliding signup, so it has to know what the app serves — and a list
 * typed by hand goes stale the first time someone is in a hurry. A test
 * fails if the two drift.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);

const appDir = join(process.cwd(), 'src', 'app');
const found = new Set();
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('(')) { walk(join(dir, e.name)); continue; }
    if (e.name.startsWith('[') || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (e.name.includes('.')) continue;
    found.add(e.name.toLowerCase());
  }
};
walk(appDir);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const rows = [...found].map((word) => ({ word, source: 'route' }));
const { error } = await db.from('reserved_slugs').upsert(rows, { onConflict: 'word' });
if (error) { console.error('sync failed:', error.message); process.exit(1); }
console.log(`synced ${rows.length} route words:`, [...found].sort().join(' '));
