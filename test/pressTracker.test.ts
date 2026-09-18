import { describe, it, expect } from "vitest";
import { createPressTracker } from "../app/utils/pressTracker";

// Elements stand in as plain objects: the tracker only ever compares them.
const card = { name: "card" } as unknown as EventTarget;
const around = { name: "around" } as unknown as EventTarget;
const event = (target: EventTarget) => ({ target }) as unknown as Event;
const onSurface = (target: EventTarget | null) => target === around;

describe("createPressTracker", () => {
  it("counts a press that began and ended on the surface", () => {
    const press = createPressTracker();
    press.down(event(around));
    press.up(event(around));
    expect(press.stayed(event(around), onSurface)).toBe(true);
  });

  it("does not count a selection dragged out of the card", () => {
    // The browser reports this click on the space around the card, the
    // nearest element holding both ends.
    const press = createPressTracker();
    press.down(event(card));
    press.up(event(around));
    expect(press.stayed(event(around), onSurface)).toBe(false);
  });

  it("does not count a press that started outside and ended in the card", () => {
    const press = createPressTracker();
    press.down(event(around));
    press.up(event(card));
    expect(press.stayed(event(around), onSurface)).toBe(false);
  });

  it("does not count a click that landed somewhere else", () => {
    const press = createPressTracker();
    press.down(event(card));
    press.up(event(card));
    expect(press.stayed(event(card), onSurface)).toBe(false);
  });

  it("forgets the press once asked, so it cannot hold back a later click", () => {
    const press = createPressTracker();
    press.down(event(card));
    press.up(event(around));
    expect(press.stayed(event(around), onSurface)).toBe(false);
    // Enter on something out there: no pointer, so no ends.
    expect(press.stayed(event(around), onSurface)).toBe(true);
  });

  it("starts every press afresh", () => {
    const press = createPressTracker();
    press.down(event(card));
    press.up(event(card));
    press.down(event(around));
    // Let go where no listener saw it: the start alone still has to agree.
    expect(press.stayed(event(around), onSurface)).toBe(true);
  });
});
