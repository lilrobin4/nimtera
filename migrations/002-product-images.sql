CREATE TABLE IF NOT EXISTS nimtera_product_images (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  owner_slug text NOT NULL,
  digest text NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 160000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_slug,digest)
);
ALTER TABLE nimtera_product_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nimtera_product_images FROM PUBLIC;

