-- 现货交易：交易对元数据 + 订单 + 成交
USE `velora`;

-- 现货交易对元数据（含精度、最小下单量），供交易/校验使用
CREATE TABLE IF NOT EXISTS t_spot_symbol (
  f_id INT NOT NULL AUTO_INCREMENT,
  f_symbol VARCHAR(32) NOT NULL COMMENT '交易对，如 BTC-USDT',
  f_base VARCHAR(16) NOT NULL COMMENT '基础币，如 BTC',
  f_quote VARCHAR(16) NOT NULL COMMENT '计价币，如 USDT',
  f_display_name VARCHAR(64) NOT NULL DEFAULT '',
  f_price_precision TINYINT NOT NULL DEFAULT 2,
  f_qty_precision TINYINT NOT NULL DEFAULT 6,
  f_min_qty DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_maker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.001,
  f_taker_fee DECIMAL(10,6) NOT NULL DEFAULT 0.001,
  f_sort_order INT NOT NULL DEFAULT 0,
  f_status TINYINT NOT NULL DEFAULT 1 COMMENT '1=trading 0=halt',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_spot_symbol (f_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 现货订单
CREATE TABLE IF NOT EXISTS t_spot_order (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_order_no VARCHAR(32) NOT NULL COMMENT '对外订单号',
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL COMMENT 'buy|sell',
  f_type VARCHAR(8) NOT NULL COMMENT 'limit|market',
  f_price DECIMAL(36,12) NULL COMMENT '限价单价格；市价单为空',
  f_quantity DECIMAL(36,12) NOT NULL COMMENT '下单数量（base）',
  f_filled_quantity DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_avg_price DECIMAL(36,12) NOT NULL DEFAULT 0 COMMENT '成交均价',
  f_quote_spent DECIMAL(36,12) NOT NULL DEFAULT 0 COMMENT '已花费/已获得计价币',
  f_fee DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_fee_currency VARCHAR(16) NOT NULL DEFAULT '',
  f_frozen_currency VARCHAR(16) NOT NULL DEFAULT '' COMMENT '冻结币种',
  f_frozen_amount DECIMAL(36,12) NOT NULL DEFAULT 0 COMMENT '当前冻结额',
  f_status VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT 'open|partial|filled|cancelled',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_spot_order_no (f_order_no),
  KEY idx_spot_order_user (f_user_id, f_id),
  KEY idx_spot_order_status (f_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 现货成交明细
CREATE TABLE IF NOT EXISTS t_spot_trade (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_trade_no VARCHAR(32) NOT NULL,
  f_order_id BIGINT NOT NULL,
  f_order_no VARCHAR(32) NOT NULL,
  f_user_id BIGINT NOT NULL,
  f_symbol VARCHAR(32) NOT NULL,
  f_side VARCHAR(8) NOT NULL,
  f_price DECIMAL(36,12) NOT NULL,
  f_quantity DECIMAL(36,12) NOT NULL,
  f_fee DECIMAL(36,12) NOT NULL DEFAULT 0,
  f_fee_currency VARCHAR(16) NOT NULL DEFAULT '',
  f_role VARCHAR(8) NOT NULL DEFAULT 'taker' COMMENT 'maker|taker',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_spot_trade_no (f_trade_no),
  KEY idx_spot_trade_user (f_user_id, f_id),
  KEY idx_spot_trade_order (f_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- seed：默认现货交易对（与前端展示一致）
INSERT INTO t_spot_symbol
  (f_symbol, f_base, f_quote, f_display_name, f_price_precision, f_qty_precision, f_min_qty, f_sort_order, f_status)
VALUES
  ('BTC-USDT', 'BTC', 'USDT', 'Bitcoin', 2, 6, 0.0001, 1, 1),
  ('ETH-USDT', 'ETH', 'USDT', 'Ethereum', 2, 5, 0.001, 2, 1),
  ('SOL-USDT', 'SOL', 'USDT', 'Solana', 3, 3, 0.01, 3, 1),
  ('BNB-USDT', 'BNB', 'USDT', 'BNB', 2, 4, 0.01, 4, 1),
  ('XRP-USDT', 'XRP', 'USDT', 'XRP', 4, 1, 1, 5, 1),
  ('DOGE-USDT', 'DOGE', 'USDT', 'Dogecoin', 5, 0, 10, 6, 1),
  ('ADA-USDT', 'ADA', 'USDT', 'Cardano', 4, 1, 1, 7, 1),
  ('AVAX-USDT', 'AVAX', 'USDT', 'Avalanche', 2, 3, 0.01, 8, 1),
  ('LINK-USDT', 'LINK', 'USDT', 'Chainlink', 3, 2, 0.01, 9, 1),
  ('DOT-USDT', 'DOT', 'USDT', 'Polkadot', 3, 2, 0.01, 10, 1)
ON DUPLICATE KEY UPDATE
  f_base = VALUES(f_base),
  f_quote = VALUES(f_quote),
  f_display_name = VALUES(f_display_name),
  f_price_precision = VALUES(f_price_precision),
  f_qty_precision = VALUES(f_qty_precision),
  f_min_qty = VALUES(f_min_qty),
  f_sort_order = VALUES(f_sort_order),
  f_status = VALUES(f_status);
