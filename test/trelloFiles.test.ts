import { describe, it, expect } from "vitest";
import { bringTrelloFiles } from "../server/utils/trelloFiles";
import {
  isTrelloAttachmentUrl,
  trelloAuthHeader,
  trelloToken,
} from "../server/utils/trelloDownload";
import type { ImportBoard, ImportFile } from "../server/utils/boardImport";

// The shapes a private board's export has, as the user's own export showed:
// a pasted picture is a Markdown image of a preview of one of the card's
// attachments.
const card = "6a8bf1ca7adf3357ddac9a0a";
const url = (attachment: string, name: string, preview?: string) =>
  `https://trello.com/1/cards/${card}/attachments/${attachment}/${preview ? `previews/${preview}/` : ""}download/${name}`;

const board = (): ImportBoard => ({
  name: "Private",
  areas: [
    {
      name: "To do",
      cards: [
        {
          name: "Konfigurator",
          content: `Siehe Bild\n\n![image.webp](${url("aaa111", "image.webp", "ppp111")})\n\nnoch einmal: ![](${url("aaa111", "image.webp")})`,
          done: false,
          dueDate: null,
          labels: [],
          comments: [{ authorName: "Anna", content: `Hier: ![x](${url("bbb222", "shot.png", "ppp222")})`, date: null }],
          files: [
            { name: "image.webp", type: "image/webp", url: url("aaa111", "image.webp"), bytes: 10 },
            { name: "brief.pdf", type: "application/pdf", url: url("ccc333", "brief.pdf"), bytes: 10 },
          ],
        },
      ],
    },
  ],
});

const fakeTrello = (refuse: string[] = []) => {
  const asked: string[] = [];
  return {
    asked,
    download: async (file: ImportFile) => {
      asked.push(file.url!);
      if (refuse.some((id) => file.url!.includes(id))) return null;
      return { buffer: Buffer.from(`bytes of ${file.url!.split("/attachments/")[1]}`), type: file.type || "image/png" };
    },
  };
};
const fakeDisk = () => {
  let n = 0;
  const saved: string[] = [];
  return {
    saved,
    saveImage: async (buffer: Buffer) => {
      saved.push(buffer.toString());
      return `/api/uploads/copy${++n}.webp`;
    },
  };
};

describe("bringTrelloFiles", () => {
  it("fetches the attachments and keeps them as files of their own", async () => {
    const trello = fakeTrello();
    const { board: result, fetched } = await bringTrelloFiles(board(), { download: trello.download, saveImage: fakeDisk().saveImage });
    const files = result.areas[0].cards[0].files;
    expect(fetched).toBe(2);
    expect(files.map((f) => [f.name, !!f.data, f.url])).toEqual([
      ["image.webp", true, undefined],
      ["brief.pdf", true, undefined],
    ]);
  });

  it("stores the pictures in the text once each and points the text at the copies", async () => {
    const disk = fakeDisk();
    const { board: result, images } = await bringTrelloFiles(board(), { download: fakeTrello().download, saveImage: disk.saveImage });
    const [only] = result.areas[0].cards;
    // Both addresses of the first attachment — a preview and the download —
    // are one stored picture.
    const copy = only.content.match(/\/api\/uploads\/copy\d\.webp/)![0];
    expect(only.content).toBe(`Siehe Bild\n\n![image.webp](${copy})\n\nnoch einmal: ![](${copy})`);
    expect(only.comments[0].content).toMatch(/^Hier: !\[x\]\(\/api\/uploads\/copy\d\.webp\)$/);
    expect(images).toBe(2);
    // The attachment's own bytes were used rather than fetching the preview.
    expect(disk.saved).toContain("bytes of aaa111/download/image.webp");
  });

  it("leaves what Trello will not hand over as it was", async () => {
    const trello = fakeTrello(["aaa111", "bbb222", "ccc333"]);
    const original = board();
    const { board: result, fetched, images } = await bringTrelloFiles(board(), { download: trello.download, saveImage: fakeDisk().saveImage });
    const [only] = result.areas[0].cards;
    expect(fetched).toBe(0);
    expect(images).toBe(0);
    expect(only.content).toBe(original.areas[0].cards[0].content);
    expect(only.files.every((f) => f.url && !f.data)).toBe(true);
  });

  it("fetches no more files than it is allowed to", async () => {
    const trello = fakeTrello();
    await bringTrelloFiles(board(), { download: trello.download, saveImage: fakeDisk().saveImage, limit: 1 });
    expect(trello.asked.filter((u) => !u.includes("previews")).length).toBeLessThanOrEqual(2);
    expect(trello.asked[0]).toContain("aaa111/download");
  });
});

describe("trello tokens", () => {
  it("takes what looks like a token and nothing else", () => {
    expect(trelloToken(" ATTA1234567890abcdefABCDEF1234567890 ")).toBe("ATTA1234567890abcdefABCDEF1234567890");
    expect(trelloToken("short")).toBeNull();
    expect(trelloToken('abc"def, oauth_token="x"xxxxxxxxxxxxx')).toBeNull();
    expect(trelloToken(undefined)).toBeNull();
  });

  it("goes in the Authorization header the way Trello asks for it", () => {
    expect(trelloAuthHeader({ key: "k123", token: "t456" })).toBe('OAuth oauth_consumer_key="k123", oauth_token="t456"');
  });

  it("allows a preview of an attachment as well as its download", () => {
    expect(isTrelloAttachmentUrl(url("aaa111", "image.webp", "ppp111"))).toBe(true);
    expect(isTrelloAttachmentUrl(url("aaa111", "image.webp"))).toBe(true);
  });
});
