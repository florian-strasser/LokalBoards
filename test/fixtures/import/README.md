# Exports from other tools

Real files, made by the tools themselves, for the importers to be tested
against. Each was produced by building a board in that tool — through its own
API or its own interface — and exporting it the way a person would. Nothing in
them is edited by hand: an importer that reads these correctly reads what the
tool actually writes, not what somebody expected it to.

When a tool changes its format, export a new file the same way and add it next
to the old one, so both keep being read.

## `wekan-board.json`

Wekan, `wekanteam/wekan:latest` of 21 September 2026
(`sha256:078ca230c0dfc0b515a99a43ca53cedc8e782ef328e363035dcde856c9756804`),
with MongoDB 7. The board **Website Relaunch**, exported with
`GET /api/boards/<id>/export`, which is what the board menu's *Export board* →
JSON calls. It has three lists, five cards — one of them archived, one with its
due date marked complete — two named labels, a checklist with one of three
items ticked, two comments by two people, a Markdown description with a link,
and two files attached through the card's own upload box (the API upload
route timed out). The accounts in it are test accounts on a throwaway
instance; users appear by username only, with no e-mail addresses.

## `deck-export.json`

Nextcloud 35.0.0 with Deck 1.19.0 (`nextcloud:latest` of 21 September 2026,
SQLite). Written by `occ deck:export florian`, which is the only export Deck
has: it is run on the server and holds every board the user owns — here the
**Website Relaunch** board built through Deck's REST API, and the *Welcome to
Nextcloud Deck!* board every new account gets. Website Relaunch has three
stacks, a card with two labels, a checklist in its description, a due date,
an assigned person and two comments by two people, and a card marked done. A
fifth card was archived and a file was attached to the first; the export leaves
out both, as Deck's own documentation says it leaves out attachments.
