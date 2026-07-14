-- OKX 架构图剩余模块：赚币 / 杠杆 / 统一账户 / 期权 / ADL / 清算 / AML-KYB / 快捷买 / 等级
USE `velora`;

-- ── 赚币 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_earn_product (
  f_id INT NOT NULL AUTO_INCREMENT,
  f_product_no VARCHAR(32) NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_name VARCHAR(64) NOT NULL,
  f_apr DECIMAL(12,8) NOT NULL DEFAULT 0.05 COMMENT '年化',
  f_min_amount DECIMAL(36,12) NOT NULL DEFAULT 10,
  f_status TINYINT NOT NULL DEFAULT 1,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_earn_product_no (f_product_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_earn_position (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_product_no VARCHAR(32) NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_principal DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_accrued DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_status VARCHAR(16) NOT NULL DEFAULT 'active',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_earn_pos_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_earn_product (f_product_no, f_currency, f_name, f_apr, f_min_amount)
VALUES
  ('EP-USDT-FLEX', 'USDT', 'USDT Flexible', 0.045, 10),
  ('EP-BTC-FLEX', 'BTC', 'BTC Flexible', 0.012, 0.001)
ON DUPLICATE KEY UPDATE f_apr = VALUES(f_apr);

-- ── 现货杠杆 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_spot_margin_loan (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_principal DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_interest DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_hourly_rate DECIMAL(12,8) NOT NULL DEFAULT 0.00001,
  f_status VARCHAR(16) NOT NULL DEFAULT 'open',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_margin_loan_user (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 统一账户模式 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_user_account_mode (
  f_user_id BIGINT NOT NULL,
  f_mode VARCHAR(16) NOT NULL DEFAULT 'classic' COMMENT 'classic|unified',
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 币本位合约字段 ────────────────────────────────────────────────────────
SET @has_margin_cur := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_futures_symbol' AND COLUMN_NAME = 'f_margin_currency'
);
SET @sql_margin_cur := IF(
  @has_margin_cur = 0,
  'ALTER TABLE t_futures_symbol
     ADD COLUMN f_margin_currency VARCHAR(16) NOT NULL DEFAULT ''USDT'' AFTER f_symbol,
     ADD COLUMN f_contract_type VARCHAR(16) NOT NULL DEFAULT ''usdt_m'' COMMENT ''usdt_m|coin_m'' AFTER f_margin_currency,
     ADD COLUMN f_face_value DECIMAL(36,12) NOT NULL DEFAULT 1 AFTER f_contract_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql_margin_cur;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO t_futures_symbol
  (f_symbol, f_margin_currency, f_contract_type, f_face_value, f_base, f_quote, f_display_name,
   f_price_precision, f_qty_precision, f_min_qty, f_max_leverage, f_status)
VALUES
  ('BTC-USD-SWAP', 'BTC', 'coin_m', 100, 'BTC', 'USD', 'BTC Coin-M Perp', 2, 1, 1, 50, 'trading'),
  ('ETH-USD-SWAP', 'ETH', 'coin_m', 10, 'ETH', 'USD', 'ETH Coin-M Perp', 2, 1, 1, 50, 'trading')
ON DUPLICATE KEY UPDATE f_margin_currency = VALUES(f_margin_currency), f_contract_type = VALUES(f_contract_type);

-- ── 保险基金 + ADL ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_insurance_fund (
  f_symbol VARCHAR(32) NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_balance DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_symbol, f_currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_adl_event (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL,
  f_quantity DECIMAL(36,12) NOT NULL,
  f_price DECIMAL(36,12) NOT NULL,
  f_reason VARCHAR(32) NOT NULL DEFAULT 'adl',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_adl_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 日终清算 / 对账 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_settlement_batch (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_batch_no VARCHAR(32) NOT NULL,
  f_settle_date DATE NOT NULL,
  f_status VARCHAR(16) NOT NULL DEFAULT 'completed',
  f_spot_trades INT NOT NULL DEFAULT 0,
  f_futures_funding INT NOT NULL DEFAULT 0,
  f_liquidations INT NOT NULL DEFAULT 0,
  f_reconcile_diffs INT NOT NULL DEFAULT 0,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_settle_batch (f_batch_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_reconcile_snapshot (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_batch_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_account_type VARCHAR(16) NOT NULL DEFAULT 'trading',
  f_ledger_sum DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_balance_actual DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_diff DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_reconcile_batch (f_batch_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── AML / KYB ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_kyb_verification (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_company_name VARCHAR(255) NOT NULL,
  f_reg_no VARCHAR(64) NOT NULL DEFAULT '',
  f_contact_name VARCHAR(64) NOT NULL DEFAULT '',
  f_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  f_reject_reason VARCHAR(255) NULL,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_kyb_user (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_address_blacklist (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_chain VARCHAR(16) NOT NULL DEFAULT 'TRC20',
  f_address VARCHAR(128) NOT NULL,
  f_reason VARCHAR(255) NOT NULL DEFAULT '',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_blacklist_addr (f_chain, f_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_aml_alert (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_alert_type VARCHAR(32) NOT NULL,
  f_amount DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_currency VARCHAR(16) NOT NULL DEFAULT 'USDT',
  f_status VARCHAR(16) NOT NULL DEFAULT 'open',
  f_detail TEXT NULL,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_aml_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 期权 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_option_instrument (
  f_id INT NOT NULL AUTO_INCREMENT,
  f_symbol VARCHAR(32) NOT NULL,
  f_underlying VARCHAR(16) NOT NULL,
  f_strike DECIMAL(36,12) NOT NULL,
  f_expiry DATE NOT NULL,
  f_option_type VARCHAR(8) NOT NULL COMMENT 'call|put',
  f_iv DECIMAL(12,8) NOT NULL DEFAULT 0.6,
  f_status VARCHAR(16) NOT NULL DEFAULT 'trading',
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_option_sym (f_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_option_position (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL COMMENT 'long|short',
  f_quantity DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_avg_premium DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_status VARCHAR(16) NOT NULL DEFAULT 'open',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_opt_pos_user (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_option_instrument (f_symbol, f_underlying, f_strike, f_expiry, f_option_type, f_iv)
VALUES
  ('BTC-70000-C-20260718', 'BTC', 70000, '2026-07-18', 'call', 0.55),
  ('BTC-65000-P-20260718', 'BTC', 65000, '2026-07-18', 'put', 0.58),
  ('ETH-3500-C-20260718', 'ETH', 3500, '2026-07-18', 'call', 0.62)
ON DUPLICATE KEY UPDATE f_iv = VALUES(f_iv);

-- ── 链上充值监听游标 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_chain_watch_cursor (
  f_chain VARCHAR(16) NOT NULL,
  f_last_ts BIGINT NOT NULL DEFAULT 0,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_chain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_chain_tx_log (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_tx_hash VARCHAR(128) NOT NULL,
  f_chain VARCHAR(16) NOT NULL,
  f_to_address VARCHAR(128) NOT NULL,
  f_amount DECIMAL(36,12) NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_matched_deposit_no VARCHAR(32) NULL,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_chain_tx (f_tx_hash, f_chain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 账户等级 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_tier_config (
  f_tier_key VARCHAR(32) NOT NULL,
  f_tier_level INT NOT NULL DEFAULT 1,
  f_name_zh VARCHAR(32) NOT NULL,
  f_name_en VARCHAR(32) NOT NULL,
  f_maker_fee DECIMAL(12,8) NOT NULL DEFAULT 0.001,
  f_taker_fee DECIMAL(12,8) NOT NULL DEFAULT 0.001,
  f_daily_withdraw_usd DECIMAL(36,2) NOT NULL DEFAULT 50000,
  f_min_volume_30d DECIMAL(36,2) NOT NULL DEFAULT 0,
  f_require_kyc TINYINT NOT NULL DEFAULT 0,
  f_require_2fa TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (f_tier_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_tier_config
  (f_tier_key, f_tier_level, f_name_zh, f_name_en, f_maker_fee, f_taker_fee, f_daily_withdraw_usd, f_min_volume_30d, f_require_kyc, f_require_2fa)
VALUES
  ('regular', 1, '普通', 'Regular', 0.001, 0.001, 50000, 0, 0, 0),
  ('verified', 2, '认证', 'Verified', 0.0008, 0.0009, 100000, 0, 1, 0),
  ('vip', 3, 'VIP', 'VIP', 0.0005, 0.0007, 500000, 100000, 1, 1)
ON DUPLICATE KEY UPDATE f_taker_fee = VALUES(f_taker_fee);

-- ── 快捷买币 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_quick_buy_order (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_order_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_fiat_currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  f_fiat_amount DECIMAL(36,2) NOT NULL,
  f_crypto_currency VARCHAR(16) NOT NULL DEFAULT 'USDT',
  f_crypto_amount DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_rate DECIMAL(18,8) NOT NULL DEFAULT 7.2,
  f_channel VARCHAR(32) NOT NULL DEFAULT 'mock_bank',
  f_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_qb_order (f_order_no),
  KEY idx_qb_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
