import { describe, it, expect } from "vitest";
import { onlyTicksChanged } from "../server/utils/commentChecklist";

// A box in a comment can be ticked by anybody who may edit the board; the rest
// of the comment stays the author's.

const comment = "Before the launch:\n\n- [ ] Write the post\n- [x] Fix the form\n\nThanks!";

describe("onlyTicksChanged", () => {
  it("lets a box be ticked", () => {
    expect(onlyTicksChanged(comment, comment.replace("- [ ] Write", "- [x] Write"))).toBe(true);
  });

  it("and unticked", () => {
    expect(onlyTicksChanged(comment, comment.replace("- [x] Fix", "- [ ] Fix"))).toBe(true);
  });

  it("does not mind the Markdown being spelled differently, as the browser writes it out again", () => {
    const spelled = "Before the launch:\n\n* [x] Write the post\n* [x] Fix the form\n\nThanks!";
    expect(onlyTicksChanged(comment, spelled)).toBe(true);
    expect(onlyTicksChanged("- [ ] *soon*", "- [x] _soon_")).toBe(true);
  });

  it("refuses a change to the words", () => {
    expect(onlyTicksChanged(comment, comment.replace("Write the post", "Delete the post"))).toBe(false);
    expect(onlyTicksChanged(comment, comment.replace("Thanks!", "Thanks."))).toBe(false);
  });

  it("refuses a box added or taken away", () => {
    expect(onlyTicksChanged(comment, `${comment}\n\n- [ ] One more`)).toBe(false);
    expect(onlyTicksChanged(comment, comment.replace("- [x] Fix the form\n", ""))).toBe(false);
  });

  it("refuses anything for a comment without a checklist", () => {
    expect(onlyTicksChanged("Just words", "Just words")).toBe(false);
    expect(onlyTicksChanged("", "- [x] sneaked in")).toBe(false);
  });
});
