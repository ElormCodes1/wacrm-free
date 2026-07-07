import type { Contact } from '@/types'

/**
 * Display name for a contact or group that never surfaces the raw id.
 *
 * A group is stored as a contact whose `phone` is the WhatsApp group id;
 * when its name hasn't been enriched with the group subject yet, `name`
 * equals that long id. Fall back to "Group" in that case rather than
 * showing the id string.
 */
export function contactDisplayName(
  contact:
    | Pick<Contact, 'name' | 'phone' | 'is_group'>
    | null
    | undefined,
): string {
  if (!contact) return 'Unknown'
  const name = contact.name?.trim()
  if (name && name !== contact.phone) return name
  return contact.is_group ? 'Group' : contact.phone || 'Unknown'
}
