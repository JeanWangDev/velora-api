import { EarnService } from "@/services/platform/earn.service";
import { OptionService } from "@/services/platform/options.service";
import { DepositWatcherService, SettlementService } from "@/services/platform/compliance.service";
import { checkCrossLiquidations } from "@/services/futures/adl.service";

const EARN_INTERVAL = 24 * 60 * 60 * 1000;
const DEPOSIT_INTERVAL = 60_000;
const SETTLE_INTERVAL = 24 * 60 * 60 * 1000;

let earnTimer: NodeJS.Timeout | null = null;
let depositTimer: NodeJS.Timeout | null = null;
let settleTimer: NodeJS.Timeout | null = null;

export function startPlatformWorker() {
  if (earnTimer) return;

  const earnTick = async () => {
    try {
      const n = await EarnService.accrueDaily();
      if (n > 0) console.log(`[platform-worker] earn accrual: ${n} positions`);
    } catch (e) {
      console.error("[platform-worker] earn failed:", (e as Error).message);
    }
  };

  const depositTick = async () => {
    try {
      const n = await DepositWatcherService.scanTrc20Deposits();
      if (n > 0) console.log(`[platform-worker] deposits matched: ${n}`);
    } catch (e) {
      console.error("[platform-worker] deposit scan failed:", (e as Error).message);
    }
  };

  const settleTick = async () => {
    try {
      const batch = await SettlementService.runDailyBatch();
      console.log(`[platform-worker] settlement batch: ${batch}`);
      await OptionService.settleExpired();
      await checkCrossLiquidations();
    } catch (e) {
      console.error("[platform-worker] settlement failed:", (e as Error).message);
    }
  };

  earnTimer = setInterval(() => void earnTick(), EARN_INTERVAL);
  depositTimer = setInterval(() => void depositTick(), DEPOSIT_INTERVAL);
  settleTimer = setInterval(() => void settleTick(), SETTLE_INTERVAL);

  void depositTick();
  console.log("[platform-worker] started");
}

export function stopPlatformWorker() {
  if (earnTimer) clearInterval(earnTimer);
  if (depositTimer) clearInterval(depositTimer);
  if (settleTimer) clearInterval(settleTimer);
  earnTimer = depositTimer = settleTimer = null;
}
