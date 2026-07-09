-- 移除历史 VIP 分层字段 f_access_tier（已废弃）。幂等：列不存在时跳过。
USE `velora`;

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 't_trading_symbol'
    AND COLUMN_NAME = 'f_access_tier'
);
SET @sql := IF(@col > 0, 'ALTER TABLE t_trading_symbol DROP COLUMN f_access_tier', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
