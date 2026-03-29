-- Safe appliance table migration (non-destructive)
-- Creates only the single appliance table required by the appliance flow.

CREATE TABLE IF NOT EXISTS appliance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  identity TEXT NOT NULL,
  device_name TEXT NOT NULL,
  appliance_name TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'off',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appliance_user_idx ON appliance(user_id);
CREATE INDEX IF NOT EXISTS appliance_identity_idx ON appliance(identity);
CREATE INDEX IF NOT EXISTS appliance_user_device_idx ON appliance(user_id, device_name);
CREATE UNIQUE INDEX IF NOT EXISTS appliance_user_device_pin_unique ON appliance(user_id, device_name, pin_id);
