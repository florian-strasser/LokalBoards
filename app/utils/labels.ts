// A word, in exchange for the label that is that word on this board.
//
// The card never asks whether the label already existed: the same word is the
// same label, so the server answers with the one it already has or makes a new
// one, and either way what comes back is what the card should wear. Both the
// menu that adds a label and the pill that renames one need exactly this, which
// is why it is here rather than in one of them.
export async function resolveLabel(
  boardID: number,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const response: any = await $fetch("/api/data/labels", {
    method: "POST",
    body: { boardId: boardID, name },
  });
  return response?.label ?? null;
}

// The server's own limit, so a field stops where the request would.
export const LABEL_NAME_MAX = 64;
