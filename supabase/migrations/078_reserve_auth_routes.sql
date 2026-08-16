-- ============================================================
-- 078_reserve_auth_routes.sql — the new auth pages are not company names
--
-- A static route always wins over /[company], so a company that managed
-- to register the slug "reset-password" would simply become unreachable —
-- their address would serve the password form to everyone who typed it.
-- The reserved list existed for exactly this, and the auth pages added
-- since were never put on it.
-- ============================================================

INSERT INTO reserved_slugs (word, source) VALUES
  ('reset-password', 'route'),
  ('auth', 'route'),
  ('complete', 'route'),
  ('callback', 'route')
ON CONFLICT (word) DO NOTHING;

NOTIFY pgrst, 'reload schema';
