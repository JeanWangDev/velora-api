import { config } from "@/config";
import { SpotOrderService } from "@/services/spot/spot-order.service";
import { SpotAlgoOrderService } from "@/services/spot/spot-algo-order.service";

const INTERVAL_MS = 3_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

/** 启动现货撮合轮询：按实时行情价触发限价挂单成交（模拟盘） */
export function startSpotMatchingWorker() {
  if (!config.db.enabled || timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await SpotOrderService.matchOpenOrders();
      await SpotAlgoOrderService.processTriggers();
    } catch (err) {
      console.error("[spot-matching] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), INTERVAL_MS);
  console.log(`[spot-matching] worker started (interval ${INTERVAL_MS}ms)`);
}

export function stopSpotMatchingWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
