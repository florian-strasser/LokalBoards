// A tab nobody is looking at does not hold a connection.
//
// The app's one socket used to stay up for as long as the page was open, and
// come back by itself whenever it dropped. In a tab that has been put in the
// background that is a losing game: the browser throttles the page until it
// cannot keep up the heartbeat, something along the way gives the connection
// up, the client reconnects, and it happens again — for as long as the tab sits
// there. Safari reports each one in the console as a WebSocket that "failed:
// The network connection was lost", so coming back to a board after lunch
// meant a column of red, and a server that had spent the hour shaking hands
// with a page nobody was reading.
//
// So a hidden tab hangs up — properly, after a minute's grace, so that
// glancing at another tab and back costs nothing and nobody watching the board
// sees you leave and return. While it is hidden it stays down: a connection
// that drops in that minute is not picked up again either. The moment the tab
// is looked at, it connects.
//
// What that leaves is the time away. The server keeps a short memory of each
// connection and replays what was missed to one that comes back within two
// minutes (`connectionStateRecovery` in server/plugins/socket.io.ts); a tab
// that was away longer, or hung up on purpose, gets nothing replayed and until
// now simply showed the board as it had been when it left, until the page was
// reloaded. `onResync` is for that: whatever is on screen registers how to
// fetch itself again, and is asked to whenever a connection comes up without
// the gap having been filled in.
//
// Written against the little of a socket and a document it uses, so the rules
// can be run in a test without a browser or a server.

export interface RestableSocket {
  /** True when the server replayed everything missed since the last connection. */
  recovered?: boolean;
  connect(): unknown;
  disconnect(): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface HideableDocument {
  hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
}

/** How long a hidden tab keeps its connection. */
export const HIDDEN_GRACE_MS = 60_000;

export function restWhenHidden(
  socket: RestableSocket,
  doc: HideableDocument,
  graceMs: number = HIDDEN_GRACE_MS,
) {
  // Hung up because the tab is hidden, to be connected again when it is not.
  let resting = false;
  // Something may have happened that this tab did not hear about.
  let missed = false;
  let grace: ReturnType<typeof setTimeout> | null = null;
  const resyncs = new Set<() => void>();

  const stopGrace = () => {
    if (grace) clearTimeout(grace);
    grace = null;
  };

  // `disconnect()` rather than letting it die: it tells the server, which takes
  // this person off the board's "who is here" at once instead of a ping timeout
  // later, and it stops the client's own reconnecting.
  const rest = () => {
    stopGrace();
    if (resting) return;
    resting = true;
    missed = true;
    socket.disconnect();
  };

  const wake = () => {
    stopGrace();
    if (!resting) return;
    resting = false;
    socket.connect();
  };

  const startGrace = () => {
    if (grace || resting) return;
    grace = setTimeout(() => {
      grace = null;
      // Looked at again in the meantime, and the timer was late to hear of it.
      if (doc.hidden) rest();
    }, graceMs);
  };

  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) startGrace();
    else wake();
  });
  // A page opened in a tab that has not been looked at yet says nothing about
  // becoming hidden: it starts that way.
  if (doc.hidden) startGrace();

  // Dropped — by the network, the server restarting, or the browser itself. In
  // a tab that is being looked at the client reconnects on its own and that is
  // right. In a hidden one it is the start of the loop described above, so the
  // connection is left down until somebody is there to use it.
  socket.on("disconnect", () => {
    missed = true;
    if (doc.hidden) rest();
  });
  // The same for a connection that never got as far as opening.
  socket.on("connect_error", () => {
    if (doc.hidden) rest();
  });

  socket.on("connect", () => {
    const stale = missed && !socket.recovered;
    missed = false;
    if (!stale) return;
    // After the other "connect" listeners, which are how a page gets back into
    // its rooms: joined first, then fetched, so nothing can fall between the
    // two.
    queueMicrotask(() => {
      for (const resync of [...resyncs]) {
        try {
          resync();
        } catch (error) {
          console.error("Could not catch up after reconnecting:", error);
        }
      }
    });
  });

  return {
    /**
     * Run `resync` whenever a connection comes up without what was missed in
     * between having been replayed. Returns how to stop.
     */
    onResync(resync: () => void): () => void {
      resyncs.add(resync);
      return () => resyncs.delete(resync);
    },
  };
}
