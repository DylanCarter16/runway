-- Phase 8: read-only MCP endpoint. Its token is an integration_tokens row with
-- provider 'mcp', stored like the ICS feed token: secret_ciphertext holds the token
-- encrypted (Settings shows the connector URL again), and meta.token_hash holds its
-- sha256 for the route's lookup.

alter table public.integration_tokens drop constraint integration_tokens_provider_check;
alter table public.integration_tokens add constraint integration_tokens_provider_check
  check (provider in ('google', 'microsoft', 'learn_ics', 'ics_feed', 'odyssey_script', 'mcp'));

create index integration_tokens_mcp_hash on public.integration_tokens ((meta ->> 'token_hash'))
  where provider = 'mcp';
