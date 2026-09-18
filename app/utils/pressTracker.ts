// Where a press began and where it ended.
//
// A click is reported on the nearest element that holds both ends of the press
// behind it. Select a sentence inside a card, let go beside the card, and the
// browser reports a click on the space around it — which is where "close" is
// listening, so the card closed under the selection. The search results and the
// notifications panel, which close on a click outside them, did the same.
//
// A click is only what it looks like when the whole press happened there, so
// the places that close on one ask exactly that: they note both ends of every
// press, then ask about the click that follows.

type Where = (target: EventTarget | null) => boolean;

export function createPressTracker() {
  let began: EventTarget | null = null;
  let ended: EventTarget | null = null;

  return {
    down(event: Event) {
      began = event.target;
      ended = null;
    },
    up(event: Event) {
      ended = event.target;
    },
    /**
     * Whether the press behind `click` began and ended where `where` says, and
     * the click itself landed there too.
     *
     * Asking forgets the press. A click no pointer made — Enter on a button —
     * has no ends of its own, and is judged by where it lands.
     */
    stayed(click: Event, where: Where): boolean {
      const ends = [began, ended];
      began = ended = null;
      return [...ends.filter((end) => end !== null), click.target].every(where);
    },
  };
}
