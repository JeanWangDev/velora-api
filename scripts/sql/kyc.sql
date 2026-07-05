-- KYC 身份认证
USE `velora`;

CREATE TABLE IF NOT EXISTS t_kyc_verification (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending | verified | rejected',
  f_id_type VARCHAR(16) NOT NULL COMMENT 'id_card | passport',
  f_full_name VARCHAR(128) NOT NULL,
  f_id_number VARCHAR(64) NOT NULL,
  f_country_iso VARCHAR(8) NOT NULL DEFAULT 'CN',
  f_address VARCHAR(255) NULL,
  f_valid_until VARCHAR(32) NULL,
  f_doc_front_name VARCHAR(255) NULL,
  f_doc_back_name VARCHAR(255) NULL,
  f_reject_reason VARCHAR(255) NULL,
  f_submitted_at DATETIME NULL,
  f_reviewed_at DATETIME NULL,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_kyc_user (f_user_id),
  KEY idx_kyc_status (f_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
