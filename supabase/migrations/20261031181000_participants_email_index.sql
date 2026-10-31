-- v0.11.25: every hacker page finds the signed-in person by email across events (myEvent(), myPasses(), the
-- directory's viewer check). The unique (event_id, email) index can't serve an email-only lookup, so it was a
-- sequential scan that grew with every event.
create index if not exists participants_email on participants (email);
