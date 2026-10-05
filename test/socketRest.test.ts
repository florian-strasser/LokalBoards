import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HIDDEN_GRACE_MS, restWhenHidden } from "../app/utils/socketRest";

// When a tab holds its connection, when it lets go, and when it has to fetch
// what it is showing again. The real thing — a browser hanging up, a server
// going away under it, a board catching up — is driven end to end by
// tests/background-tab/run.mjs; this is the rules on their own.

// As much of a socket as the rules use, behaving the way Socket.IO's client
// does: hanging up says "disconnect" once, and only if there was a connection.
function fakeSocket() {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const socket = {
    connected: true,
    recovered: false,
    connects: 0,
    disconnects: 0,
    on(event: string, listener: (...args: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit(event: string, ...args: any[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    connect() {
      socket.connects++;
    },
    disconnect() {
      socket.disconnects++;
      if (!socket.connected) return;
      socket.connected = false;
      socket.emit("disconnect", "io client disconnect");
    },
    // What the far end does to it.
    drop(reason = "transport close") {
      socket.connected = false;
      socket.emit("disconnect", reason);
    },
    comeUp({ recovered = false } = {}) {
      socket.connected = true;
      socket.recovered = recovered;
      socket.emit("connect");
    },
  };
  return socket;
}

function fakeDocument(hidden = false) {
  const listeners: (() => void)[] = [];
  const doc = {
    hidden,
    addEventListener(_type: "visibilitychange", listener: () => void) {
      listeners.push(listener);
    },
    hide() {
      doc.hidden = true;
      listeners.forEach((listener) => listener());
    },
    show() {
      doc.hidden = false;
      listeners.forEach((listener) => listener());
    },
  };
  return doc;
}

// Resyncs run a moment after "connect", once the rooms have been rejoined.
const settle = () => Promise.resolve();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a tab that goes into the background", () => {
  it("keeps its connection for a minute, then hangs up", () => {
    const socket = fakeSocket();
    const doc = fakeDocument();
    restWhenHidden(socket, doc);

    doc.hide();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1);
    expect(socket.disconnects).toBe(0);
    vi.advanceTimersByTime(1);
    expect(socket.disconnects).toBe(1);
  });

  it("is not hung up on for glancing at another tab", () => {
    const socket = fakeSocket();
    const doc = fakeDocument();
    restWhenHidden(socket, doc);

    doc.hide();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS / 2);
    doc.show();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS * 2);
    expect(socket.disconnects).toBe(0);
    expect(socket.connects).toBe(0);
  });

  it("gets a fresh minute each time it is hidden", () => {
    const socket = fakeSocket();
    const doc = fakeDocument();
    restWhenHidden(socket, doc);

    doc.hide();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1000);
    doc.show();
    doc.hide();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS - 1000);
    expect(socket.disconnects).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(socket.disconnects).toBe(1);
  });

  it("connects again the moment it is looked at", () => {
    const socket = fakeSocket();
    const doc = fakeDocument();
    restWhenHidden(socket, doc);

    doc.hide();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(socket.connects).toBe(0);
    doc.show();
    expect(socket.connects).toBe(1);
  });

  it("hangs up a page that was opened in a tab nobody has looked at yet", () => {
    const socket = fakeSocket();
    restWhenHidden(socket, fakeDocument(true));
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    expect(socket.disconnects).toBe(1);
  });
});

describe("a connection that drops", () => {
  it("is left to reconnect by itself in a tab that is being looked at", () => {
    const socket = fakeSocket();
    restWhenHidden(socket, fakeDocument());
    socket.drop();
    // Socket.IO's own reconnecting is what brings it back; hanging up here
    // would switch that off.
    expect(socket.disconnects).toBe(0);
  });

  it("is left down in a hidden tab, instead of being retried all afternoon", () => {
    const socket = fakeSocket();
    const doc = fakeDocument();
    restWhenHidden(socket, doc);

    doc.hide();
    socket.drop();
    // Hanging up is what stops the client's reconnecting.
    expect(socket.disconnects).toBe(1);
    vi.advanceTimersByTime(HIDDEN_GRACE_MS * 10);
    expect(socket.disconnects).toBe(1);
    expect(socket.connects).toBe(0);

    doc.show();
    expect(socket.connects).toBe(1);
  });

  it("is left down in a hidden tab when it never managed to open", () => {
    const socket = fakeSocket();
    socket.connected = false;
    const doc = fakeDocument(true);
    restWhenHidden(socket, doc);

    socket.emit("connect_error", new Error("xhr poll error"));
    expect(socket.disconnects).toBe(1);
    doc.show();
    expect(socket.connects).toBe(1);
  });
});

describe("catching up", () => {
  it("is not asked of a page that has only just loaded", async () => {
    const socket = fakeSocket();
    const resync = vi.fn();
    restWhenHidden(socket, fakeDocument()).onResync(resync);

    socket.comeUp();
    await settle();
    expect(resync).not.toHaveBeenCalled();
  });

  it("is asked for after a tab was away", async () => {
    const socket = fakeSocket();
    const doc = fakeDocument();
    const resync = vi.fn();
    restWhenHidden(socket, doc).onResync(resync);

    doc.hide();
    vi.advanceTimersByTime(HIDDEN_GRACE_MS);
    doc.show();
    socket.comeUp();
    await settle();
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it("is asked for after a drop the server could not fill in", async () => {
    const socket = fakeSocket();
    const resync = vi.fn();
    restWhenHidden(socket, fakeDocument()).onResync(resync);

    socket.drop();
    socket.comeUp({ recovered: false });
    await settle();
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it("is not asked for when the server replayed what was missed", async () => {
    const socket = fakeSocket();
    const resync = vi.fn();
    restWhenHidden(socket, fakeDocument()).onResync(resync);

    socket.drop();
    socket.comeUp({ recovered: true });
    await settle();
    expect(resync).not.toHaveBeenCalled();
  });

  it("happens once per time away, not once per connection after it", async () => {
    const socket = fakeSocket();
    const resync = vi.fn();
    restWhenHidden(socket, fakeDocument()).onResync(resync);

    socket.drop();
    socket.comeUp();
    await settle();
    // Recovered connections after that have nothing to catch up on.
    socket.drop();
    socket.comeUp({ recovered: true });
    await settle();
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it("comes after the page has rejoined its rooms", async () => {
    const socket = fakeSocket();
    const order: string[] = [];
    restWhenHidden(socket, fakeDocument()).onResync(() => order.push("fetched"));
    // Registered later than the rules' own listener, as a component's is.
    socket.on("connect", () => order.push("joined"));

    socket.drop();
    socket.comeUp();
    await settle();
    expect(order).toEqual(["joined", "fetched"]);
  });

  it("stops being asked of something that has gone", async () => {
    const socket = fakeSocket();
    const resync = vi.fn();
    const stop = restWhenHidden(socket, fakeDocument()).onResync(resync);

    stop();
    socket.drop();
    socket.comeUp();
    await settle();
    expect(resync).not.toHaveBeenCalled();
  });

  it("is not stopped for everybody by one that throws", async () => {
    const socket = fakeSocket();
    const rules = restWhenHidden(socket, fakeDocument());
    const second = vi.fn();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    rules.onResync(() => {
      throw new Error("the board is gone");
    });
    rules.onResync(second);

    socket.drop();
    socket.comeUp();
    await settle();
    expect(second).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });
});
