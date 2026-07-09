-- 管理端资金操作审计（模拟盘充值/调账）
USE `velora`;

CREATE TABLE IF NOT EXISTS t_admin_finance_op (
  f_id BIGINT NOT NULL AUTO_INCREMENT,
  f_op_no VARCHAR(32) NOT NULL COMMENT '操作单号',
  f_operator_id BIGINT NOT NULL COMMENT '操作管理员 userId',
  f_target_user_id BIGINT NOT NULL COMMENT '目标用户 userId',
  f_currency VARCHAR(16) NOT NULL,
  f_amount DECIMAL(36,12) NOT NULL COMMENT '变动额，正=充值 负=扣减',
  f_type VARCHAR(16) NOT NULL COMMENT 'credit|debit',
  f_remark VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  f_create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (f_id),
  UNIQUE KEY uniq_admin_finance_op_no (f_op_no),
  KEY idx_admin_finance_target (f_target_user_id, f_id),
  KEY idx_admin_finance_operator (f_operator_id, f_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
