# Using LokalBoards with AI agents (MCP)

LokalBoards ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so AI agents can read and manage boards on a user's behalf — the same
Kanban tool your team uses, now scriptable.

## Connecting

- **Endpoint:** `POST https://<your-lokalboards>/mcp` (streamable HTTP).
- **Auth:** send an API key in the `x-api-key` header. Create one in the app
  under **Settings → API keys**. When creating a key you choose:
  - **Full access** — read and write (create/update/move/delete).
  - **Read-only** — read tools only; write tools are rejected with `FORBIDDEN`.
    Ideal for an agent that should only report on boards. The restriction also
    covers the REST API, so a read-only key cannot write through either surface.
- **Or OAuth**, for clients that cannot send a key — ChatGPT's custom
  connectors are the common case. Point the client at `/mcp` with no key; it
  discovers the rest, sends you to your instance to sign in, and asks you to
  allow it, read-only if you like. Connections are listed and revoked under
  **Settings → Connected apps**. The details are in the
  [MCP server documentation](https://www.lokalboards.com/docs/mcp-server#connecting-with-oauth).

Example with the official SDK:

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://your-lokalboards/mcp"),
  { requestInit: { headers: { "x-api-key": process.env.LOCALBOARDS_KEY } } },
);
const client = new Client({ name: "my-agent", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
```

## Data model

- A **board** contains ordered **areas** (columns/lists).
- An **area** contains ordered **cards** (tasks).
- A **card** has a name, a Markdown `content` (description), a `done` flag, an
  optional `dueDate` (which can repeat), the people on it (`assigneeIds`, with
  `assigneeId` as the first of them), plus **comments** and **attachments**.

Ids are integers returned by the list/get tools. Positions are 0-based.

## Content is Markdown

Card `content` and comment content are **Markdown** (headings, bold/italic,
bullet/numbered lists, `- [ ]` task lists, links, code). Don't send HTML — raw
HTML is escaped when rendered.

## Recommended flow

1. `whoami` — confirm which account you're acting as and whether the key is read-only.
2. `listBoards` — find a board id. Then `getBoardTree(boardId)` to load the whole
   board (areas + cards) in one call — prefer it over `listAreas` + `listCards`.
   Use `searchCards` to find cards by text **or by filter**.
3. Act with the create/update/move/delete tools using the ids from those reads.
   `listBoardMembers(boardId)` gives the userIds to use in `assigneeIds`.

## Working tasks (the agent loop)

```
searchCards({ areaId: <to-do column>, done: false, unassigned: true })
  → claimCard(cardId)          # atomic: skip the card if claimed === false
  → …do the work…
  → writeComment(cardId, "<what you did>")
  → updateCard({ cardId, done: true })   # a repeating card returns the next one as `next`
  → moveCard({ cardId, toAreaId: <done column> })
```

- **Always claim before working.** `claimCard` only succeeds if nobody is on
  the card (or you already are) — atomically, so two agents racing for one card
  cannot both win. If it returns `claimed: false`, `heldBy` tells
  you who has it — move on to the next card. This is what keeps two agents, or
  an agent and a human, from doing the same task twice.
- **Release what you abandon** with `releaseCard`, or it stays claimed.
- **Which column means "done"** is a convention of the board, not something the
  API knows — whoever instructs you should say (e.g. "move finished cards to
  Erledigt"). The `done` flag is the source of truth; moving the card is for the
  humans looking at the board.
- **Retrying a create?** Pass an `idempotencyKey` so a repeat returns the card
  you already made instead of a duplicate.

## Staying up to date

There is **no push channel to an MCP client** — you only see the current state
when you call a read tool again, so re-read at the start of each run. To have
something *start* an agent when work appears, use a **webhook** (Settings →
Webhooks): it POSTs to your endpoint on board changes, and your automation can
kick off a run. Otherwise, run on a schedule (e.g. hourly).

## Tools

**Read:** `whoami`, `listBoards`, `getBoard`, `getBoardTree`, `listAreas`,
`getArea`, `listCards`, `getCard`, `listComments`, `listBoardMembers`,
`searchCards`.

**Write (need edit access):** `createBoard`, `updateBoard`, `deleteBoard`,
`createArea`, `updateArea`, `deleteArea`, `moveAreas`, `createCard`,
`updateCard`, `deleteCard`, `moveCard`, `orderCard`, `writeComment`,
`claimCard`, `releaseCard`.

`searchCards` doubles as the filter/query tool: `query`, `boardId`, `areaId`,
`done`, `assigneeId`, `unassigned`, `dueBefore` and `limit` all combine.

`listBoardMembers` returns userId, name, type and role — not e-mail addresses.
`moveCard` moves a card between areas of **its own board**; a `toAreaId` on a
different board is rejected.

## Agent accounts

An admin can create a user marked as an **AI agent** (Users → new user → account
type). Give the agent its own account and API key rather than sharing a person's:
its actions are then clearly attributed, it shows a bot badge on the board and in
card presence, and it won't get notification e-mails (off by default for agents).

Every tool carries a description, per-field docs and input examples, so a capable
client can call them without reading this file. Update tools are partial — pass
only the fields you want to change.

## Permissions & errors

The caller must own a board or be invited to it (an invitation grants access
immediately — there is no separate accept step). Editing needs edit
access; board settings and deletion are owner-only. Your changes appear on the
boards of collaborators in real time (see [Staying up to date](#staying-up-to-date)
for the other direction).

Errors are returned as MCP `isError` results with a stable prefix:
`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` or `INTERNAL`, e.g.
`NOT_FOUND: No card with id 42.`
