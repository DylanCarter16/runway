-- Phase 8: Odyssey userscript. Its personal token is an integration_tokens row with
-- provider 'odyssey_script', stored like the ICS feed token: secret_ciphertext holds
-- the token encrypted (Settings rebuilds the script with it), and meta.token_hash
-- holds its sha256 for the ingest route's lookup.

alter table public.integration_tokens drop constraint integration_tokens_provider_check;
alter table public.integration_tokens add constraint integration_tokens_provider_check
  check (provider in ('google', 'microsoft', 'learn_ics', 'ics_feed', 'odyssey_script'));

create index integration_tokens_odyssey_hash on public.integration_tokens ((meta ->> 'token_hash'))
  where provider = 'odyssey_script';
