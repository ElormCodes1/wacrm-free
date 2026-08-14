-- ============================================================
-- 056_chat_media_common_formats.sql — accept the formats people actually send
--
-- 055 widened chat-media from the old Meta-era outbound list to what
-- WhatsApp commonly delivers. This goes further: the goal is that no
-- ordinary attachment is ever rejected, because a rejected upload means a
-- customer's file is gone with only a line in the server log.
--
-- Why this stays an allowlist rather than becoming "anything":
-- chat-media is PUBLIC, and outbound attachments are uploaded straight
-- from the browser with a Content-Type the browser chooses
-- (lib/storage/upload-media.ts). Dropping the restriction would let any
-- signed-in user publish `text/html` or `image/svg+xml` under our Supabase
-- domain — a hosted XSS/phishing page. The list is the only control on
-- that path, so it stays.
--
-- Executable types are handled rather than banned. INBOUND files keep
-- arriving whatever their type, so the webhook stores those under
-- application/octet-stream (see safeUploadMime): the file is preserved and
-- downloads with its real extension, it simply cannot run from our domain.
-- That is why text/html and image/svg+xml are absent below and their
-- absence is not a gap.
-- ============================================================

UPDATE storage.buckets
SET
  file_size_limit = 104857600, -- 100 MB (WhatsApp's document ceiling)
  allowed_mime_types = ARRAY[
    -- ---------- Images ----------
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/bmp', 'image/tiff', 'image/x-icon',
    'image/vnd.microsoft.icon', 'image/avif', 'image/jxl',
    -- NOTE: image/svg+xml deliberately omitted — see header.

    -- ---------- Video ----------
    'video/mp4', 'video/3gpp', 'video/3gpp2', 'video/webm', 'video/quicktime',
    'video/x-msvideo', 'video/x-ms-wmv', 'video/x-matroska', 'video/mpeg',
    'video/ogg', 'video/x-flv',

    -- ---------- Audio ----------
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp3', 'audio/aac',
    'audio/mp4', 'audio/x-m4a', 'audio/amr', 'audio/wav', 'audio/x-wav',
    'audio/wave', 'audio/webm', 'audio/flac', 'audio/x-flac', 'audio/midi',
    'audio/x-midi', 'audio/3gpp', 'audio/basic',

    -- ---------- Documents ----------
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'application/vnd.ms-word.document.macroenabled.12',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.apple.pages', 'application/vnd.apple.numbers',
    'application/vnd.apple.keynote',
    'application/rtf', 'text/rtf',
    'application/epub+zip', 'application/x-mobipocket-ebook',
    'application/vnd.visio', 'application/postscript',

    -- ---------- Text & data ----------
    -- Plain-text formats render inline but cannot execute, so they are
    -- safe to keep as-is. Anything script-bearing is excluded above.
    'text/plain', 'text/csv', 'text/tab-separated-values', 'text/markdown',
    'text/calendar', 'application/json', 'application/x-ndjson',
    'application/sql', 'text/x-sql', 'application/x-yaml', 'text/yaml',

    -- ---------- Archives ----------
    'application/zip', 'application/x-zip-compressed',
    'application/vnd.rar', 'application/x-rar-compressed',
    'application/x-7z-compressed', 'application/gzip', 'application/x-gzip',
    'application/x-tar', 'application/x-bzip2', 'application/x-xz',

    -- ---------- Contacts & calendar ----------
    'text/vcard', 'text/x-vcard', 'application/vcard',

    -- ---------- Fonts & design ----------
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
    'application/vnd.adobe.photoshop', 'image/vnd.adobe.photoshop',
    'application/illustrator', 'application/x-figma',

    -- ---------- Catch-all ----------
    -- What WhatsApp sends when it cannot type a file (a .tex arrived this
    -- way), and what the webhook rewrites executable types to. Without it
    -- those attachments are lost outright.
    'application/octet-stream'
  ]
WHERE id = 'chat-media';
