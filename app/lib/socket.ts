import { io } from "socket.io-client";
import { restWhenHidden } from "~/utils/socketRest";

// The app's one connection for live updates.
//
// It connects in a browser and nowhere else. This module is also run by the
// server while it renders a page, where there is no page address to connect
// back to: left to connect there, the client made itself the address
// `undefined//undefined//undefined`, failed, and went on trying every few
// seconds for as long as the server ran. The object still exists there, so the
// components that mention it render the same; it just never dials.
export const socket = io({ autoConnect: import.meta.client });

// In a browser, the connection follows whether anybody is looking at the tab,
// and whatever is on screen can ask to be told when it has to fetch itself
// again — see `restWhenHidden`.
const rest = import.meta.client ? restWhenHidden(socket, document) : null;

/**
 * Run `resync` whenever the connection comes back without the changes made in
 * the meantime having been replayed. Returns how to stop; call that when the
 * component goes.
 */
export const onResync = (resync: () => void): (() => void) =>
  rest ? rest.onResync(resync) : () => {};
