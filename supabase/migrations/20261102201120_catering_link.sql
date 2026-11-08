-- v0.11.39 (§11 Catering, owner's request): the Catering page's share link. The id is random and useless on its
-- own: the link's key is HMAC(PASS_TOKEN_SECRET, 'catering:' || id), derived like pass tokens (§6.1), so the server
-- can show organizers the link again. Null: no link yet. A new id (Reset link) kills the old link at once.
alter table public.events add column catering_link_id uuid;
