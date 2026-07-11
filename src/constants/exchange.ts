/** 系统流动性提供账户（LP），用于市价单与穿越限价的外部流动性兜底 */
export const SYSTEM_LP_USER_ID = 1;

export const ACCOUNT_TYPES = ["funding", "trading", "futures"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const WITHDRAW_FEE_RATES: Record<string, { rate: number; min: number }> = {
  USDT: { rate: 0.001, min: 1 },
  BTC: { rate: 0.0005, min: 0.0001 },
  ETH: { rate: 0.0005, min: 0.001 },
};

export const DEPOSIT_CHAINS: Record<string, string[]> = {
  USDT: ["TRC20", "ERC20", "BEP20"],
  BTC: ["BTC"],
  ETH: ["ERC20", "Arbitrum"],
  BNB: ["BEP20"],
};
