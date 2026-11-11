import { Server } from "socket.io";

let serverSocket: Server | undefined;

export function setServerSocket(socket: Server) {
  serverSocket = socket;
}

export function getServerSocket(): Server {
  if (!serverSocket) {
    throw new Error("Server socket not initialized");
  }
  return serverSocket;
}

// Tell everyone who has a board — or one card on it — open. Quiet when the
// socket server is not running, as in the integration tests.
//
// A change made in the browser is sent on by that browser itself, so the
// server only sends what reached it some other way: through the REST API with
// a key, or from an agent over MCP. Callers pass that as `when`.
export function emitToBoard(
  boardId: number | string,
  name: string,
  payload: Record<string, unknown>,
  when = true,
) {
  if (when) serverSocket?.to(`board-${boardId}`).emit(name, payload);
}

export function emitToCard(
  cardId: number | string,
  name: string,
  payload: Record<string, unknown>,
  when = true,
) {
  if (when) serverSocket?.to(`card-${cardId}`).emit(name, payload);
}
