import dotenv from "dotenv";
import path from "path";

/** 运行时配置结构 */
export interface AppConfig {
  port: number;
  env: string;
  isDev: boolean;
  isProd: boolean;
  clientOrigins: string[];
  jwtSecret: string;
  jwtExpiresIn: string;
  authSkipPaths: string[];
  marketRateLimitPerMin: number;
  binanceRestBaseUrl: string;
  binanceWsBaseUrl: string;
  marketWsPath: string;
  eventsWsPath: string;
  privateWsPath: string;
  liquidationWorkerEnabled: boolean;
  eventsWsRequireAuth: boolean;
  mail: {
    enabled: boolean;
    resendApiKey: string;
    from: string;
  };
  db: {
    enabled: boolean;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
    asm: string;
  };
  strategy: {
    platformFeeRate: number;
    paperWatchIntervalMs: number;
    copyWatchIntervalMs: number;
  };
  exchange: {
    credentialsKey: string;
    okxRestBaseUrl: string;
  };
  didit: {
    enabled: boolean;
    apiKey: string;
    workflowId: string;
    webhookSecret: string;
    baseUrl: string;
    callbackUrl: string;
  };
  kyc: {
    /** 开发阶段：提交证件后自动通过，无需 Didit / 人工审核 */
    devAutoApprove: boolean;
  };
  billing: {
    enabled: boolean;
    orderExpireMinutes: number;
    devAutoConfirm: boolean;
    autoUpgradeVip: boolean;
    watchIntervalMs: number;
    paymentWebhookUrl: string;
    paymentWebhookSecret: string;
    tron: {
      usdtContract: string;
      apiBaseUrl: string;
      apiKey: string;
      depositXpub: string;
      treasuryAddress: string;
    };
  };
}

const env = process.env.NODE_ENV || "development";
// override: true — 以 .env.* 文件为准，避免 PM2 旧环境变量把新 key「锁死」
dotenv.config({
  path: path.resolve(process.cwd(), `.env.${env}`),
  override: true,
});

function envBool(key: string, fallback = false): boolean {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value === "true";
}

function envList(key: string, fallback: string): string[] {
  return (process.env[key] || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const development: AppConfig = {
  port: parseInt(process.env.PORT || "4000", 10),
  env: "development",
  isDev: true,
  isProd: false,
  clientOrigins: envList("CLIENT_ORIGINS", "http://localhost:3000"),
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  authSkipPaths: envList(
    "AUTH_SKIP_PATHS",
    "/health,/api/v1/market,/api/v1/dashboard,/api/v1/events,/api/v1/billing/plans,/api/v1/announcements,/ws/market,/ws/events,/ws/private",
  ),
  marketRateLimitPerMin: parseInt(process.env.MARKET_RATE_LIMIT_PER_MIN || "120", 10),
  binanceRestBaseUrl:
    process.env.BINANCE_REST_BASE_URL || "https://data-api.binance.vision",
  binanceWsBaseUrl:
    process.env.BINANCE_WS_BASE_URL || "wss://data-stream.binance.vision",
  marketWsPath: process.env.MARKET_WS_PATH || "/ws/market",
  eventsWsPath: process.env.EVENTS_WS_PATH || "/ws/events",
  privateWsPath: process.env.PRIVATE_WS_PATH || "/ws/private",
  liquidationWorkerEnabled: envBool("LIQUIDATION_WORKER_ENABLED", false),
  eventsWsRequireAuth: envBool("EVENTS_WS_REQUIRE_AUTH", false),
  mail: {
    enabled: envBool("MAIL_ENABLED", false),
    resendApiKey: process.env.RESEND_API_KEY || "",
    from: process.env.MAIL_FROM || "Velora <noreply@velora.com>",
  },
  db: {
    enabled: envBool("DB_ENABLED", false),
    host: process.env.DB_HOST || "",
    port: parseInt(process.env.DB_PORT || "4000", 10),
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "velora_dev",
    ssl: envBool("DB_SSL", true),
    asm: process.env.DB_ASM || "",
  },
  strategy: {
    platformFeeRate: parseFloat(process.env.STRATEGY_PLATFORM_FEE_RATE || "20"),
    paperWatchIntervalMs: parseInt(process.env.STRATEGY_PAPER_WATCH_INTERVAL_MS || "90000", 10),
    copyWatchIntervalMs: parseInt(process.env.STRATEGY_COPY_WATCH_INTERVAL_MS || "90000", 10),
  },
  exchange: {
    credentialsKey: process.env.EXCHANGE_CREDENTIALS_KEY || "",
    okxRestBaseUrl: process.env.OKX_REST_BASE_URL || "https://www.okx.com",
  },
  didit: {
    enabled: envBool("DIDIT_ENABLED", false),
    apiKey: process.env.DIDIT_API_KEY || "",
    workflowId: process.env.DIDIT_WORKFLOW_ID || "",
    webhookSecret: process.env.DIDIT_WEBHOOK_SECRET || "",
    baseUrl: process.env.DIDIT_API_BASE_URL || "https://verification.didit.me",
    callbackUrl: process.env.DIDIT_CALLBACK_URL || "",
  },
  kyc: {
    devAutoApprove: envBool("KYC_DEV_AUTO_APPROVE", true),
  },
  billing: {
    enabled: envBool("BILLING_ENABLED", true),
    orderExpireMinutes: parseInt(process.env.BILLING_ORDER_EXPIRE_MINUTES || "10", 10),
    devAutoConfirm: envBool("BILLING_DEV_AUTO_CONFIRM", true),
    autoUpgradeVip: envBool("BILLING_AUTO_UPGRADE_VIP", false),
    watchIntervalMs: parseInt(process.env.PAYMENT_WATCH_INTERVAL_MS || "15000", 10),
    paymentWebhookUrl: process.env.BILLING_PAYMENT_WEBHOOK_URL || "",
    paymentWebhookSecret: process.env.BILLING_PAYMENT_WEBHOOK_SECRET || "",
    tron: {
      usdtContract:
        process.env.TRON_USDT_CONTRACT || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      apiBaseUrl: process.env.TRONGRID_API_URL || "https://api.trongrid.io",
      apiKey: process.env.TRONGRID_API_KEY || "",
      depositXpub: process.env.TRON_DEPOSIT_XPUB || "",
      treasuryAddress: process.env.TRON_TREASURY_ADDRESS || "",
    },
  },
};

const production: AppConfig = {
  ...development,
  env: "production",
  isDev: false,
  isProd: true,
  clientOrigins: envList(
    "CLIENT_ORIGINS",
    "https://app.velora.com,https://velora.com,https://www.velora.com",
  ),
  billing: {
    ...development.billing,
    devAutoConfirm: envBool("BILLING_DEV_AUTO_CONFIRM", false),
  },
  kyc: {
    ...development.kyc,
    devAutoApprove: envBool("KYC_DEV_AUTO_APPROVE", false),
  },
};

/** 测试服与本地均用 NODE_ENV=development + .env.development（测试服 PORT=4001） */
const configs: Record<string, AppConfig> = {
  development,
  production,
  /** @deprecated 使用 development */
  pre: development,
  /** @deprecated 使用 development */
  test: development,
};

export const config = configs[env] ?? development;

if (!config.jwtSecret.trim()) {
  throw new Error(`JWT_SECRET is required — 请在 .env.${env} 中配置`);
}

if (
  config.db.enabled &&
  (!config.db.host.trim() || !config.db.user.trim() || !config.db.database.trim())
) {
  throw new Error("DB_HOST, DB_USER, DB_NAME are required when DB_ENABLED=true");
}
