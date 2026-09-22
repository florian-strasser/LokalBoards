import { getApiKeyUser } from "../utils/auth";

// The MCP server that lets AI agents work with LokalBoards. Every request is
// authenticated by the caller's API key (`x-api-key`, or a bearer token for
// clients that can only send `Authorization`); the middleware
// resolves the key to a user + its permission scopes and stashes them on the
// event context for the tools (see server/mcp/helpers.ts).
export default defineMcpHandler({
  instructions: [
    "LokalBoards is a Kanban project-management tool. Use these tools to read and",
    "manage a user's boards on their behalf.",
    "",
    "Data model:",
    "- A **board** contains ordered **areas** (columns/lists).",
    "- An **area** contains ordered **cards** (tasks).",
    "- A **card** has a name, a Markdown `content` (description), a done flag, an",
    "  optional due date (which can repeat) and the people on it, plus **comments** and **attachments**.",
    "",
    "Authentication: send the user's API key in the `x-api-key` header, or as",
    "`Authorization: Bearer <key>` if that is all your client can send. `whoami`",
    "returns who you are acting as. A read-only key can call the read tools but not",
    "create/update/move/delete.",
    "",
    "Recommended flow:",
    "1. `whoami` to confirm the acting user.",
    "2. `listBoards` to find a board, then `getBoardTree` to load the whole board",
    "   (areas + cards) in one call — prefer it over calling listAreas/listCards",
    "   repeatedly. Use `searchCards` to find cards by text or to filter (e.g.",
    "   open + unassigned cards in one area).",
    "3. Act with create/update/move/delete tools using the ids from those reads.",
    "",
    "Working tasks (the usual agent loop):",
    "1. Find candidates: `searchCards` with `areaId` of the to-do column,",
    "   `done: false` and `unassigned: true`.",
    "2. `claimCard` — this is ATOMIC. If it returns claimed=false someone (or",
    "   another agent) already holds the card: skip it and take the next one.",
    "   Never work a card you did not successfully claim.",
    "3. Do the work, then `writeComment` with the result so humans can review it.",
    "4. `updateCard` with done=true, then `moveCard` to the board's done column.",
    "   Which column counts as 'done' is a convention of the board — the person",
    "   instructing you should tell you (e.g. 'move finished cards to Erledigt').",
    "   The `done` flag is the source of truth; moving is for the humans looking",
    "   at the board.",
    "5. If you abandon a card without finishing it, call `releaseCard` so someone",
    "   else can pick it up.",
    "Pass an `idempotencyKey` to `createCard` when you might retry, so a repeated",
    "call returns the existing card instead of creating a duplicate.",
    "",
    "Content format: card `content` and comment content are **Markdown** (headings,",
    "bold/italic, bullet and numbered lists, `- [ ]` task lists, links, code). Do",
    "NOT send HTML. Ids are integers returned by the list/get tools.",
    "",
    "Permissions: the caller must own a board or be invited to it (an invitation grants access immediately).",
    "Editing needs edit access; read tools need read access.",
    "",
    "Staying up to date: there is NO push channel to you. Other people's changes",
    "appear live in their browsers, but you only see the current state when you",
    "call a read tool again — re-read (getBoardTree / searchCards) at the start of",
    "each run rather than assuming what you fetched earlier is still true.",
    "",
    "Errors come back as `CODE: message` where CODE is one of UNAUTHORIZED,",
    "FORBIDDEN, NOT_FOUND, VALIDATION, INTERNAL.",
  ].join("\n"),
  middleware: async (event) => {
    const result = await getApiKeyUser(event);
    if (result) {
      event.context.user = result.user;
      event.context.userId = result.user.id;
      event.context.apiKeyPermissions = result.permissions ?? null;
    }
  },
});
