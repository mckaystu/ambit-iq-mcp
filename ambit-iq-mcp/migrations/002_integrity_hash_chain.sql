-- Tamper-evident hash chain + RSA-SHA256 signature columns
-- Apply after 001: psql "$DATABASE_URL" -f migrations/002_integrity_hash_chain.sql

ALTER TABLE ambit_decision_logs
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS log_hash TEXT,
  ADD COLUMN IF NOT EXISTS signature TEXT;

COMMENT ON COLUMN ambit_decision_logs.previous_hash IS 'Prior log_hash or genesis (64 hex zeros) for first row';
COMMENT ON COLUMN ambit_decision_logs.log_hash IS 'SHA-256 hex of canonical payload including previous_hash';
COMMENT ON COLUMN ambit_decision_logs.signature IS 'RSA-SHA256(base64) signature of log_hash';
