import type { WebSocket } from "ws";

interface PrivateClient {
  socket: WebSocket;
  userId: number;
}

const clients = new Set<PrivateClient>();

function safeSend(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* noop */
  }
}

export function registerPrivateClient(userId: number, socket: WebSocket) {
  clients.add({ userId, socket });
}

export function unregisterPrivateClient(socket: WebSocket) {
  for (const c of clients) {
    if (c.socket === socket) {
      clients.delete(c);
    }
  }
}

export function pushToUser(userId: number, type: string, data: unknown) {
  for (const c of clients) {
    if (c.userId === userId) {
      safeSend(c.socket, { type, data, time: Date.now() });
    }
  }
}

export function pushAccountRefresh(userId: number) {
  pushToUser(userId, "account", { refresh: true });
}

export function pushOrderRefresh(userId: number, scope: "spot" | "futures" = "spot") {
  pushToUser(userId, "order", { refresh: true, scope });
}
