-- 012_consent.sql — which version of the Terms / Privacy Policy each person agreed to, and when.
alter table "User" add column if not exists terms_version     text        null;
alter table "User" add column if not exists terms_accepted_at timestamptz null;
