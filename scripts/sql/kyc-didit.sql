-- Didit KYC: session id column (run against `velora` database)
ALTER TABLE t_kyc_verification
  ADD COLUMN IF NOT EXISTS f_didit_session_id VARCHAR(64) NULL COMMENT 'Didit verification session UUID';
