-- 018_groq_extra_keys.sql — more Groq keys per person, so big screenshot imports read in parallel.
-- A JSON array of keys, each sealed like groq_api_key (lib/secretBox). Additive: old code ignores it.

alter table "User" add column if not exists groq_extra_keys jsonb not null default '[]'::jsonb;
