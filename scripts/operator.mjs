#!/usr/bin/env node
/**
 * Provision and manage operators — the staff level above customers.
 *
 *   node scripts/operator.mjs create ops@example.com "Ada Lovelace"
 *   node scripts/operator.mjs list
 *   node scripts/operator.mjs deactivate ops@example.com
 *   node scripts/operator.mjs reactivate ops@example.com
 *
 * Creating one is not a single insert, which is why this exists. Signing
 * up creates an auth user AND a personal company for them, and
 * profiles.account_id is NOT NULL — but an operator must belong to no
 * company, and a trigger enforces that. So the auto-created company has
 * to be removed before the operator row will insert at all.
 *
 * That is a delete, against a database full of real customers, so every
 * guard here is about making sure it can only ever remove the empty
 * company that was created seconds earlier by this script:
 *
 *   * the account must be owned by the user being promoted;
 *   * it must have no other members;
 *   * it must contain no contacts, conversations or messages;
 *   * and if any check fails the script stops without deleting anything,
 *     because a human who already has data is not someone to promote by
 *     wiping their workspace.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// ---------- env ----------

function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!env.OPERATOR_SESSION_SECRET || env.OPERATOR_SESSION_SECRET.length < 32) {
  console.warn(
    'Warning: OPERATOR_SESSION_SECRET is missing or too short. Operators cannot sign in until it is set to 32+ characters.'
  );
}

const db = createClient(url, key, { auth: { persistSession: false } });

// ---------- helpers ----------

/** The auth user for an email, or null. Paged because the API has no filter. */
async function findAuthUser(email) {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Confirm an account is the throwaway one signup just made, and nothing
 * else. Returns a reason string when it is NOT safe to remove.
 */
async function whyNotSafeToDelete(accountId, ownerUserId) {
  const { data: account } = await db
    .from('accounts')
    .select('id, name, owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) return 'the account no longer exists';
  if (account.owner_user_id !== ownerUserId) {
    return `it is owned by somebody else (${account.owner_user_id})`;
  }

  const { count: members } = await db
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if ((members ?? 0) > 1) return `it has ${members} members`;

  for (const table of ['contacts', 'conversations', 'messages', 'whatsapp_config']) {
    const { count, error } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    // messages has no account_id; skip tables that cannot be checked this way.
    if (error) continue;
    if ((count ?? 0) > 0) return `it already contains ${count} ${table}`;
  }
  return null;
}

// ---------- commands ----------

async function create(email, name) {
  if (!email || !name) {
    console.error('Usage: operator.mjs create <email> "<name>"');
    process.exit(1);
  }

  const existingOperator = await db
    .from('operators')
    .select('user_id, name, is_active')
    .maybeSingle()
    .then(() => null)
    .catch(() => null);
  void existingOperator;

  let user = await findAuthUser(email);
  let password = null;

  if (user) {
    console.log(`Found existing auth user ${user.id}`);
  } else {
    password = randomBytes(12).toString('base64url');
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error) throw new Error(`Could not create user: ${error.message}`);
    user = data.user;
    console.log(`Created auth user ${user.id}`);
  }

  // Already an operator? Nothing to do — say so rather than churn.
  const { data: already } = await db
    .from('operators')
    .select('user_id, is_active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (already) {
    console.log(
      `${email} is already an operator (${already.is_active ? 'active' : 'inactive'}). Nothing changed.`
    );
    return;
  }

  // Detach the personal company signup created, if it is genuinely empty.
  const { data: profile } = await db
    .from('profiles')
    .select('id, account_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profile?.account_id) {
    const reason = await whyNotSafeToDelete(profile.account_id, user.id);
    if (reason) {
      console.error(
        `\nRefusing to promote ${email}: their company cannot be removed because ${reason}.\n` +
          'An operator must belong to no company. Use a fresh address for staff access\n' +
          'rather than converting an account that already holds customer data.'
      );
      process.exit(1);
    }
    const { error } = await db.from('accounts').delete().eq('id', profile.account_id);
    if (error) throw new Error(`Could not remove the empty personal company: ${error.message}`);
    console.log('Removed the empty company signup created for them');
  }

  const { error: insErr } = await db.from('operators').insert({ user_id: user.id, name });
  if (insErr) throw new Error(`Could not register operator: ${insErr.message}`);

  console.log(`\n${name} is now an operator.`);
  console.log(`  email:    ${email}`);
  if (password) console.log(`  password: ${password}   (shown once — store it now)`);
  console.log('  sign in:  /operator/login');
}

async function list() {
  const { data, error } = await db
    .from('operators')
    .select('user_id, name, is_active, created_at, last_seen_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!data?.length) {
    console.log('No operators registered.');
    return;
  }
  console.log(`${data.length} operator(s):`);
  for (const o of data) {
    const seen = o.last_seen_at ? new Date(o.last_seen_at).toISOString().slice(0, 16) : 'never';
    console.log(
      `  ${o.is_active ? '●' : '○'} ${o.name.padEnd(24)} ${o.user_id}  last seen ${seen}`
    );
  }
}

async function setActive(email, active) {
  const user = await findAuthUser(email);
  if (!user) {
    console.error(`No auth user for ${email}`);
    process.exit(1);
  }
  const { error } = await db
    .from('operators')
    .update({ is_active: active })
    .eq('user_id', user.id);
  if (error) throw new Error(error.message);
  console.log(
    `${email} is now ${active ? 'active' : 'INACTIVE'}.` +
      (active ? '' : ' Their next request loses access — sessions are re-checked, not trusted.')
  );
}

// ---------- entry ----------

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case 'create':
      await create(args[0], args.slice(1).join(' '));
      break;
    case 'list':
      await list();
      break;
    case 'deactivate':
      await setActive(args[0], false);
      break;
    case 'reactivate':
      await setActive(args[0], true);
      break;
    default:
      console.log(
        'Usage:\n' +
          '  node scripts/operator.mjs create <email> "<name>"\n' +
          '  node scripts/operator.mjs list\n' +
          '  node scripts/operator.mjs deactivate <email>\n' +
          '  node scripts/operator.mjs reactivate <email>'
      );
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
