-- ============================================================
-- 055_chat_media_inbound_types.sql — widen chat-media for INBOUND media
--
-- The allowlist in 023 was drawn up for the Meta era, when everything in
-- this bucket was something we chose to send: a short list of formats the
-- Cloud API would accept outbound. Inbound media is the opposite problem —
-- the sender picks the format, and anything not on the list is rejected by
-- Storage and lost.
--
-- That is not hypothetical. Rejected on this instance:
--
--   audio/ogg; codecs=opus   every WhatsApp voice note
--   application/zip          a forwarded archive
--   application/octet-stream anything WhatsApp couldn't type
--
-- (The `; codecs=opus` case is also fixed in the webhook, which now strips
-- mime parameters before upload — Storage compares Content-Type against
-- this list as an exact string, so the parameter alone caused the reject.
-- Both halves are needed: the strip makes voice notes match `audio/ogg`,
-- and this list covers the formats that were never on it.)
--
-- The size limit rises with it. 16 MB was "the Meta video cap"; WhatsApp
-- documents go to 100 MB, and a document over the limit fails the same
-- silent way.
-- ============================================================

UPDATE storage.buckets
SET
  file_size_limit = 104857600, -- 100 MB (WhatsApp's document ceiling)
  allowed_mime_types = ARRAY[
    -- Images. gif/heic are common inbound and were missing.
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
    -- Video. quicktime is what iPhones send; webm what browsers record.
    'video/mp4', 'video/3gpp', 'video/webm', 'video/quicktime', 'video/x-msvideo',
    -- Audio. Voice notes are ogg/opus; the rest cover forwarded clips.
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp3', 'audio/aac',
    'audio/mp4', 'audio/amr', 'audio/wav', 'audio/x-wav', 'audio/webm',
    'audio/flac',
    -- Documents.
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/rtf', 'text/plain', 'text/csv', 'text/rtf',
    -- Archives.
    'application/zip', 'application/x-zip-compressed',
    'application/vnd.rar', 'application/x-rar-compressed',
    'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
    -- Contact cards WhatsApp forwards.
    'text/vcard', 'text/x-vcard',
    -- Last resort. WhatsApp sends this when it cannot type a file, and
    -- rejecting it means losing the attachment entirely. Only the webhook
    -- (service role) writes here, so this widens no user-facing upload.
    'application/octet-stream'
  ]
WHERE id = 'chat-media';
