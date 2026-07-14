-- 平台公告、登录历史、TOTP 2FA
USE `velora`;

CREATE TABLE IF NOT EXISTS t_announcement (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_category VARCHAR(32) NOT NULL DEFAULT 'listing' COMMENT 'listing|maintenance|risk|system',
  f_title_zh VARCHAR(255) NOT NULL,
  f_title_en VARCHAR(255) NOT NULL,
  f_summary_zh VARCHAR(512) NOT NULL DEFAULT '',
  f_summary_en VARCHAR(512) NOT NULL DEFAULT '',
  f_content_zh TEXT NOT NULL,
  f_content_en TEXT NOT NULL,
  f_pinned TINYINT NOT NULL DEFAULT 0,
  f_status TINYINT NOT NULL DEFAULT 1 COMMENT '1=published 0=draft',
  f_publish_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_ann_publish (f_status, f_publish_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_login_session (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_user_id BIGINT NOT NULL,
  f_ip VARCHAR(64) NOT NULL DEFAULT '',
  f_user_agent VARCHAR(512) NOT NULL DEFAULT '',
  f_device_label VARCHAR(128) NOT NULL DEFAULT '',
  f_success TINYINT NOT NULL DEFAULT 1,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  KEY idx_login_user (f_user_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_user_2fa (
  f_user_id BIGINT NOT NULL,
  f_secret VARCHAR(64) NOT NULL,
  f_enabled TINYINT NOT NULL DEFAULT 0,
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  f_update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (f_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO t_announcement (
  f_category, f_title_zh, f_title_en, f_summary_zh, f_summary_en,
  f_content_zh, f_content_en, f_pinned, f_status, f_publish_time
) SELECT * FROM (
  SELECT
    'system' AS f_category,
    'Velora 交易所正式上线内测' AS f_title_zh,
    'Velora Exchange Public Beta Launch' AS f_title_en,
    '欢迎体验现货与永续合约交易。' AS f_summary_zh,
    'Welcome to spot and perpetual futures trading.' AS f_summary_en,
    'Velora 现已开放现货与 USDT 永续合约交易，支持资金账户、交易账户与合约账户划转。请妥善保管账户凭证并启用两步验证。' AS f_content_zh,
    'Velora now supports spot and USDT perpetual futures with funding, trading and futures account transfers. Please secure your credentials and enable 2FA.' AS f_content_en,
    1 AS f_pinned,
    1 AS f_status,
    NOW() AS f_publish_time
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM t_announcement LIMIT 1);
