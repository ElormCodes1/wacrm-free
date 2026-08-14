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

/**
 * Types a browser will execute or render inline rather than download.
 *
 * chat-media is a PUBLIC bucket, so anything stored under one of these
 * Content-Types becomes a live page on the Supabase domain — an HTML file
 * or an SVG (which can carry <script>) forwarded through WhatsApp would be
 * a hosted XSS/phishing page one click away.
 */
const INLINE_EXECUTABLE_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
])

/**
 * The Content-Type to store a file under.
 *
 * Strips mime parameters — Storage matches its allowed_mime_types as an
 * exact string, so `audio/ogg; codecs=opus` fails against `audio/ogg`.
 *
 * Then neutralises anything a browser would execute. We deliberately keep
 * the file (losing a customer's attachment is not an acceptable way to be
 * safe) but serve it as a download instead of a page. The extension is
 * taken from the filename, so `report.html` still saves as `report.html`
 * — it just can't run from our domain. PDFs are intentionally left inline:
 * browsers sandbox their viewers and inline preview is the point of them.
 */
export function safeUploadMime(mime?: string | null): string {
  const base = baseMime(mime)
  if (!base) return 'application/octet-stream'
  return INLINE_EXECUTABLE_MIMES.has(base) ? 'application/octet-stream' : base
}
