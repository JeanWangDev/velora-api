import type { IncomingMessage } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "@/config";
import { UnauthorizedError } from "@/errors/app-error";
import { verifyAccessToken } from "@/utils/jwt";
import { extractWsToken } from "@/ws/ws-auth";
import {
  pushAccountRefresh,
  registerPrivateClient,
  unregisterPrivateClient,
} from "@/ws/private-broadcast";
import { rawDataToString } from "@/utils/ws-message";

const HEARTBEAT_INTERVAL_MS = 30_000;

function safeSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* noop */
  }
}

export function createPrivateWsServer(): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    path: config.privateWsPath,
  });

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    let userId: number | null = null;
    let isAlive = true;

    try {
      const token = extractWsToken(request);
      if (!token) throw new UnauthorizedError("缺少 token");
      const user = verifyAccessToken(token);
      userId = Number(user.id);
      if (!Number.isFinite(userId) || userId <= 0) {
        throw new UnauthorizedError("无效 token");
      }
    } catch (error) {
      safeSend(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "鉴权失败",
      });
      socket.close();
      return;
    }

    registerPrivateClient(userId!, socket);

    socket.on("pong", () => {
      isAlive = true;
    });

    const heartbeat = setInterval(() => {
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      try {
        socket.ping();
      } catch {
        /* noop */
      }
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      unregisterPrivateClient(socket);
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);

    socket.on("message", (raw) => {
      try {
        const json = JSON.parse(rawDataToString(raw)) as { op?: string; id?: string };
        if (json.op === "ping") {
          safeSend(socket, { type: "pong", id: json.id });
          return;
        }
        if (json.op === "refresh") {
          pushAccountRefresh(userId!);
        }
      } catch {
        safeSend(socket, { type: "error", message: "Malformed message" });
      }
    });

    safeSend(socket, {
      type: "hello",
      path: config.privateWsPath,
      time: Date.now(),
    });
  });

  return wss;
}
