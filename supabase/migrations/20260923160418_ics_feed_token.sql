-- Phase 8: read-only ICS feed. The feed token is an integration_tokens row with
-- provider 'ics_feed': secret_ciphertext holds the token encrypted (so Settings can
-- show the URL again), and meta.token_hash holds its sha256 for the feed route's lookup.

alter table public.integration_tokens drop constraint integration_tokens_provider_check;
alter table public.integration_tokens add constraint integration_tokens_provider_check
  check (provider in ('google', 'microsoft', 'learn_ics', 'ics_feed'));

create index integration_tokens_feed_hash on public.integration_tokens ((meta ->> 'token_hash'))
  where provider = 'ics_feed';
