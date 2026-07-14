-- 对照 OKX 架构图：补齐可无链上托管完成的表结构
USE `velora`;

-- 条件单：移动止盈 + OCO 分组
SET @has_callback := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_spot_algo_order' AND COLUMN_NAME = 'f_callback_rate'
);
SET @sql_callback := IF(
  @has_callback = 0,
  'ALTER TABLE t_spot_algo_order
     ADD COLUMN f_callback_rate DECIMAL(12,8) NULL AFTER f_quantity,
     ADD COLUMN f_peak_price DECIMAL(36,12) NULL AFTER f_callback_rate,
     ADD COLUMN f_group_no VARCHAR(32) NOT NULL DEFAULT '''' AFTER f_peak_price',
  'SELECT 1'
);
PREPARE stmt FROM @sql_callback;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- API Key：交易对白名单 + 调用日志
SET @has_sym_wl := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_api_key' AND COLUMN_NAME = 'f_symbol_whitelist'
);
SET @sql_sym_wl := IF(
  @has_sym_wl = 0,
  'ALTER TABLE t_api_key ADD COLUMN f_symbol_whitelist VARCHAR(1024) NOT NULL DEFAULT '''' AFTER f_ip_whitelist',
  'SELECT 1'
);
PREPARE stmt FROM @sql_sym_wl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS t_api_key_call_log (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_api_key VARCHAR(64) NOT NULL,
  f_method VARCHAR(16) NOT NULL,
  f_path VARCHAR(255) NOT NULL,
  f_status_code INT NOT NULL DEFAULT 200,
  f_ip VARCHAR(64) NOT NULL DEFAULT '',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_api_log_user (f_user_id, f_id),
  KEY idx_api_log_key (f_api_key, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 登录会话：可踢下线
SET @has_jti := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_login_session' AND COLUMN_NAME = 'f_jti'
);
SET @sql_jti := IF(
  @has_jti = 0,
  'ALTER TABLE t_login_session
     ADD COLUMN f_jti VARCHAR(64) NOT NULL DEFAULT '''' AFTER f_device_label,
     ADD COLUMN f_revoked TINYINT NOT NULL DEFAULT 0 AFTER f_success',
  'SELECT 1'
);
PREPARE stmt FROM @sql_jti;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 用户提现风控限额
CREATE TABLE IF NOT EXISTS t_user_withdraw_limit (
  f_user_id BIGINT NOT NULL,
  f_daily_usdt_limit DECIMAL(36,12) NOT NULL DEFAULT 50000,
  f_new_address_cooldown_hours INT NOT NULL DEFAULT 24,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 客服工单
CREATE TABLE IF NOT EXISTS t_support_ticket (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_ticket_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_category VARCHAR(32) NOT NULL DEFAULT 'general',
  f_subject VARCHAR(255) NOT NULL,
  f_body TEXT NOT NULL,
  f_status VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT 'open|replied|closed',
  f_admin_reply TEXT NULL,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_ticket_no (f_ticket_no),
  KEY idx_ticket_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户合约偏好（杠杆 / 保证金模式）
CREATE TABLE IF NOT EXISTS t_futures_preference (
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_leverage INT NOT NULL DEFAULT 10,
  f_margin_mode VARCHAR(16) NOT NULL DEFAULT 'cross',
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_user_id, f_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 账本：账户类型（资金/交易/合约）
SET @has_ledger_acct := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_account_ledger' AND COLUMN_NAME = 'f_account_type'
);
SET @sql_ledger_acct := IF(
  @has_ledger_acct = 0,
  'ALTER TABLE t_account_ledger
     ADD COLUMN f_account_type VARCHAR(16) NOT NULL DEFAULT ''trading'' COMMENT ''funding|trading|futures'' AFTER f_currency,
     ADD KEY idx_account_ledger_acct (f_user_id, f_account_type, f_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql_ledger_acct;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 现货订单：高级限价 TIF
SET @has_tif := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_spot_order' AND COLUMN_NAME = 'f_time_in_force'
);
SET @sql_tif := IF(
  @has_tif = 0,
  'ALTER TABLE t_spot_order
     ADD COLUMN f_time_in_force VARCHAR(16) NOT NULL DEFAULT ''gtc'' COMMENT ''gtc|post_only|ioc|fok'' AFTER f_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql_tif;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
