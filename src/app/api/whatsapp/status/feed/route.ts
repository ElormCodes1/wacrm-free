import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/whatsapp/status/feed
 *
 * Active (non-expired) WhatsApp statuses for the account, grouped for the
 * Status page: `mine` (our own posts) + `contacts` (one entry per poster,
 * unseen first). Read via the user session — RLS scopes to the account.
 */
export interface StatusViewer {
  name: string
  phone: string
  avatar_url: string | null
  viewed_at: string
}

export interface StatusItem {
  id: string
  content_type: 'text' | 'image' | 'video' | 'audio'
  content_text: string | null
  media_url: string | null
  background_color: string | null
  posted_at: string
  viewed_at: string | null
  viewers?: StatusViewer[]
  viewCount?: number
}

export interface StatusGroup {
  key: string
  name: string
  phone: string | null
  avatar_url: string | null
  items: StatusItem[]
  hasUnviewed: boolean
  latestPostedAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickContact(row: any): { id: string; name: string | null; avatar_url: string | null; phone: string | null } | null {
  const c = row.contact
  if (!c) return null
  return Array.isArray(c) ? (c[0] ?? null) : c
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 })

  const { data, error } = await supabase
    .from('status_updates')
    .select(
      'id, contact_id, is_mine, poster_phone, poster_name, content_type, content_text, media_url, background_color, posted_at, viewed_at, contact:contacts(id, name, avatar_url, phone)',
    )
    .eq('account_id', accountId)
    .gt('expires_at', new Date().toISOString())
    .order('posted_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const mine: StatusItem[] = []
  const groups = new Map<string, StatusGroup>()

  for (const row of data ?? []) {
    const item: StatusItem = {
      id: row.id,
      content_type: row.content_type,
      content_text: row.content_text,
      media_url: row.media_url,
      background_color: row.background_color,
      posted_at: row.posted_at,
      viewed_at: row.viewed_at,
    }

    if (row.is_mine) {
      mine.push(item)
      continue
    }

    const contact = pickContact(row)
    const key = row.contact_id || row.poster_phone || row.id
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
      if (!item.viewed_at) existing.hasUnviewed = true
      if (item.posted_at > existing.latestPostedAt) existing.latestPostedAt = item.posted_at
    } else {
      groups.set(key, {
        key,
        name: contact?.name || row.poster_name || row.poster_phone || 'Unknown',
        phone: contact?.phone || row.poster_phone || null,
        avatar_url: contact?.avatar_url || null,
        items: [item],
        hasUnviewed: !item.viewed_at,
        latestPostedAt: item.posted_at,
      })
    }
  }

  // Unseen groups first, then most-recently-posted.
  const contacts = [...groups.values()].sort((a, b) => {
    if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1
    return b.latestPostedAt.localeCompare(a.latestPostedAt)
  })

  // Attach "seen by" viewers to our own statuses.
  if (mine.length > 0) {
    const mineIds = mine.map((m) => m.id)
    const { data: views } = await supabase
      .from('status_views')
      .select(
        'status_update_id, viewer_phone, viewer_name, viewed_at, contact:contacts!viewer_contact_id(name, avatar_url)',
      )
      .eq('account_id', accountId)
      .in('status_update_id', mineIds)
      .order('viewed_at', { ascending: false })

    const byStatus = new Map<string, StatusViewer[]>()
    for (const v of views ?? []) {
      const c = pickContact(v)
      const viewer: StatusViewer = {
        name: c?.name || v.viewer_name || v.viewer_phone,
        phone: v.viewer_phone,
        avatar_url: c?.avatar_url || null,
        viewed_at: v.viewed_at,
      }
      const list = byStatus.get(v.status_update_id)
      if (list) list.push(viewer)
      else byStatus.set(v.status_update_id, [viewer])
    }
    for (const item of mine) {
      item.viewers = byStatus.get(item.id) ?? []
      item.viewCount = item.viewers.length
    }
  }

  return NextResponse.json({ mine, contacts })
}
