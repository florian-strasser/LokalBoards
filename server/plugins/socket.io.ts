import type { NitroApp } from "nitropack";
import { Server as Engine } from "engine.io";
import { Server } from "socket.io";
import { defineEventHandler } from "h3";
import { setServerSocket } from "../utils/socket";
import { setupDatabase } from "../../app/lib/databaseSetup";
import { authorizeBoard, resolveSessionToken } from "../utils/auth";

export default defineNitroPlugin((nitroApp: NitroApp) => {
  const engine = new Engine();
  const io = new Server({
    // Recover the session after a brief disconnection (background-tab timer
    // throttling, a network blip, or a proxy idle timeout) instead of doing a
    // cold reconnect: the socket keeps its id and rooms, and any board events
    // missed during the gap are replayed. Reduces the "connection was lost"
    // churn seen after sitting on a board for a while.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  // Set the server socket for API access
  setServerSocket(io);

  io.bind(engine);

  const db = setupDatabase();

  // Sockets carry the same session cookie as the rest of the app, so the
  // connection can be tied to a real account instead of trusting whatever the
  // client claims to be. Anonymous connections are still allowed (the handshake
  // is shared with clients that only listen), but they are given no identity and
  // pass no access check, so they can neither read nor inject anything.
  //
  // The lookup itself is remembered, not a flag saying it has started: a client
  // that joins its board and its card in the same tick calls this twice at once,
  // and a flag set before the `await` made the second call read the session as
  // "resolved, nobody". Its access check then failed and the card was never
  // joined — so a card opened straight after the page loaded received no live
  // comments or presence until it was closed and opened again.
  const sessionUser = (socket: any): Promise<any> => {
    socket.data.userPromise ??= (async () => {
      try {
        const cookie = socket.handshake.headers?.cookie || "";
        const token = cookie
          .split(";")
          .map((c: string) => c.trim())
          .find((c: string) => c.startsWith("session_token="))
          ?.slice("session_token=".length);
        if (!token) return null;
        const result = await resolveSessionToken(decodeURIComponent(token));
        return result.status === "ok" ? result.user : null;
      } catch (err) {
        logger.error("Socket session resolution failed:", err);
        return null;
      }
    })();
    return socket.data.userPromise;
  };

  // Board access for a socket, memoised briefly: these checks sit in front of
  // every realtime event, and a board's membership does not change per keystroke.
  const ACCESS_TTL_MS = 30_000;
  const canAccessBoard = async (socket: any, boardId: any) => {
    const id = Number(boardId);
    if (!Number.isInteger(id) || id <= 0) return false;
    const user = await sessionUser(socket);
    if (!user) return false;

    socket.data.access ??= new Map<number, { ok: boolean; at: number }>();
    const cached = socket.data.access.get(id);
    if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached.ok;

    let ok = false;
    try {
      const [[board]]: any = await db.query(
        "SELECT * FROM `boards` WHERE id = ?",
        [id],
      );
      if (board) {
        const decision = await authorizeBoard(db, board, user.id, "read");
        ok = !!decision.ok;
      }
    } catch (err) {
      logger.error("Socket board access check failed:", err);
    }
    socket.data.access.set(id, { ok, at: Date.now() });
    return ok;
  };

  // Which board a card belongs to. Cached because comment events are per card.
  const boardOfCard = async (cardID: any) => {
    const id = Number(cardID);
    if (!Number.isInteger(id) || id <= 0) return null;
    try {
      const [[row]]: any = await db.query(
        "SELECT a.board AS board FROM cards c JOIN areas a ON a.id = c.area WHERE c.id = ?",
        [id],
      );
      return row?.board ?? null;
    } catch (err) {
      logger.error("Socket card lookup failed:", err);
      return null;
    }
  };

  const canAccessCard = async (socket: any, cardID: any) => {
    const boardId = await boardOfCard(cardID);
    return boardId ? canAccessBoard(socket, boardId) : false;
  };

  // Live presence: who currently has a card open, keyed by card id then socket
  // id. Purely in-memory — it describes "right now", so losing it on restart is
  // correct. Multiple tabs of the same person collapse to one entry.
  const cardPresence = new Map<string, Map<string, any>>();

  // Which board a card belongs to, learned from joinCard. Needed so presence can
  // also be broadcast to everyone looking at the board (the faces on the tiles),
  // not just to those inside the card.
  const cardBoard = new Map<string, string>();

  const presenceUsers = (cardID: string | number) => {
    const sockets = cardPresence.get(String(cardID));
    if (!sockets) return [];
    const byUser = new Map<string, any>();
    for (const user of sockets.values()) {
      if (user?.id) byUser.set(user.id, user);
    }
    return Array.from(byUser.values());
  };

  const broadcastPresence = (cardID: string | number) => {
    const payload = {
      cardID: Number(cardID),
      users: presenceUsers(cardID),
    };
    io.to(`card-${cardID}`).emit("cardPresence", payload);
    const boardId = cardBoard.get(String(cardID));
    if (boardId) io.to(`board-${boardId}`).emit("cardPresence", payload);
  };

  const dropPresence = (socketId: string, cardID?: string) => {
    const keys = cardID ? [String(cardID)] : Array.from(cardPresence.keys());
    for (const key of keys) {
      const sockets = cardPresence.get(key);
      if (sockets?.delete(socketId)) {
        if (sockets.size === 0) cardPresence.delete(key);
        broadcastPresence(key);
        // Forget the board mapping only once nobody is left on the card, so the
        // broadcast above can still reach the board room.
        if (!cardPresence.has(key)) cardBoard.delete(key);
      }
    }
  };

  // Everything currently open on a board — sent to a client as it joins, since
  // it would otherwise only learn about presence from the next change.
  const boardPresence = (boardId: string | number) => {
    const entries = [];
    for (const [cardID, board] of cardBoard) {
      if (String(board) !== String(boardId)) continue;
      const users = presenceUsers(cardID);
      if (users.length) entries.push({ cardID: Number(cardID), users });
    }
    return entries;
  };

  io.on("connection", (socket) => {
    logger.debug("A user connected:", socket.id);

    // The caller's own dashboard room. Unlike a board room this is not gated on
    // a board — it is the user's own — so the session decides the name and a
    // client cannot ask to listen to somebody else's.
    socket.on("joinDashboard", async () => {
      const user = await sessionUser(socket);
      if (!user) return;
      socket.join(`dashboard-${user.id}`);
      socket.join(`user-${socket.id}`);
      logger.debug(`User ${socket.id} joined dashboard ${user.id}`);
    });

    // Handle joining a board
    socket.on("joinBoard", async ({ boardId }) => {
      // Room membership is what decides who receives a board's realtime events
      // and its presence, so it has to be gated on real access — not on the
      // client asking nicely.
      if (!(await canAccessBoard(socket, boardId))) return;
      socket.join(`board-${boardId}`);
      socket.join(`user-${socket.id}`);
      // Catch the joiner up on who is currently in which card.
      socket.emit("boardPresence", {
        boardId: Number(boardId),
        cards: boardPresence(boardId),
      });
      logger.debug(`User ${socket.id} joined board ${boardId}`);
    });

    // Handle joining a card. When the client sends its `user`, the socket also
    // counts towards the card's live presence (the faces shown in the modal).
    socket.on("joinCard", async ({ cardID, boardID, user: _ignored }) => {
      // The identity shown to everyone else comes from the session, never from
      // the client: otherwise anyone could put someone else's face on a card.
      const me = await sessionUser(socket);
      const boardId = await boardOfCard(cardID);
      if (!boardId || !(await canAccessBoard(socket, boardId))) return;

      socket.join(`card-${cardID}`);
      socket.join(`user-${socket.id}`);
      if (me?.id) {
        const key = String(cardID);
        cardBoard.set(key, String(boardId));
        if (!cardPresence.has(key)) cardPresence.set(key, new Map());
        cardPresence.get(key)!.set(socket.id, {
          id: me.id,
          name: me.name,
          image: me.image,
          type: me.type || "human",
        });
        broadcastPresence(cardID);
      } else {
        // No identity to add (e.g. an API/read-only client), but the joiner
        // still needs to know who is already on the card — otherwise it sees
        // nobody until the next person comes or goes.
        socket.emit("cardPresence", {
          cardID: Number(cardID),
          users: presenceUsers(cardID),
        });
      }
      logger.debug(`User ${socket.id} joined card ${cardID}`);
    });

    // Leaving a card (modal closed) — drop presence and stop receiving its events.
    socket.on("leaveCard", ({ cardID }) => {
      socket.leave(`card-${cardID}`);
      dropPresence(socket.id, String(cardID));
    });

    // A closed tab / lost connection leaves every card it was present on.
    socket.on("disconnect", () => {
      dropPresence(socket.id);
    });

    // CommentCreated
    socket.on("commentCreated", async ({ cardID, comment }) => {
      if (!(await canAccessCard(socket, cardID))) return;
      logger.debug(
        `Kommentar ${comment.id} wurde auf Card ${cardID} erstellt (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`card-${cardID}`).emit("addComment", {
        comment,
        cardID,
      });
    });

    // CommentDeleted
    socket.on("commentDeleted", async ({ cardID, commentId }) => {
      if (!(await canAccessCard(socket, cardID))) return;
      logger.debug(
        `Kommentar ${commentId} wurde auf Card ${cardID} gelöscht (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`)
        .to(`card-${cardID}`)
        .emit("deleteComment", {
          commentId,
          cardID,
        });
    });

    // CommentUpdated
    socket.on("commentUpdated", async ({ cardID, comment }) => {
      if (!(await canAccessCard(socket, cardID))) return;
      logger.debug(
        `Kommentar ${comment.id} wurde auf Card ${cardID} aktualisiert (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`)
        .to(`card-${cardID}`)
        .emit("updateComment", {
          comment,
          cardID,
        });
    });

    // BoardUpdated
    socket.on(
      "boardUpdated",
      async ({
        boardID,
        boardName,
        boardStatus,
        boardStyle,
        boardImage,
        boardColor,
      }) => {
        if (!(await canAccessBoard(socket, boardID))) return;
        logger.debug(`Board ${boardID} wurde aktualisiert (user-${socket.id})`);
        io.except(`user-${socket.id}`)
          .to(`board-${boardID}`)
          .emit("updateBoard", {
            boardID,
            boardName,
            boardStatus,
            boardStyle,
            boardImage,
            boardColor,
          });
      },
    );

    // BoardDeleted
    socket.on("boardDeleted", async ({ boardID }) => {
      if (!(await canAccessBoard(socket, boardID))) return;
      logger.debug(`Board ${boardID} wurde gelöscht (user-${socket.id})`);
      io.except(`user-${socket.id}`)
        .to(`board-${boardID}`)
        .emit("deletedBoard", {
          boardID,
        });
    });

    // AreasUpdated
    socket.on("areasUpdated", async ({ boardId, areas }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Area-Sortierung wurde auf Board ${boardId} angepasst (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`)
        .to(`board-${boardId}`)
        .emit("updateAreas", {
          areas,
          boardId,
        });
    });

    // AreaCreated
    socket.on("areaCreated", async ({ boardId, area }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Area ${area.id} wurde auf Board ${boardId} erstellt (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`board-${boardId}`).emit("addArea", {
        area,
        boardId,
      });
    });

    // AreaUpdated
    socket.on("areaUpdated", async ({ boardId, area }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Area ${area.id} wurde auf Board ${boardId} aktualisiert (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`board-${boardId}`).emit("updateArea", {
        area,
        boardId,
      });
    });

    // AreaDeleted
    socket.on("areaDeleted", async ({ boardId, area }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Area ${area} wurde auf Board ${boardId} gelöscht (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`board-${boardId}`).emit("deleteArea", {
        area,
        boardId,
      });
    });

    // CardCreated
    socket.on("cardCreated", async ({ boardId, card }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Karte ${card.id} wurde auf Board ${boardId} erstellt (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`board-${boardId}`).emit("addCard", {
        card,
        boardId,
      });
    });

    // CardUpdated
    socket.on("cardUpdated", async ({ boardId, attachments, card }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Karte ${card.id} wurde auf Board ${boardId} aktualisiert (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`board-${boardId}`).emit("updateCard", {
        card,
        attachments,
        boardId,
      });
    });

    // CardMoved
    socket.on(
      "cardMoved",
      async ({ boardId, cardId, fromAreaId, toAreaId, newIndex }) => {
        if (!(await canAccessBoard(socket, boardId))) return;
        logger.debug(
          `Karte ${cardId} wurde von Area #${fromAreaId} zu #${toAreaId} auf Board ${boardId} geschoben (user-${socket.id})`,
        );
        io.except(`user-${socket.id}`)
          .to(`board-${boardId}`)
          .emit("movedCard", {
            cardId,
            fromAreaId,
            toAreaId,
            newIndex,
            boardId,
          });
      },
    );

    // CardOrderd
    socket.on("cardOrderd", async ({ boardId, cardId, areaId, newIndex }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Karte ${cardId} wurde innerhalb von Area #${areaId} auf Board ${boardId} sortiert (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`).to(`board-${boardId}`).emit("orderdCard", {
        cardId,
        areaId,
        newIndex,
        boardId,
      });
    });

    // CardDeleted
    socket.on("cardDeleted", async ({ boardId, card }) => {
      if (!(await canAccessBoard(socket, boardId))) return;
      logger.debug(
        `Card ${card.id} wurde auf Board ${boardId} gelöscht (user-${socket.id})`,
      );
      io.except(`user-${socket.id}`)
        .to(`board-${boardId}`)
        .emit("deletedCard", {
          boardId,
          card,
        });
    });

    // CommentCountUpdated
    socket.on(
      "commentCountUpdated",
      async ({ boardId, cardId, commentCount }) => {
        if (!(await canAccessBoard(socket, boardId))) return;
        logger.debug(
          `Comment count updated for card ${cardId} on board ${boardId} (user-${socket.id})`,
        );
        io.except(`user-${socket.id}`)
          .to(`board-${boardId}`)
          .emit("commentCountUpdated", {
            cardId,
            commentCount,
            boardId,
          });
      },
    );
  });

  nitroApp.router.use(
    "/socket.io/",
    defineEventHandler({
      handler(event) {
        engine.handleRequest(event.node.req, event.node.res);
        event._handled = true;
      },
      websocket: {
        open(peer) {
          // @ts-expect-error private method and property
          engine.prepare(peer._internal.nodeReq);
          // @ts-expect-error private method and property
          engine.onWebSocket(
            peer._internal.nodeReq,
            peer._internal.nodeReq.socket,
            peer.websocket,
          );
        },
      },
    }),
  );
});
