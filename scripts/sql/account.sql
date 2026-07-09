-- 资金账户：余额 + 流水（现货模拟盘）
USE `velora`;

-- 用户资金余额（每用户每币种一条）
CREATE TABLE IF NOT EXISTS t_account_balance (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL COMMENT '币种，如 USDT/BTC',
  f_available DECIMAL(36,12) NOT NULL DEFAULT 0 COMMENT '可用余额',
  f_frozen DECIMAL(36,12) NOT NULL DEFAULT 0 COMMENT '冻结余额',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_account_balance (f_user_id, f_currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 资金流水（充值/交易/手续费/冻结/解冻/提现）
CREATE TABLE IF NOT EXISTS t_account_ledger (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_currency VARCHAR(16) NOT NULL,
  f_type VARCHAR(16) NOT NULL COMMENT 'deposit|withdraw|trade|fee|freeze|unfreeze|credit',
  f_amount DECIMAL(36,12) NOT NULL COMMENT '变动额，正入负出',
  f_balance_after DECIMAL(36,12) NOT NULL COMMENT '变动后可用+冻结合计',
  f_ref_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联单号（订单/成交/充值）',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_account_ledger_user (f_user_id, f_id),
  KEY idx_account_ledger_ref (f_ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
