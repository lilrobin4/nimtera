-- PostgreSQL testnet beta state. Initialization never imports or restores demo secrets.
-- The API initializes an empty versioned state with INSERT ... ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS nimtera_testnet_state (
  id text PRIMARY KEY CHECK (id = 'testnet'),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- All application mutations lock the testnet row and commit before sending success.
-- This bounded beta design serializes writes; normalize tables before high-volume use.

-- Supabase may expose public-schema tables through its Data API. Deny browser-role access.
ALTER TABLE nimtera_testnet_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nimtera_testnet_state FROM PUBLIC;
-- No RLS policies are created. Only the trusted database owner/backend can access state.
