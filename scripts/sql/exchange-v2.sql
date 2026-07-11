-- Velora 交易所 v2：多账户、钱包、条件单、合约、API Key、通知
USE `velora`;

-- ── 多账户：资金 / 交易 / 合约 ─────────────────────────────────────────
SET @has_account_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_account_balance' AND COLUMN_NAME = 'f_account_type'
);
SET @sql_account_type := IF(
  @has_account_type = 0,
  'ALTER TABLE t_account_balance ADD COLUMN f_account_type VARCHAR(16) NOT NULL DEFAULT ''trading'' COMMENT ''funding|trading|futures'' AFTER f_currency',
  'SELECT 1'
);
PREPARE stmt FROM @sql_account_type;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_old_uniq := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_account_balance' AND INDEX_NAME = 'uniq_account_balance'
    AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'f_currency'
);
SET @sql_drop_uniq := IF(
  @has_old_uniq > 0,
  'ALTER TABLE t_account_balance DROP INDEX uniq_account_balance',
  'SELECT 1'
);
PREPARE stmt FROM @sql_drop_uniq;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_new_uniq := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_account_balance' AND INDEX_NAME = 'uniq_account_balance_v2'
);
SET @sql_new_uniq := IF(
  @has_new_uniq = 0,
  'ALTER TABLE t_account_balance ADD UNIQUE KEY uniq_account_balance_v2 (f_user_id, f_currency, f_account_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql_new_uniq;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 账户划转记录
CREATE TABLE IF NOT EXISTS t_account_transfer (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_transfer_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_amount DECIMAL(36,12) NOT NULL,
  f_from_account VARCHAR(16) NOT NULL COMMENT 'funding|trading|futures',
  f_to_account VARCHAR(16) NOT NULL,
  f_status VARCHAR(16) NOT NULL DEFAULT 'completed',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_transfer_no (f_transfer_no),
  KEY idx_transfer_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 钱包：充币地址 / 充提记录 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_deposit_address (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_chain VARCHAR(32) NOT NULL COMMENT 'TRC20|ERC20|BTC|...',
  f_address VARCHAR(128) NOT NULL,
  f_memo VARCHAR(64) NOT NULL DEFAULT '',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_deposit_addr (f_user_id, f_currency, f_chain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_deposit_record (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_deposit_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_chain VARCHAR(32) NOT NULL,
  f_amount DECIMAL(36,12) NOT NULL,
  f_tx_hash VARCHAR(128) NOT NULL DEFAULT '',
  f_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|confirmed|failed',
  f_confirmations INT NOT NULL DEFAULT 0,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_deposit_no (f_deposit_no),
  KEY idx_deposit_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_withdrawal_request (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_withdraw_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_chain VARCHAR(32) NOT NULL,
  f_amount DECIMAL(36,12) NOT NULL,
  f_fee DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_address VARCHAR(128) NOT NULL,
  f_memo VARCHAR(64) NOT NULL DEFAULT '',
  f_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|processing|completed|rejected|cancelled',
  f_reject_reason VARCHAR(255) NOT NULL DEFAULT '',
  f_tx_hash VARCHAR(128) NOT NULL DEFAULT '',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_withdraw_no (f_withdraw_no),
  KEY idx_withdraw_user (f_user_id, f_id),
  KEY idx_withdraw_status (f_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 现货条件单（止盈止损 / 触发单）──────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_spot_algo_order (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_algo_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL COMMENT 'buy|sell',
  f_algo_type VARCHAR(16) NOT NULL COMMENT 'stop_loss|take_profit|oco',
  f_trigger_price DECIMAL(36,12) NOT NULL,
  f_order_price DECIMAL(36,12) NULL COMMENT '触发后挂限价；空=市价',
  f_quantity DECIMAL(36,12) NOT NULL,
  f_status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active|triggered|cancelled|expired',
  f_triggered_order_no VARCHAR(32) NOT NULL DEFAULT '',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_algo_no (f_algo_no),
  KEY idx_algo_user (f_user_id, f_id),
  KEY idx_algo_status (f_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 现货订单簿撮合索引
SET @has_match_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_spot_order' AND INDEX_NAME = 'idx_spot_order_match'
);
SET @sql_match_idx := IF(
  @has_match_idx = 0,
  'ALTER TABLE t_spot_order ADD KEY idx_spot_order_match (f_symbol, f_side, f_status, f_price, f_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql_match_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 成交对手方关联
SET @has_counter := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_spot_trade' AND COLUMN_NAME = 'f_counter_user_id'
);
SET @sql_counter := IF(
  @has_counter = 0,
  'ALTER TABLE t_spot_trade ADD COLUMN f_counter_user_id BIGINT NOT NULL DEFAULT 0 AFTER f_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql_counter;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 永续合约 ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_futures_symbol (
  f_id INT NOT NULL AUTO_INCREMENT,
  f_symbol VARCHAR(32) NOT NULL COMMENT '如 BTC-USDT-SWAP',
  f_base VARCHAR(16) NOT NULL,
  f_quote VARCHAR(16) NOT NULL,
  f_contract_value DECIMAL(36,12) NOT NULL DEFAULT 1,
  f_price_precision TINYINT NOT NULL DEFAULT 2,
  f_qty_precision TINYINT NOT NULL DEFAULT 0,
  f_min_qty DECIMAL(36,12) NOT NULL DEFAULT 1,
  f_max_leverage INT NOT NULL DEFAULT 125,
  f_maker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.0002,
  f_taker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.0005,
  f_funding_interval_hours INT NOT NULL DEFAULT 8,
  f_status TINYINT NOT NULL DEFAULT 1,
  f_sort_order INT NOT NULL DEFAULT 0,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_futures_symbol (f_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_futures_position (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL COMMENT 'long|short',
  f_margin_mode VARCHAR(8) NOT NULL DEFAULT 'cross' COMMENT 'cross|isolated',
  f_leverage INT NOT NULL DEFAULT 10,
  f_quantity DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_entry_price DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_margin DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_unrealized_pnl DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_liquidation_price DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_status VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT 'open|closed',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_futures_pos (f_user_id, f_symbol, f_side, f_margin_mode),
  KEY idx_futures_pos_user (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_futures_order (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_order_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL COMMENT 'buy|sell',
  f_pos_side VARCHAR(8) NOT NULL COMMENT 'long|short',
  f_type VARCHAR(8) NOT NULL COMMENT 'limit|market',
  f_price DECIMAL(36,12) NULL,
  f_quantity DECIMAL(36,12) NOT NULL,
  f_filled_quantity DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_leverage INT NOT NULL DEFAULT 10,
  f_margin_mode VARCHAR(8) NOT NULL DEFAULT 'cross',
  f_reduce_only TINYINT NOT NULL DEFAULT 0,
  f_status VARCHAR(16) NOT NULL DEFAULT 'open',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_futures_order_no (f_order_no),
  KEY idx_futures_order_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_futures_symbol
  (f_symbol, f_base, f_quote, f_price_precision, f_qty_precision, f_min_qty, f_sort_order)
VALUES
  ('BTC-USDT-SWAP', 'BTC', 'USDT', 1, 0, 1, 1),
  ('ETH-USDT-SWAP', 'ETH', 'USDT', 2, 0, 1, 2),
  ('SOL-USDT-SWAP', 'SOL', 'USDT', 3, 0, 1, 3)
ON DUPLICATE KEY UPDATE f_status = 1;

-- ── API Key ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_api_key (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_label VARCHAR(64) NOT NULL DEFAULT '',
  f_api_key VARCHAR(64) NOT NULL,
  f_api_secret_hash VARCHAR(128) NOT NULL,
  f_permissions VARCHAR(255) NOT NULL DEFAULT 'read,trade' COMMENT 'read,trade,withdraw',
  f_ip_whitelist VARCHAR(512) NOT NULL DEFAULT '',
  f_status TINYINT NOT NULL DEFAULT 1 COMMENT '1=active 0=revoked',
  f_last_used_at DATETIME NULL,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_api_key (f_api_key),
  KEY idx_api_key_user (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 用户通知 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_user_notification (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_type VARCHAR(32) NOT NULL COMMENT 'trade|deposit|withdraw|system|risk',
  f_title VARCHAR(128) NOT NULL,
  f_body VARCHAR(512) NOT NULL DEFAULT '',
  f_ref_id VARCHAR(64) NOT NULL DEFAULT '',
  f_read TINYINT NOT NULL DEFAULT 0,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_notification_user (f_user_id, f_id),
  KEY idx_notification_unread (f_user_id, f_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 交易风控限额 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS t_risk_limit (
  f_id INT NOT NULL AUTO_INCREMENT,
  f_role_key VARCHAR(32) NOT NULL DEFAULT 'normal_user',
  f_single_order_usd DECIMAL(36,2) NOT NULL DEFAULT 100000,
  f_daily_volume_usd DECIMAL(36,2) NOT NULL DEFAULT 1000000,
  f_orders_per_minute INT NOT NULL DEFAULT 60,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_risk_role (f_role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_risk_limit (f_role_key, f_single_order_usd, f_daily_volume_usd, f_orders_per_minute)
VALUES
  ('normal_user', 50000, 500000, 30),
  ('vip_user', 200000, 5000000, 120)
ON DUPLICATE KEY UPDATE f_single_order_usd = VALUES(f_single_order_usd);

-- ── 合约标记价 / 资金费率字段（幂等 ALTER）────────────────────────────
SET @has_mark := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_futures_symbol' AND COLUMN_NAME = 'f_mark_price'
);
SET @sql_mark := IF(
  @has_mark = 0,
  'ALTER TABLE t_futures_symbol
     ADD COLUMN f_mark_price DECIMAL(36,12) NOT NULL DEFAULT 0 AFTER f_funding_interval_hours,
     ADD COLUMN f_index_price DECIMAL(36,12) NOT NULL DEFAULT 0 AFTER f_mark_price,
     ADD COLUMN f_funding_rate DECIMAL(12,8) NOT NULL DEFAULT 0.0001 AFTER f_index_price,
     ADD COLUMN f_last_funding_at DATETIME NULL AFTER f_funding_rate',
  'SELECT 1'
);
PREPARE stmt FROM @sql_mark;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
