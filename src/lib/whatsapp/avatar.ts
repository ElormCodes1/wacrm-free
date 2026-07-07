// ============================================================
// Contact avatar sync.
//
// Pulls a contact's WhatsApp profile picture and stores it in the public
// `chat-media` Supabase bucket, then writes the public URL onto the
// contact. We download + re-host rather than store the raw WhatsApp CDN
// URL because those (pps.whatsapp.net) are signed and expire.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchProfilePictureUrl,
  fetchProfile,
  fetchBusinessProfile,
} from '@/lib/whatsapp/provider/evolution'

/**
 * Sync a contact's avatar. Returns the stored public URL, or null when the
 * contact has no (public) picture or the fetch failed. Best-effort —
 * never throws.
 */
export async function syncContactAvatar(
  db: SupabaseClient,
  instanceName: string,
  contactId: string,
  phone: string,
): Promise<string | null> {
  try {
    const url = await fetchProfilePictureUrl({
      instanceName,
      number: phone.replace(/\D/g, ''),
    })
    if (!url) return null

    const resp = await fetch(url)
    if (!resp.ok) return null
    const buffer = Buffer.from(await resp.arrayBuffer())
    const mime = resp.headers.get('content-type') || 'image/jpeg'

    const path = `avatars/${contactId}.jpg`
    const { error: upErr } = await db.storage
      .from('chat-media')
      .upload(path, buffer, { contentType: mime, upsert: true })
    if (upErr) {
      console.warn('[avatar] upload failed:', upErr.message)
      return null
    }

    const { data } = db.storage.from('chat-media').getPublicUrl(path)
    // Cache-bust so the <img> refreshes when the picture changes (same path).
    const publicUrl = `${data.publicUrl}?v=${Date.now()}`

    const { error: updErr } = await db
      .from('contacts')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', contactId)
    if (updErr) {
      console.warn('[avatar] contact update failed:', updErr.message)
      return null
    }
    return publicUrl
  } catch (err) {
    console.warn('[avatar] sync failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Store a group's picture on the group contact. The group subject-picture
 * URL is already known (from group metadata), so we just download + re-host
 * it in `chat-media` (WhatsApp CDN URLs expire) and set `avatar_url`.
 * Returns the stored public URL, or null. Best-effort — never throws.
 */
export async function storeGroupAvatar(
  db: SupabaseClient,
  contactId: string,
  pictureUrl: string | null | undefined,
): Promise<string | null> {
  try {
    if (!pictureUrl) return null
    const resp = await fetch(pictureUrl)
    if (!resp.ok) return null
    const buffer = Buffer.from(await resp.arrayBuffer())
    const mime = resp.headers.get('content-type') || 'image/jpeg'

    const path = `avatars/${contactId}.jpg`
    const { error: upErr } = await db.storage
      .from('chat-media')
      .upload(path, buffer, { contentType: mime, upsert: true })
    if (upErr) return null

    const { data } = db.storage.from('chat-media').getPublicUrl(path)
    const publicUrl = `${data.publicUrl}?v=${Date.now()}`
    const { error: updErr } = await db
      .from('contacts')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', contactId)
    if (updErr) return null
    return publicUrl
  } catch {
    return null
  }
}

/**
 * Enrich a contact with their WhatsApp "about" text and — if they're a
 * business — their business profile (category, website, hours). Best-effort.
 */
export async function syncContactProfile(
  db: SupabaseClient,
  instanceName: string,
  contactId: string,
  phone: string,
): Promise<void> {
  try {
    const number = phone.replace(/\D/g, '')
    const profile = await fetchProfile({ instanceName, number })
    if (!profile) return

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const statusText =
      typeof profile.status === 'string' ? profile.status : profile.status?.status
    if (statusText) patch.status_text = statusText

    if (profile.isBusiness) {
      const biz = await fetchBusinessProfile({ instanceName, number })
      if (biz && Object.keys(biz).length > 0) patch.business_profile = biz
    }

    if (Object.keys(patch).length > 1) {
      await db.from('contacts').update(patch).eq('id', contactId)
    }
  } catch (err) {
    console.warn('[profile] enrich failed:', err instanceof Error ? err.message : err)
  }
}
