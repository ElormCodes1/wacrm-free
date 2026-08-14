/**
 * Naming for media pulled off WhatsApp and stored in Supabase Storage.
 *
 * Kept out of the webhook route so it can be unit-tested: Next restricts
 * what a route module may export.
 */

export const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'application/pdf': '.pdf',
  // Office + archives. Documents are the case where a missing extension
  // actually breaks something: the file downloads named after the message
  // id and the OS can't open it.
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/rtf': '.rtf',
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',
  'text/plain': '.txt',
  'text/csv': '.csv',
}

/**
 * A mime type without its parameters, lowercased.
 *
 * WhatsApp sends voice notes as `audio/ogg; codecs=opus`, which never
 * matched the bare `audio/ogg` key — so every voice note was stored with
 * no extension at all.
 */
export function baseMime(mime?: string | null): string | null {
  if (!mime) return null
  return mime.split(';')[0]!.trim().toLowerCase() || null
}

/** The extension off a filename, if it has a plausible one. */
export function extensionFromFilename(name?: string | null): string {
  if (!name) return ''
  const match = /\.[A-Za-z0-9]{1,8}$/.exec(name.trim())
  return match ? match[0].toLowerCase() : ''
}

/**
 * Pick the stored file's extension. WhatsApp hands us the sender's real
 * filename for documents, and trusting that beats growing a mime table
 * forever — it covers formats we've never heard of. The mime table is the
 * fallback for media that arrives unnamed (photos, voice notes).
 */
export function storageExtension(fileName?: string | null, mime?: string | null): string {
  return extensionFromFilename(fileName) || MIME_EXT[baseMime(mime) ?? ''] || ''
}
