import { createClient } from '@/lib/supabase/server';
import type { Contact, Tag } from '@/types';
import { ContactsClient, type ContactWithTags } from './contacts-client';

const PAGE_SIZE = 25;

// Server Component: render the default contacts view (first page, no search
// or tag filter) into the initial HTML, RLS-scoped by the cookie session.
// ContactsClient is seeded with it and owns all the interactivity — search,
// tag filter, pagination, bulk actions, forms — refetching client-side.
export default async function ContactsPage() {
  const supabase = await createClient();

  // All tags → map (renders chips + resolves the filter selection).
  const { data: tags } = await supabase.from('tags').select('*');
  const tagsMap: Record<string, Tag> = {};
  for (const t of (tags ?? []) as Tag[]) tagsMap[t.id] = t;

  // First page of contacts (mirrors the client's default fetch).
  const { data: rows, count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .eq('is_group', false)
    .order('created_at', { ascending: false })
    .range(0, PAGE_SIZE - 1);

  const contactRows = (rows ?? []) as Contact[];

  // Attach each contact's tags (same shape the client builds).
  let contacts: ContactWithTags[] = contactRows.map((c) => ({ ...c, tags: [] }));
  if (contactRows.length > 0) {
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in(
        'contact_id',
        contactRows.map((c) => c.id),
      );

    const byContact: Record<string, string[]> = {};
    for (const ct of contactTags ?? []) {
      if (!byContact[ct.contact_id]) byContact[ct.contact_id] = [];
      byContact[ct.contact_id].push(ct.tag_id);
    }

    contacts = contactRows.map((c) => ({
      ...c,
      tags: (byContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter((t): t is Tag => Boolean(t)),
    }));
  }

  return (
    <ContactsClient initial={{ contacts, totalCount: count ?? 0, tagsMap }} />
  );
}
