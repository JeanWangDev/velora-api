import { config } from "@/config";
import { FuturesEngineService } from "@/services/futures/futures-engine.service";

const INTERVAL_MS = 2_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

/** 合约引擎：标记价 / 限价撮合 / 强平 / 资金费率 */
export function startFuturesWorker() {
  if (!config.db.enabled || timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await FuturesEngineService.updateMarkPrices();
      await FuturesEngineService.updateUnrealizedPnl();
      await FuturesEngineService.matchOpenOrders();
      await FuturesEngineService.checkLiquidations();
      await FuturesEngineService.processFunding();
    } catch (err) {
      console.error("[futures-worker] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
  console.log(`[futures-worker] started (interval ${INTERVAL_MS}ms)`);
}

export function stopFuturesWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
