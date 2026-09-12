## v0.37.0

### Breaking

- **Archived boards, areas and cards are deleted for good after 30 days.** Archiving replaced deleting in v0.36.0, and the archive kept everything for ever: every card anybody threw away, with its attachments and the files behind them, held until somebody went looking for the bin and pressed a second button. It empties itself now. The clock starts when a thing was archived, and a card that goes takes its attachments and their files with it.

  **To keep the old behaviour, set `NUXT_ARCHIVE_RETENTION_DAYS=0`** before updating. That keeps archived things for ever, exactly as v0.36.0 did. Any other number sets the window — `90` for a quarter, say. Thirty days is the default because it is what a recycle bin usually keeps: long enough that a mistake is recoverable well after anybody notices it, short enough that an instance does not quietly fill with work somebody threw away last year.

  A value that cannot be read falls back to 30 rather than to zero. A typo in an environment variable should not quietly turn the sweep off, and should certainly not be read as "delete immediately".

  Anything already sitting in an archive from v0.36.0 is subject to the window as soon as this version runs, dated from when it was archived — so an instance that has been archiving for a while will lose the oldest of it on the first night. If that matters, set the variable to `0` first and look through **⋮ › Archive** before turning it on.

  The archive itself now says how long it keeps things, so the rule is visible where it applies rather than discovered a month later. The sweep runs nightly and destroys things through exactly the same code the archive's own bin uses — that code had been sitting inline in the two endpoints that held it, and is one place now, because two copies of "everything a board owns" would drift and the half that drifted would leak rows and files nobody can see any more.

### New Features

- **ChatGPT can connect now: LokalBoards speaks OAuth.** Custom connectors in ChatGPT offer OAuth or no authentication at all — an API key is not among the options — so until now a LokalBoards instance simply could not be added to the assistant most people have open. It can be. Point a connector at `https://boards.example.com/mcp`, leave the client configuration empty, and the rest happens on its own: ChatGPT is refused, reads where to look, finds this instance's authorization server, sends you here to sign in, and asks whether to allow it.

  Your instance is the authorization server. There is nothing to configure, no second service to run and no keys to manage — a request to `/mcp` without credentials now answers with a challenge naming its own metadata, and two well-known documents describe the rest. A client identifies itself by publishing a metadata document at an HTTPS URL that *is* its client identifier, which is what the specification now prefers and what ChatGPT leads with; the older dynamic registration, which the specification marks deprecated, still works for clients that only know that way.

  The consent screen names the application, says what it will be able to do and whose account it will act as. The two permissions are the ones an API key already has, so a token changes nothing about how the tools behave: a connector that asked to write can be given read-only access instead, from that screen. **Settings › Connected apps** lists what you have allowed and disconnects it, which revokes its tokens at once.

  Access tokens last an hour and refresh tokens thirty days, rotated on every use. Tokens are stored hashed, as API keys are. A code offered twice revokes everything it produced, on the grounds that a replay and a client bug look identical and only one of them is safe to assume. A token is only ever valid for this instance's own MCP endpoint, checked on every request — which is the confused-deputy problem the specification spends most of its security section on. API keys are untouched and keep working exactly as before.

- **Duplicate a board's structure.** **⋮ › Duplicate board**, on the board itself or on its tile on the dashboard, makes a new board with the same columns and none of the cards. Most boards start life as the same three or four columns — Todo, Zur Vorlage, Erledigt — and building them by hand every time is the part worth skipping.

  It asks for the name first, with the original's selected so typing replaces it: a board is duplicated because the next one starts the same way, and that next one already has a name in mind. The copy keeps the style and the colour, belongs to whoever asked for it rather than to whoever owned the original, and is private whatever the original was. Archived columns stay behind — they are not part of the board's shape any more. Seeing a board is enough to take a copy of its shape, since the copy is a board of your own holding nothing but column names.

### Improvements

- **A card's tile is two rows again.** It had grown to three or four: the assignee's avatar sat in the row of counts at the bottom, and the labels had a row of their own above it — so a card with one label and a due date was three rows tall for two short facts, and a card carrying nothing but an assignee opened a whole row to hold one avatar.

  The avatar is level with the card's name now, where it is the first thing you look for, and the labels wrap together with the counts on the one line below: what the card is, then what it holds. A tile only goes to a third row when it genuinely has more than fits — a label, a checklist, comments, attachments and a due date all at once. A search result draws a card the same way and got the same treatment.

- **The demo data behind the screenshots has labels, and every card with somebody on it also says when.** The guide was illustrating the labels chapter with boards that had none, and the filter with a menu that had no labels to offer. The cards assigned to somebody but carrying nothing else were the ones showing off that empty row.

### Fixes

- **A copied image pasted into a card arrived twice, and the second one broke on saving.** "Copy image" in a browser puts two things on the clipboard: the picture itself, and a scrap of `text/html` holding an `<img>` that points back at the page it came from. The editor uploaded the file and inserted it — and then handed the paste back to the editor, which inserted that `<img>` as well. Both showed while the description was open, because the page they pointed at was still serving them; only the uploaded one survived the save, so the card was left with a picture and a broken one beside it.

  The paste is now taken and finished with, rather than acted on and passed along. Only pastes that actually carry a picture are affected — text and HTML on their own paste exactly as before, images included, so copying a paragraph with pictures in it from a web page still brings those pictures along as links to where they live.

## v0.36.0

### New Features

- **Deleting is archiving.** A card, an area or a whole board now goes to an archive instead of being destroyed. The row stays, everything hanging off it stays — a card keeps its comments, its attachments and their files, its labels, its reminders and its history — and it disappears from every list the app draws: the board, the dashboard, search, and the reminder mails.

  **⋮ › Archive** on a board lists the areas and cards it has put away, with the date each one left and what it was in; the same entry on the dashboard lists archived boards. Restoring puts a thing back exactly where it was. Archiving an area takes its cards with it without marking them one by one, which is what makes restoring it give back the column it was, in the order it was in — and it is why a card archived inside an area is not offered separately.

  Deleting for good is still there, and the archive is the only place it lives: the bin beside an entry removes it and everything belonging to it. That is the one irreversible action in the app, and it now takes a deliberate visit to find rather than one confident click on a board.

  An archived board still opens from a link or a bookmark, because refusing to show somebody their own board is a strange way to tell them it is safe. It says at the top what it is, and the owner can restore it from there.

  This changes what `DELETE` means over the API and over MCP: it archives, and the old behaviour is `permanent`. Three lists that quietly kept working are now explicit about it — an archived card is nobody's overdue reminder, is not a search hit, and is not something an agent is asked to look through.

- **A board can be filtered.** A funnel beside the three-dots menu narrows the board by label, by assignee, by due date — overdue, today, this week, or no date at all — and by open or done. Several labels widen the answer, since that is what a set of tags should do; a label *and* an assignee narrows it.

  It runs in the browser on the cards already loaded, so it is instant and asks the server nothing. Cards that do not match are hidden rather than left out of the list, which means dragging still works while a filter is on and a card still lands where it looks like it landed — SortableJS moves the elements it is given, and a filtered array would have had it computing positions in a list the board does not hold. The people offered are the ones who actually have a card here, taken from the cards themselves rather than from the board's membership, because a member with nothing assigned would only ever filter the board down to nothing.

- **Areas count their cards.** The number sits in the column header. While a filter is on it counts both — **3 / 12** — so a column that has gone quiet is saying why rather than looking like it lost something.

### Security

- **SVGO updated in both lockfiles.** Four advisories were raised against `svgo`, a package LokalBoards does not name directly: it arrives through Nuxt's Vite builder, which uses `cssnano` to minify CSS, which reaches for `postcss-svgo` when a stylesheet carries an inline SVG. Two say its opt-in `removeScripts` plugin lets executable links through — namespace-prefixed anchors, and URL schemes broken up with tabs or newlines (high, CVSS 8.2); two say the same plugin does not look inside `<foreignObject>`, where executable HTML can sit (moderate, CVSS 6.1). Both pairs were reported twice over, once for the app and once for the documentation site, which keeps its own lockfile.

  Nothing here calls SVGO, and `removeScripts` is off by default, so this was reach rather than exposure — but a build-time dependency that mishandles untrusted SVG is not one to sit on. `postcss-svgo` already asked for `^4.0.2`, so the patched 4.1.0 needed no override and no change to any `package.json`: both lockfiles were refreshed, and the only other packages that moved are the two SVGO itself now requires (`css-select` 6, `css-what` 7), which nothing else in either tree depends on. The Nix package reads `package-lock.json` directly since v0.34.4, so it follows without a hash to update.

- **Nodemailer updated, and this one is not build-time.** Four advisories stood against the version LokalBoards was sending its mail with, and Dependabot had not raised any of them. Two are recipient-domain validation bypasses — one through IDN and Punycode, one through RFC 5322 comments — where an address that passes a domain allow-list can still be delivered somewhere else; one is quadratic time in the address parser, reachable by a crafted address list; one lets `resolveContent()` past `disableFileAccess` and `disableUrlAccess` when called the old way (high, CVSS scores up to 8.1). Every mail this app sends goes to an address somebody typed — an invitation, a password reset — so this is the one on the list that is actually exercised in normal use. `^9.0.3` already admitted the patched 9.1.1.

  Address parsing being the thing that changed, the mail path was checked rather than assumed: an invitation was sent through the new version into a real SMTP server, with the plain address, a plus address, a subdomain and an IDN recipient. All four were accepted and delivered, subject, HTML body and inline attachment intact.

- **`js-yaml` and `hono` updated too** — a merge-key case that spends CPU without limit (high) and three Hono advisories about writing outside an output directory, unbounded nesting in `parseBody()` and query parameters read past a URL fragment (moderate). Both arrive transitively, and both were fixable within their declared ranges.

- **Vitest 3 to 5, which closes the last one.** `@vitest/mocker` can be made to read a file from outside the project by redirecting a mock (moderate), and the fix is Vitest 5 — two majors up from the 3.2.7 this was on, and it drags `@nuxt/test-utils` from 3 to 4 with it, since only 4 accepts Vitest 5. Nothing here ships a test runner, so this was a question of when rather than whether.

  It turned out to need no changes at all: the three configs, the mocks and the setup files were taken as they stood, and all three suites pass unchanged — 150 unit tests, 36 integration tests against a throwaway MySQL, and the 12 end-to-end ones that build and drive the real server through `@nuxt/test-utils`, which is the part a major version of it could have broken. Vitest 5 wants Node `^22.12.0`, which is below what Nuxt 4.5.2 already asks for, so nothing changes about what this project runs on.

  Both dependency trees — the app's and the documentation site's — now report nothing outstanding.

## v0.35.0

### New Features

- **Cards can carry labels.** A short word — *Bug*, *Blocked*, *Design* — typed on a card from a third button beside the due date and the assignee, and drawn on the card's tile so a board says what kind of work it is holding without anything being opened.

  A label is text on a card, not a list the board keeps and you switch on and off. The third button does one thing: it adds one. Type the word — anything the board is already using is offered under the field, and picking it there is the same as typing it out, because the same word is the same label, which is what keeps a board from ending up with three spellings of *Bug*. The labels themselves sit on their own line under the buttons, and that line is where they are changed: click the word to reword it, the cross at its end to take it off. Both act on the card you are on, so rewording points *that* card at another word and leaves every other card alone, and a word no card uses any more stops being offered.

  A label is one of the words a card can be found by. Searching for *Bug* turns up the cards marked *Bug* as well as the ones that mention it in a name or a description, each hit drawn with its labels so it is clear which word answered — through the search field, and through `searchCards` for anything driving the instance over MCP.

  Labelling a card is part of its history: adding, rewording and removing one another are written into **Comments and activity** beside the due date and the assignee, so a card says who labelled it and when. Not into the notifications — nobody needs an e-mail because a card is now marked *Bug*, and the history is where you would look anyway. What does travel is the change itself: a label added by one person appears on everybody else's board as it happens, and the words the board is using are learned from what arrives, so the list offered when adding one stays current for everyone rather than only for whoever typed it.

  Neither ended up where it started. The labels were drawn inside the button that sets them, which grew as they were added and shoved the two beside it around; and taking one off was buried in that button's menu, which is the last place you look for it when the label you want rid of is sitting right there on the card.

  Every label is drawn in one colour, mixed from the app's own brand colour and defined in a single place for both themes. Labels did carry a colour each at first, which turned the menu for adding one into a colour grid — a decision put in front of somebody who wanted to type the word "Bug" — and made them harder to read rather than easier, since a label in a dark preset disappeared into the dark theme's own panels. A duplicated card keeps its labels, and a deleted card or board takes its own with it.

### Improvements

- **A card's popover menus were able to float above the card instead of inside it.** The due date, the assignee and now the labels each open a small panel, and that panel was drawn inside the dialog's own scrolling area — so one taller than the card stuck out past the bottom of it, was clipped there, and gave the card a scrollbar it had no reason to have. The panels are drawn over the page now and placed against their button, flipping above it when there is more room up there and scrolling inside themselves when there is not enough either way. The tooltips have been out there for the same reason for some time; this is the same problem one component along.

### Fixes

- **Installing through Nix works again, and cannot quietly stop working the same way twice.** The Nix package pinned a hash describing `package-lock.json` as it stood several releases ago. Nothing made the two move together, so the dependency updates in v0.34.2 left them disagreeing and `nix build` — along with the NixOS module that depends on it — stopped at a hash mismatch. Nobody noticed, because nothing on the way to a release ever built it.

  Rather than refresh the hash and wait for the next time, the package now reads `package-lock.json` directly and fetches each dependency by the integrity field already written beside it. There is no separate hash left to fall out of step with anything. This was tried when the packaging was first written and abandoned — the tooling could not build this lockfile then, and the note explaining why is still in `nix/package.nix`, now describing what changed since.

  Two smaller things fell out of it: the build no longer runs `npm ci` at all, which is what used to reach for the registry from inside a sandbox that forbids it, and the dependency tree is copied rather than linked, because Nitro writes into it while building and a tree pointing back at the read-only store fails that.

### Continuous Integration

- **CI builds the Nix package and evaluates the NixOS module.** The packaging had no way of failing where anyone would see it — the only thing that exercised it was somebody installing LokalBoards through Nix. It is built on every push now, and the module is evaluated as part of a real system configuration, so option types, the `environmentFile` assertion and the generated systemd unit all have to hold together. Evaluating a module is not booting one, which still wants a NixOS machine or a virtual one.

## v0.34.3

### Improvements

- **A kanban board's areas snap into place as it scrolls.** Scrolling sideways used to leave an area sitting anywhere — half off the edge of the window as often as not. It now settles on one at a time, and always at the same inset the header's own logo sits at, so the area you land on lines up with the rest of the page rather than with wherever the scroll happened to stop.

  Sortable's own drag-to-scroll — holding a card or an area near the edge of the screen to reach one further along — nudges the scroll position forward in small steps, and a snap that resolved on every one of those nudges would have undone each step as soon as it was made, leaving the drag stuck. Snapping is suspended for the length of any drag and returns the moment it ends, so reordering across the edge of the screen still works, and the board settles cleanly on an area once you let go.

- **A link in a card or a comment opens in a new tab.** Following one used to replace the board you were reading it from — often mid-edit, with a dialog open — and leave the back button as the only way home. Links now open beside the board instead of on top of it. It holds for every link however it was written: typed in the editor, written as Markdown, or pasted as a bare address and turned into a link on the way to the screen.

  They also carry `rel="noopener noreferrer"`. A page opened in a new tab is otherwise handed a reference to the tab that opened it and can quietly send that tab somewhere else — a convincing way to replace a board with a page asking for its password — and the address of a self-hosted instance is nobody else's business either. Current browsers assume the first half of that; older ones do not.

## v0.34.2

### Security

- **Tiptap and fast-uri updated, and the editor's packages brought onto one version.** Two advisories were raised against dependencies LokalBoards does not name directly. `@tiptap/core` before 3.30.4 turns an own `__proto__` key into inherited executable DOM attributes through its `mergeAttributes()` helper (moderate, CVSS 6.4); `fast-uri` before 3.1.6 can be confused about which host a scheme-relative reference points at, because it only canonicalises a host when the input carries an explicit scheme (high, CVSS 7.5).

  The editor's packages were held apart by exact peer dependencies — the starter kit moved while the emoji, image and file-handler extensions stayed behind, which would have left two copies of `@tiptap/core` in the same editor. They are all on 3.31.0 now, and there is one copy. `fast-uri` was pinned by an override of this project's own, which is what kept it on the affected version; the override now asks for the patched one.

- **A third advisory closed while the file was open.** `qs`, reached through the MCP toolkit's copy of Express, could be made to bypass its array limit or to spend the server's time on an attacker's input (moderate). It was not reported by Dependabot alongside the other two, but it was fixable in the same breath. `npm audit` reports nothing outstanding now.

## v0.34.1

### Fixes

- **The first dialog opened from a tile's menu animates like every one after it.** It appeared all at once, while the second and every subsequent one rose and faded in properly. These dialogs are only built once a board has been named, so the first use of a menu created the dialog and opened it in the same breath — and a dialog that already stands open when it is created has nothing to animate out of, so it simply showed itself. That immediate path is there on purpose, for a card opened straight from a link, where the page arrives with the dialog already up. Naming the board first and opening a moment later gives it a closed state to start from.

- **The permissions dialog lists a board's members when it is opened from the dashboard.** Reached from a tile's menu it showed only the invite form, as though nobody had ever been given access — while the same dialog, opened from the board itself, listed everyone. Nothing was wrong with the board or the invitations; the dialog was simply asked to draw before the answer came back. It took a copy of the list at the moment it was created, the dashboard creates it the instant a tile's menu is used, and the members are fetched after that. On a board page they are already in hand, which is why only one of the two ever looked broken.

  The dialog follows the list now instead of copying it once, and the dashboard waits for the members before opening it, so it neither starts empty nor fills in a moment later.

## v0.34.0

### New Features

- **Signing in finishes the journey you started.** A link or a bookmark to a board, followed while signed out, sent you to the login page and then to the dashboard — leaving you to find the board again yourself, which is the one thing you had already said you wanted. The address you asked for now travels with you as `?redirect=`, and signing in takes you there. A link to a particular card arrives at that card, not merely at its board.

  It also works the other way round: opening such a link while already signed in goes straight through instead of stopping at the dashboard.

  The destination is checked rather than trusted, because it arrives in the address bar where anyone can put anything. Only a path on this instance is followed — `https://elsewhere.example`, the protocol-relative `//elsewhere.example`, and the backslash form some browsers read the same way are all ignored in favour of the dashboard. A login page that forwards anywhere is a phishing link that genuinely begins on your own domain, and this one does not. Nor does it send you back to a sign-in page, which would be a loop rather than a destination.

### Improvements

- **A dialog dims the page with the page's own colour instead of black.** Safari tints its address bar with the colour of the page behind it, and LokalBoards names no colour of its own for that, so the bar is simply whatever the page's background is. A black scrim left the two disagreeing — the page went dark while the bar above it stayed pale — and on a phone that reads as the dialog having failed to cover something rather than as a dialog. The page now fades toward its own ground colour, so the whole screen including the bar stays one colour, the way the device's own sheets behave.

  It is not a dark theme drawn light. On the dark theme the page's ground is near-black, so this still dims exactly as it did; it only stops insisting on black when the page is not black. The card keeps its shadow, which is what separates it from the page in either theme.

- **Hovering a board with a cover picture no longer hides the picture.** The tile answered the pointer by painting the hover colour across its face — and since that face sits above the cover, the photograph vanished behind a flat block of blue at exactly the moment it was being aimed at. Only tiles with a picture were affected; a coloured tile was already shifting its own colour, which is the behaviour that was wanted.

  What lands there now is a veil rather than a colour — the picture stays visible through it and darkens on the light theme, lightens on the dark one, which is the direction a coloured tile already moves. Its strength is measured against those tiles rather than guessed at, so a photograph and a colour shift by about the same amount under the same gesture. The dark theme needs a heavier veil than the light one to get there: white over a photograph lifts its dark pixels a long way and its bright ones barely at all, and a photograph is mostly not dark.

  Every tile eases into its hover over the same fifth of a second, whether it answers with a veil or with a colour. A coloured tile used to snap to its new shade the instant the pointer arrived, which read as two different components once a picture beside it was fading.

- **The notification bell loads twenty-five at a time.** It used to fetch every notification an account had ever received in order to show the first handful — a list that only grows, sent in full on every open, to fill a panel that shows about six. It now asks for the newest twenty-five, with a **Show older** button at the end of the list for the next twenty-five, and so on until there are none left.

  The unread dot still speaks for the whole history rather than for the page in hand: the count is made in the database, so an account with forty unread notifications shows the dot even though the panel is holding twenty-five. Paging is anchored to the last notification in hand rather than to a count of rows, so a notification arriving while someone is reading cannot shift the window and make a page repeat itself or skip one. The page size is a request, not a rule — a caller that asks for the whole list, as the board page does when working out which cards have unread changes, still gets it.

- **A board asks which cards have unread changes, instead of reading every notification to work it out.** Opening a board draws a marker on the cards that have something unread on them, and the page arrived at that list by downloading the account's entire notification history — every message, every actor and avatar — and counting what was left. The question it actually has is which card ids those are, and that is what it asks now: a list of numbers instead of a history that only grows. The endpoint answers it with `unreadCards`, scoped to one board with `boardId`.

### Fixes

- **A tooltip no longer stands over the dialog the button just opened.** Tapping a button that carries a tooltip left the tooltip on screen, drawn above the dialog that the tap had opened. A tooltip explains the control you are pointing at, and a touch screen has nothing to point with: the tap activates the control instead of hovering it, and on iOS it also leaves the button focused — which is what the tooltip was listening for. Where the screen cannot hover, there is no tooltip now.

  Pressing a control puts its tooltip away in any case, which the desktop wanted too: there the pointer stays where it was after a click, so the tooltip sat over the dialog for as long as nobody moved the mouse.

- **A dialog fits the screen a phone actually has.** The bottom of a dialog sat behind Safari's address bar — or the top of it did, depending on which end of the screen that bar is set to — so the button a dialog exists for could be out of reach. A dialog was sized to `100vh`, which on a phone does not mean the visible screen: it means the screen as it would be with the browser's own bars out of the way. The dynamic viewport, which is what is left after them, is what a dialog is sized to now. Every full-height page in the app was already measured this way; the dialogs were the last thing still asking for the taller figure.

- **Board tiles can be dragged on a phone.** Rearranging the dashboard, or moving a board into a group, did nothing at all on a touch screen: the tile stayed where it was. A board tile is a link, and pressing and holding a link is already spoken for on iOS — Safari opens its own preview of it and starts selecting the text. The drag waits a quarter of a second before it accepts a press as a drag, on purpose, so that swiping the dashboard still scrolls it; the browser's long-press arrives in the middle of that wait and takes the gesture. A card inside a board never had the problem because a card is a button, and none of that applies to one.

  The tiles now say they want neither the preview nor the selection, which is the whole of the fix — the dragging itself was working the whole time. The grip that reorders whole groups is told the same, and additionally that a touch landing on it is a drag rather than a scroll: unlike a tile, a grip is not something anybody swipes the page from.

- **Pictures posted in a comment are no longer broken in the notification bell.** A comment notification keeps its own copy of the comment, the picture's address included. The migration that moved every stored image to WebP rewrote the boards, the cards and the comments, but never the notifications — so that copy went on naming the original file, and the same migration then deleted it, having found nothing it knew about still pointing at it. The picture stayed perfectly fine on the card and showed as broken in the bell, for anything posted before the upgrade.

  The conversion knows about notifications now, both when rewriting and when deciding whether a file is still wanted, which settles it for anyone who has not upgraded yet. For those who have, the damage is already done and the old name is all that is left, so a second migration repairs it from the comment: a notification naming a file that is no longer there is matched against the comments on its own card, and the one whose text is identical once the addresses are blanked out says what the picture is called now. Where nothing matches — a comment since deleted, or two comments alike in everything but their pictures — the message is left exactly as it was rather than guessed at.

### Documentation

- **Every screenshot retaken.** The guide's fifteen, the README's, and the homepage's heroes in each of their widths — one demo run, so they are all the same build on the same day. What is different in them this time is mostly the dialogs: the page behind one now fades toward its own colour rather than to black, which changes every picture a dialog appears in, the README's among them.

- **The notifications endpoint is in the API reference.** It was reachable with an API key and documented nowhere, and it has just grown parameters worth knowing about. The page covers reading the list whole or a page at a time with `limit` and `before`, what `hasMore` and `unreadCount` mean and why the count is not taken from the page in hand, the `unreadCards` answer and its `boardId`, and the three ways to mark something read — each with an example in every language the reference offers.

- **The README says which Node and npm to use.** Running the application requires Node.js 22 and npm 11; the lockfile is generated with npm 11, and npm 10 refuses it.

### Contributors

- Florian Strasser ([@florian-strasser](https://github.com/florian-strasser))
- WebBrain ([@webbrain-one](https://github.com/webbrain-one))

## v0.33.3

### Improvements

- **The name of a new card grows past two lines as it is written.** The field was two rows and no more, so a third line scrolled out of sight while it was still being typed — the writing was there, just not where it could be read. It now takes the height of what is in it, using the browser's own `field-sizing`, so nothing has to be scrolled back to check.

  Its resting height is unchanged: until a third line is needed the field looks exactly as it did. Past ten lines it stops growing and scrolls again, so a pasted wall of text cannot push the rest of the column off the screen. A browser that does not implement `field-sizing` ignores the rule and keeps the two rows it always had, which is what it did before.

### Fixes

- **A new board can be given its colour while it is being created.** The colour was offered only once the board already existed, in its settings — so making a coloured board meant creating it, opening the menu on its tile and setting the colour there, and the dialog that asks for a name, a cover and a style stayed silent about the one thing it could not do. It is in the create dialog now, in the same place and with the same swatches as in the board's own settings, and it strikes the same bargain: a cover image and a colour cannot both be shown, so choosing either clears the other.

- **Creating an area said a card had been created, in German.** The toast that confirms a new area read "Karte erstellt". The page asks for the right message and every other language answers correctly — only the German string had been filled in with the wrong noun, so the confirmation named the wrong thing entirely. It reads "Bereich erstellt" now, matching the button that was just pressed. Checked the rest of the German file for the same mix-up while there; nothing else names a card where it means an area, or the other way round.

### Documentation

- **Every screenshot retaken.** The guide's fifteen, the README's, and the homepage's heroes in each of their widths — one demo run, so they are all the same build on the same day. The one that prompted it is the dialog for a new board, which had been shot before it could set a colour and so illustrated a step the text already described; its caption had been naming a control that was not in the picture. The board views carry this release's spacing too, with an area's first card and its "create a card" form starting at the same height.

## v0.33.2

### Fixes

- **An area's cards and its "create a card" form line up with the neighbouring area again.** The list of cards sits in an inner wrapper carrying 4px of padding — room for the unread marker, which is drawn just outside a card and was otherwise clipped by the edge of the scrolling list. Nothing gave that padding back at the top, so every first card sat 4px lower than the column's own spacing intended; and in an area with no cards the wrapper was 8px of nothing but padding, pushing the form 8px below where the next area's first card started. Side by side, the columns looked misaligned.

  The wrapper now gives the top back, as it already did at the sides, and an empty list carries no padding at all — there is nothing to protect from clipping when there are no cards. Both an area's first card and an empty area's form now sit 4px under the heading, which is the spacing the column uses everywhere else. The gap between the last card and the button below is unchanged.

  An empty area is still somewhere to drop a card: SortableJS takes one within a few pixels of an empty list and shows its placeholder there as the card arrives, so the list needs no height of its own to be a target.

  Which list is padded is decided by the stylesheet, from what the list is actually holding, rather than from the array the page renders it from. Dragging moves the card's element itself and leaves that array alone, so a card dropped into an empty area was drawn 8px wider than its column and 4px too high until the page was reloaded.

### Documentation

- **The pricing section names a setup service beside the free one.** Two cards now: the software, free under the MIT licence as it was, and a one-time 299 € service for installing LokalBoards on your server and handing it over. The free card keeps the filled treatment and the left-hand position — the software is what the page is about, and the service sits beside it rather than above it as a tier. The second card says so in as many words, so two prices side by side cannot read as two editions of the product: there is still only one build, it is still free, and the server is rented from a hosting provider and billed by them. The two cards are one row rather than two blocks: they take the height of the taller, and each button is held to the bottom edge, so they stay on one line however long the writing above them grows.

- **The changelog uses the whole width it has.** The entries were held to a measure of about 68 characters, set when the page stood on its own and the text would otherwise have run the full width of the window. It has had the documentation's sidebar beside it since, which makes the column the measure, so the cap did nothing but leave a band of empty space down the right — on the longest page of the site. The entries now fill the column, exactly as every documentation page does.

## v0.33.1

### Fixes

- **Board covers and images already sitting in a card or a comment are converted to WebP too.** The previous release re-encoded everything arriving from then on, and went back over the profile pictures, but the images uploaded before it stayed exactly as they were everywhere else they can be named: a board's cover, and anything pasted into a card's description or a comment. Those are the largest pictures the app draws and they were still the original PNGs and JPEGs.

  Each one is re-encoded on the next start and every reference to it is pointed at the new file. As with the profile pictures, the converted file gets a new name so a page still holding the old URL keeps working until it reloads, and the original is removed only once nothing names it any more — a cover, a comment and an attachment can all point at the same upload. A file that is already WebP is left alone, and so is one that WebP would only make bigger, which happens with a small screenshot of flat colour. Attachments are still untouched: those are files somebody attached to be downloaded as they were sent.

- **Two processes starting against the same new database no longer collide.** Nothing recorded that a migration was *being* applied, only that it had been — so two processes reaching an empty database together both read an empty list, both started at the first migration, and the slower one stopped on a duplicate key with every table already created by the other. It is how the browser tests failed: the test harness and the server it starts share one throwaway database, and the server answers as ready while it is still migrating. A deployment bringing up a second replica has the same shape.

  Migrations now take a lock named after the database, and read the list of what has run while holding it, so the second process waits and then finds the work already done. The lock is scoped to the schema, so two instances sharing a MySQL server never wait on each other, and if the server refuses to grant it — a restricted account, a proxy in between — startup carries on as it did before rather than refusing to run.

## v0.33.0

### New Features

- **Images the app renders are stored as WebP, and profile pictures are scaled to the size they are drawn at.** A profile picture used to be kept exactly as it arrived — frequently a multi-megabyte photograph from a phone, displayed at 36 pixels on a card and downloaded in full by everyone who opened the board. Uploads are now re-encoded to WebP on the way in, and a profile picture is bounded to 144px wide, which is the largest it is ever shown. Images pasted into a card's description or a comment are re-encoded too, at their own size: those are meant to be looked at, so only the format changes.

  A picture smaller than the bound is left alone rather than scaled up to meet it, which would spend bytes to add nothing. An animated GIF stays animated.

  Attachments are deliberately untouched. Those are files somebody attached for someone else to download, and they should arrive as they were sent.

- **The pictures that ship with the app are WebP.** The fourteen placeholders offered when choosing a profile picture or a board cover were PNGs totalling 1.9MB — redrawn on every dashboard. As WebP they come to 196KB, a tenth of the size, for the same images.

  Anyone who already picked one has its old path saved, so a migration points those at the WebP that replaced them.

- **Profile pictures uploaded before this are shrunk too.** A picture stored by an earlier version is still whatever arrived, and would have stayed that way for as long as the account existed. Each one is re-encoded to a bounded WebP on the next start and its row pointed at the new file; the original is removed once nothing else names it, since a board cover or an attachment may point at the same upload.

  The new file gets a new name rather than replacing the old one in place, so anything still holding the old URL — a cached page, another open tab — keeps working until it reloads. A picture that is already a small WebP is left alone, which also makes the migration safe to run twice. Anything unreadable is skipped and keeps pointing where it did: a picture that still shows is better than a broken one.

### Fixes

- **A rejected image upload said the server had failed.** Every refusal from the image endpoint — a file that is not an image, one over the size limit — was caught by the same handler that reports an unexpected fault and came back as `500 Upload failed`. A caller could not tell "your file is wrong" from "we broke". Refusals keep the status they were given; only something genuinely unexpected is a `500` now.

## v0.32.2

### Improvements

- **All CSS lives in one stylesheet.** Four components carried `<style>` blocks of their own: two held nothing but a placeholder comment, one set the zoom cursor and hover lift on images in rendered card and comment content, and one styled the colour picker's swatches. They are in `main.css` now, with their explanations intact, so there is one place to look for a rule rather than a stylesheet plus whichever component happens to own the element.

  Nothing changes on screen. The swatch rules were the only scoped ones, and those class names appear in no other component, so moving them out of the component's scope reaches exactly what it reached before — checked against the rendered page: same size, same transparent border, same marker colour on the selected swatch.

## v0.32.1

### Improvements

- **An area sits tighter around its contents.** The list of cards carries a few pixels of padding of its own — room for the unread marker, which is drawn just outside a card and would otherwise be clipped by the edge of a scrolling list — and that padding was adding to the spacing the column already had between its header, its cards and the button that adds one. Doubled up, it read as a gap rather than as breathing room, most obviously in an empty area, where the two were all there was between the name and the button. The column's own spacing is halved to compensate; the distance between the last card and the button is unchanged.

### Documentation

- **The changelog is a page on the website.** `/changelog` renders this file — the repository's own `CHANGELOG.md`, reached through a link rather than copied into the site, so the page and the file cannot drift apart. It sits in the documentation's own layout, with the same sidebar beside it and an entry of its own in that sidebar, and is linked from the header and the footer beside the documentation and the API reference.

  It is linked into the site's own content directory rather than the collection being pointed up at the repository root. Pointing it up there is tidier to write and sets the file watcher walking everything above the site — `node_modules`, build output, the screenshot folders — which takes the development server down with `EMFILE: too many open files`.

  Two things had to be handled to make it read properly. An entry here is several paragraphs under one bullet, and the parser flattens those into a single run of text with line breaks between them — the tree it produces holds a `br`, not two paragraphs, and no styling can undo that, because a browser ignores every box property on a `<br>`. The page splits those runs back into paragraphs before anything is rendered, so the server sends it correctly too. The entries are also given a reading measure, so a paragraph does not run the full width of the column.

- **Every screenshot retaken.** The guide's fifteen, the README's, and the homepage's heroes in each of their widths — all from one demo run, so they are the same build on the same day rather than a patchwork of whenever each was last touched. What is different in them is everything the last two releases changed about a board: areas that stop at the bottom of the window and scroll their own cards, the button that adds one staying put below the list, the cards fading out at the edges instead of being cut in half, and the unread marker no longer shaved off against the side of its area.

  Three came out byte-identical — creating a board, the tile menu on the dashboard, and the user list. The demo data is fixed, so a view with nothing dated in it and no layout change reproduces exactly; that they did not move is the pipeline being repeatable rather than a step being skipped.

## v0.32.0

### Improvements

- **A scrolling area fades at its edges instead of cutting a card in half.** The same idea as Nuxt UI's `useScrollShadow` — a `mask-image` whose ends are transparent — with one difference: the fade is not a fixed height that switches on. It grows with the travel, so it is nothing at all while the list rests against an end and opens to its full 24px over the first 24px away from it. The edge softens as you pull away from it rather than appearing the moment you move.

  The mask is on the cards rather than on the area that scrolls them. Masking the scrolling element fades everything it draws, its scrollbar included, which left the scrollbar dimmed at exactly the ends it was pointing at. The cost is that the gradient is then measured in the cards' own coordinates rather than the window's, so every stop is offset by how far the list has scrolled — which is why it is redrawn as you scroll rather than only when the fade's height changes. A list too short to scroll gets no mask at all.

### Fixes

- **Opening a dialog made the areas behind it jump taller.** The board hides its horizontal scrollbar while a dialog is open, and where scrollbars take up layout space — Windows and Linux always, macOS whenever "show scroll bars" is set to always — removing it hands that height back to the board. The areas are sized to the space available, so every one of them grew by exactly the scrollbar's height and shrank again on close, leaving the scrolling list hanging below its cards.

  The same answer the page's own scroll lock already uses: the bar is measured on the way in, while it is still there, and its height is added back as padding so the box the areas are measured against never changes. The measurement takes borders off the difference rather than reading the whole of it as a scrollbar, which would have over-paid the day that element gains one.

- **The unread marker on a card was shaved off at the edges of its area.** Introduced by the scrolling areas in v0.31.0. The marker is a ring drawn just outside the card's own box, and a list that scrolls clips what leaves it — on both axes, because a browser told to scroll one direction stops overflow escaping the other. So the ring lost its left and right edges against the sides of the list, and its top and bottom on the first and last card.

  The list now carries a few pixels of padding for the ring to be drawn into. The sides and the top give that space back, so the cards sit exactly where they did; the bottom keeps it, because there the padding is the gap between the last card and the button that adds one — taking it back left the two touching. The marker itself is unchanged: it still sits outside the card, which is what makes it read as a highlight rather than a border.

## v0.31.0

### New Features

- **An area is as tall as there is room for, and its cards scroll inside it.** A column grew with its contents, so a board with a long list became a long page: the button that adds a card sat at the bottom of all of them, and reaching it meant scrolling past everything already there — worst exactly where it is needed most.

  The board now fills the window and each area stops at the bottom of it, scrolling its own cards. "Create new card" sits below that list rather than after it, so it stays where it is however many cards the area holds. A short area is still only as tall as its cards; nothing is stretched to fill.

  On a phone this is what makes the rest of it work: with the page no longer scrolling, a swipe on a card scrolls that area's cards. To-do boards are left alone — one long list is meant to be read as a page.

- **A card can be moved without dragging it, and dragging no longer eats a swipe.** Two halves of the same problem on a phone. SortableJS was set up with no touch options at all, so it claimed a gesture the instant a finger landed on a card: swiping to scroll the board picked a card up instead. A drag now needs the finger to hold still for a moment before it starts, and moving before that scrolls the way it always should have. Mouse drags are untouched — the delay applies to touch only. The same was true of the dashboard's tiles, and is fixed there too.

  That fixes scrolling, but not the other thing dragging is bad at: moving a card a long way down a long column, where the drop target is off screen and autoscroll is a fight. The card's ⋮ menu now has **Move card**, which asks where rather than requiring a gesture — the area to move to, and then top, bottom, or after a particular card. Trello answers the same question with a numbered position; a number means counting rows to find out which one you want, while "after this card" is the thing you already know. An area with nothing in it is not asked about at all: there is one place the card can land, so the position control is not there to be answered.

  It goes through the same two endpoints a drop does, so a move made this way reaches everyone else on the board live, exactly as a dragged one would.

  Verified with a real touch gesture rather than a synthetic drag: a swipe on a card scrolls the board 385px and reorders nothing — where, with the delay removed, the same swipe scrolls not at all and moves the card, which is the report. And through the dialog itself: a card sent to the top of its own area, to the bottom, and into another area after a chosen card, each checked against the database afterwards.

- **Code blocks can be copied.** A snippet written with the editor's Codeblock button, and every block in the documentation, now carries a copy button in its top right corner. It stays faint until the block is hovered — and is always visible where nothing can hover, since a touch screen would otherwise have no way to reach it. Copying ticks the button and raises a toast, so the confirmation appears both where the click was and where the app says everything else that just happened.

  In the API reference, where an example is offered in cURL, JavaScript, Vue, React and PHP, the button copies the language on show. That falls out of where it lives rather than being arranged: the button belongs to the code block, the tabs render every snippet and hide all but one, so the only button on the page at any moment is the selected language's.

  What gets copied is the code and nothing around it — not the syntax highlighting's markup, and not the trailing newline every fenced block ends with, which is the sort of thing that shows up later as a stray blank line in a terminal.

### Improvements

- **The countdown ring has a track behind it.** The ring marking a toast's remaining time now runs over a faint full circle of the same colour, so the shape is legible from the first moment rather than appearing out of nothing — at the start there is a ring waiting to be filled instead of a dot and empty space.

### Fixes

- **A card dragged down within its own area went back to its old place on reload.** The order was right on screen and right for everyone watching it live, so nothing looked wrong until the page was loaded again — and the further down a card was dropped, the further back it appeared to jump.

  `newIndex` from the drag is the position the card ended up in among cards it is already one of. The endpoint read it as a position to insert into, making room with `sort = sort + 1` for everything at or after it and then writing the card's new value. Moving a card *up* that happens to be correct: its old slot is above the shifted range and stays where it is. Moving it *down*, its old slot is inside the range that should have shifted and does not move, so everything between the two positions ends up one place short and the card lands one place above where it was dropped. Dragging to the very bottom of an area is the most visible case of it, and the one that was reported.

  Rewritten to do what the drag describes: take the card out of the area's order, put it back at that index, and write the whole sequence. The endpoint also now refuses a card that is not in the area it was told about, which it previously would have reordered anyway.

- **Toasts left the screen crookedly.** A toast on its way out was taken out of the layout flow so the stack could close up behind it — but a card sized by its own text then re-measured itself against the container's edge, so it appeared to slide sideways and change shape while fading. It now stays where it is and simply sinks: down by a hair, out to nothing, with the arrival decelerating into place and the departure accelerating away.

- **The Polish tooltip for copying was in Dutch.** `createdKeyCopyTip` carried "Kopiëren naar klembord" in `pl.json` — the Dutch string, sitting in the Polish file, on the button that copies a freshly created API key. The rest of the Polish copy strings around it were correct, which is presumably how it went unnoticed.

## v0.30.4

### Improvements

- **Toasts stack instead of replacing one another.** A toast arriving while another was still up simply overwrote it, so the first message could be gone before it had been read — and the second one inherited the first one's timer along with the screen, which is why a toast could sometimes flash past in a second. Each one is now its own toast in a column, oldest at the top, newest nearest the corner, and each carries its own countdown.

  Two of the same message make two toasts: two things happened, so the stack says so twice.

  The pointer stops every clock in the stack rather than only the one beneath it, so nothing expires and rearranges the column while a message is being read. The container itself ignores pointer events and only the cards accept them: it spans the full height of the stack, and as a solid element it would have swallowed clicks on whatever sits in that corner of the app.

  Verified by measuring what the browser paints, with real toasts raised through the sign-in page: three distinct messages make three cards that do not overlap and sit the stack's own 8px apart with the newest nearest the corner; the pointer freezes every ring to three decimals and none expires while it is there; the same message twice adds a card rather than replacing one; each card leaves as its own ring closes; and with `prefers-reduced-motion` a toast still gets its full five seconds.

- **A toast shows how long it has left, and waits while you read it.** Toasts disappeared after five seconds whether or not anyone had finished reading — and an error carrying a URL or an administrator's instruction is exactly the kind that takes longer than five seconds. Putting the pointer on a toast now stops its clock, and taking it away starts it again from where it stopped rather than from the beginning.

  The five seconds are visible now too. The dot beside the message has gained a ring that draws itself clockwise from twelve o'clock as the time runs down: nothing at all at the start, a closed circle at the end. It is animated as a path — `pathLength` normalised to 0–1 so the animation is the same whatever the radius — through the `motion-v` already in the project, and the ring is not a decoration running alongside a timer but *is* the timer: the toast is dismissed when the animation reports itself finished, so the picture and the behaviour cannot disagree about how long is left. Pausing one pauses the other by construction.

  The pinging dot is gone, replaced by the ring. Two things pulsing in a 20-pixel square was one more than the eye needed, and the ring says what the ping only implied.

  Verified in a browser against the real component, reading what the browser paints rather than what the code intends: the ring is empty at the start and about a fifth drawn after a fifth of the time; it does not move at all while hovered and the toast outlives the five seconds it would otherwise have had; it resumes from where it paused rather than restarting; and it is dismissed exactly when the ring closes. Including the case that would have been easy to miss — with `prefers-reduced-motion` set, an animation that finished instantly would have taken the toast with it, so the suite checks that the toast still gets its full five seconds.

### Documentation

- **Nix no longer leads the README's install instructions.** It arrived at the top of `## Install`, above cloning the repository, which put the least common way to install LokalBoards in front of every reader — a placement the feature's own release note did not argue for and nobody would choose on purpose. The section now reads in order of how people actually install it: from source, then Docker, then Nix in a section of its own.

  Being on its own rather than a paragraph above somebody else's steps, it also has room for the two things a Nix user needs and could not read off `nix run` alone: which platforms the flake covers, and that it wants a writable working directory, because uploads are resolved relative to it and the store is read-only.

  The documentation site keeps its order. That page is arranged by method rather than by popularity, so Nix sits between running from source and building the image, which is where someone comparing methods would look for it.

## v0.30.3

### New Features

- **Installable with Nix, and runnable as a NixOS service.** Asked for in [#13](https://github.com/florian-strasser/LokalBoards/issues/13) — the first request this project has had from someone outside it. The repository is now a flake: `nix run github:florian-strasser/LokalBoards` starts the server on a machine with nothing else installed, on Linux and macOS, on x86 and ARM. A NixOS module comes with it, putting the application behind a systemd unit with a hardened sandbox and a local MySQL 8.

  Two things about the build are worth writing down, because both took a wrong turn first. `importNpmLock` looked like the tidy answer — no dependency hash to keep in sync — but it caches tarballs and not registry metadata, and this lockfile needs the metadata: `archiver-utils` wants `minimatch@^9` and `readdir-glob` wants `^5` while one copy is pinned at 10.2.5, so npm asks the registry and a sandbox has no registry to ask. And the build runs on Node 24 while the result runs on Node 22, because `package-lock.json` is written by npm 11 and the npm 10 that Node 22 carries rejects it as out of sync — the same disagreement the Dockerfile settles by installing npm 11 over the image's own. Only the toolchain differs; what Nuxt emits is portable JavaScript.

  The module creates the database but deliberately not the database *user*. NixOS makes users that authenticate through the unix socket without a password, and this application connects over TCP with one, so a user made that way could never log in — better to say so, with the one statement that fixes it, than to ship a default that fails at first start. `environmentFile` is required rather than optional, since a database password has no business in a world-readable store.

  **Tested:** the package. It builds from the lockfile with no network, and the result was started against a real MySQL 8, seen to run its migrations, create its schema and serve the sign-in page, with uploads landing in the working directory rather than against the read-only store. **Not tested:** the NixOS module on a NixOS machine. It evaluates, `nix flake check` passes, the generated unit has been read line by line and the missing-secret assertion fires as it should — but none of that is the same as having run it. The guide says so in as many words.

## v0.30.2

### Fixes

- **Accounts older than v0.10.0 could not be impersonated, edited or deleted.** Four endpoints that take the id of a stored row — impersonate, update and delete a user, and delete an API key — required that id to be a UUID. This app has minted UUIDs since v0.10.0, when better-auth was replaced; the ids better-auth minted before that are 32 alphanumeric characters with no hyphens, and they are still the ids those accounts have. From v0.19.0, when the check was added, an instance that had been running since before v0.10.0 got `INVALID_USER_ID` for its oldest accounts — the admin's own among them, on the oldest instances — and there was nothing in the message to say that the id was the objection.

  The check never protected anything: the id goes into a parameterised query, the column is `varchar(36)`, and an id that matches nothing already had an answer of its own in `USER_NOT_FOUND`. It is now a sanity check on the string — printable, unpunctuated, no longer than the column — and whether the row exists is left to the lookup, which is the thing that knows.

  Verified against both generations of id on a real instance: an account with a better-auth id can be impersonated, and the session that comes back is that account's and is marked as an impersonation; the same account can be renamed and deleted. And the looser check is still a check — an empty id, a path traversal, a quoted string and anything longer than the column are all refused, while a well-formed id belonging to nobody is a `404` rather than a `400`.

  The password-reset endpoint keeps the strict UUID check. Its token is not a stored id but one this app generates for each request, so it has always been a UUID and there is no older shape to accommodate.

## v0.30.1

### Fixes

- **The SAML test provider escaped what it echoed.** Code scanning flagged the fake identity provider the SAML tests run against: it built its auto-submitting form by interpolating query parameters into HTML, escaping the quote in two of the three and nothing at all in the `action` attribute. It is a fixture — it listens on a loopback port for the length of a test run, and every value it echoes is one the test itself passed in — so nothing was exposed by it. It is also a fixture for a feature whose entire purpose is refusing input that is not what it claims to be, which is a poor place to leave that pattern lying around. All three values now go through one escape, `&` first so the escaping cannot escape itself.

## v0.30.0

### New Features

- **Single sign-on, against any OpenID Connect provider.** Entra ID, Google Workspace, Okta, Keycloak, Authentik, Auth0 — one button on the sign-in page, four environment variables, and no separate password to look after. It is the feature most self-hosted tools keep behind an enterprise tier; here it is the same MIT licence as everything else.

  Accounts are made on first sign-in, from the name and address the provider supplies. Somebody who already has an account here is linked to it by e-mail address rather than given a second one, so a team that has been using the instance for a year keeps its boards — safe because the address comes from the configured provider over a channel authenticated with the client secret, not from a form. An instance can also refuse to create accounts at all (`NUXT_SSO_PROVISION=existing`), restrict sign-in to its own e-mail domains, and read the administrator role from a group claim, which is then applied on every sign-in in both directions.

  The authorization code flow with PKCE, a nonce and CSRF state, exchanged server-side: no token ever reaches the browser. The ID token's issuer, audience, expiry and nonce are all checked. Its signature is not, which OpenID Connect Core §3.1.3.7 permits when the token comes straight from the token endpoint over TLS to a client that authenticated itself — and that is written down beside the code rather than left to be discovered.

  Verified end to end against a provider that insists on PKCE, a nonce and client authentication, standing up per case: a first sign-in creating the account, a second reusing it, an existing account being linked rather than duplicated, an unknown person turned away under `existing`, a foreign domain refused, a sparse ID token filled in from userinfo, an admin group granting and then removing the role, a forged callback rejected for want of this browser's state, and — with SSO off — no button and `404` from both endpoints. Thirty checks, and the fixture is committed with them.

- **Several identity providers on one instance, and routing by e-mail domain.** One provider stays as simple as it was; an instance that needs more names them — `NUXT_SSO_PROVIDERS=acme,partner` — and every setting that exists on its own exists per provider under that name, falling back to the instance-wide value where it is not set. OpenID Connect and SAML providers are named independently and can run side by side. Each SAML provider gets its own reply URL and metadata document.

  With several configured, a row of buttons would ask everybody to know which of their organisation's names is on theirs. Tell each provider which e-mail domains it signs in, and typing an address brings the right one forward — subdomains count, and the most specific match wins, so a subsidiary's provider beats the parent's catch-all. It refuses nobody, and it says nothing about whether an account exists, so it cannot be used to find out who uses an instance.

- **SAML 2.0, for the providers that speak it.** Entra ID, Okta, Keycloak, ADFS, Shibboleth — a second button beside the OpenID Connect one, and both can be on at once. An account is the same account whichever way somebody arrives: the linking, the provisioning policy, the domain restriction and the administrator claim are shared, and a person can hold a password, an OpenID Connect identity and a SAML identity at the same time without any of them displacing the others.

  The service provider's metadata is served at `/api/auth/saml/metadata`, so most providers can be pointed at a URL rather than configured by hand. Attribute names are recognised in their common spellings — `email`, `mail`, the `urn:oid:` forms, Microsoft's schema URLs — and anything else can be mapped.

  The XML signature checking is `@node-saml/node-saml` rather than something written here. Everything dangerous about SAML lives in the XML — canonicalisation, which element a signature actually covers, and the signature-wrapping family that has produced authentication bypasses in library after library for fifteen years — and that is not a thing to hand-roll to save a dependency.

  What is written here is checked by a provider that signs real assertions with a real key, and then signs them wrongly on purpose: a valid assertion signs in and creates the account; one signed with an untrusted key, one altered after signing, one addressed to a different audience, one whose window has expired, and one from an unexpected issuer are each refused with no account and no session; attributes fill in the name and an administrator group; an existing account is linked rather than duplicated; `RelayState` cannot be used as an open redirect; and with SAML off there is no button and `404` from all three endpoints.

  Two things that test found and changed the implementation. Requiring the response document to be signed as well as the assertion — which is what the first version did — would have failed against nearly every real provider, since Entra ID and Okta both sign the assertion alone; it is now off by default and available as a setting. And node-saml compares the configured `idpIssuer` only for logout messages, never for assertions, so a comment here claimed a check that was not happening: the issuer is now pinned in the endpoint itself.

  **Not implemented:** single logout. It is written down in the guide rather than left to be discovered.

- **SAML: encrypted assertions, and sign-in started at the provider.** Some providers encrypt assertions by policy — give LokalBoards a key pair and the certificate is published in its metadata, so a provider pointed at the metadata URL finds it by itself. Assertions are decrypted before anything else is read, and an unencrypted one still works, so the setting can be turned on mid-change.

  Somebody clicking the application's tile in Entra's My Apps or Okta's dashboard arrives with an assertion nobody asked for. That is now accepted where an instance allows it, and refused by default — an unrequested assertion is a bearer token with nothing tying it to the browser presenting it. Where it is allowed, each assertion may be used exactly once: the identifier is recorded as it is consumed, keyed on a primary key so two requests racing with the same assertion cannot both win, and `RelayState` that is not a path on this instance is ignored rather than followed.

  Both are covered by the test provider, which now encrypts on request and answers with or without an `InResponseTo`: an encrypted assertion signs in and the metadata offers the certificate; an unsolicited one is refused while the setting is off, accepted once when it is on, and refused the second time it is presented.

  Writing the provider-initiated path exposed a hole in the existing tests: every SAML case had been posting assertions straight to the endpoint rather than starting at the button, so none of them had ever exercised a *solicited* sign-in — the new refusal is what surfaced it. The test provider now answers real AuthnRequests, and the cases go through the sign-in page as a person would.

- **Plain OAuth 2.0 providers, through claim mapping.** Not everything is OpenID Connect, and a provider that is not answers its profile endpoint with whatever field names it likes — GitHub sends `id` and `login`, not `sub` and `name`. Three settings say where to look, each taking several candidates in order (`email,primary_email`) and dotted paths into nested objects (`data.attributes.display_name`).

  A provider that sends none of the standard names and has no mapping is refused rather than guessed at: better a clear "no e-mail address" than an account keyed to the wrong field. The token request also asks for JSON and parses a form-encoded answer anyway, which is what GitHub's token endpoint returns unless asked.

  Verified with a provider that has no discovery document, issues no ID token, answers form-encoded and uses GitHub's field names: it signs in with a mapping, is refused without one, and falls through to a second candidate address and a nested name where those are configured.

- **A board's tile carries the board's own menu.** Renaming a board or inviting somebody to it meant opening the board first, going to its **⋮**, doing the thing and coming back. The tile on the dashboard now has the same **⋮**, with the same entries the board's page offers — settings, invite, delete — or, for a board somebody shared with you, leaving it, which is the only one of the four that was ever yours to do. Rights decide what is in the menu, exactly as they decide what is in the board's own.

  The settings form is now one component rather than two copies. The board page has always had it; a second, drifting copy on the dashboard was the obvious way for the two to stop matching.

  Hovering it puts a target behind the mark instead of recolouring it. It used to take the hover blue, which on a blue tile is the tile: the button disappeared at the moment it was being aimed at. The tint is mixed from `currentColor`, so it is white on a dark tile, near-black on a pale one and grey in a dialog, without anything having to say where the button is.

  It sits at the end of the tile's top row, after the unread dot and the "shared" badge, rather than pinned to the corner on top of whichever of them the board happens to have. The menu it opens is rendered into `<body>` and positioned against its button: a tile clips what overflows it, which is what keeps a cover image inside its rounded corners, and it would have taken the bottom off the menu with it.

### Improvements

- **A board tile is dragged by the tile.** Arranging the dashboard meant finding a small grip in a tile's corner first. A card on a board has never asked for that — you pick the card up — and neither does a tile now. Its own menu is the one thing excluded, so pressing the three dots opens the menu instead of picking the board up.

- **The dashboard keeps up with everyone else.** A tile is a board's name, its colour or image, and the faces of the people on it — all of which somebody else can change, and none of which used to arrive without a reload. The board itself had realtime updates; its tile on four other dashboards did not.

  Each dashboard now listens on a room of its own, and the endpoints that change a board tell every dashboard showing it: renaming or recolouring it, inviting somebody, taking them off, leaving it, deleting it. The notification is sent from the endpoint rather than from the browser that asked, so it happens whichever way the change arrived — including from an API key, and including a delete, where the members have to be read before the board is gone.

  The board's own signal carries its colour and image now as well. They were left out, so a board that changed colour stayed the old colour on every other screen — and the tiles, which are mostly colour and image, would have shown nothing at all.

  Verified with three accounts in three browsers: renaming from a tile reaches the other members' dashboards and the board itself; inviting a fourth person adds their avatar to the tile on every dashboard, and gives them the tile; removing them takes it away again from all three; deleting the board clears it everywhere.

- **An empty section offers a "new board" tile.** A group could be filled only by dragging something into it, which is a poor way to find out that a group is a place boards can be made. An empty one now says so, with the same tile the ungrouped area has, and a board created from it is filed into that group straight away rather than landing in the ungrouped area to be dragged back.

  Only while it is empty, and that goes for the area above the groups too, which had carried the tile permanently: in a section that already has boards the tile is one more cell in the grid, and a full row of four plus a tile is a second row holding nothing else. The blue **+** in the page header still makes a board at any time, and it is unchanged — it makes an ungrouped one.

  It also comes and goes as you drag rather than at the drop. SortableJS moves the tiles as the pointer travels and only reports at the end, so the group being dragged into kept its tile and the board came to rest beside it, and the group being emptied stayed blank until the mouse came up. While a drag is running the tiles are counted from the page — including the placeholder that shows where the board will land, excluding the clone that follows the cursor, which SortableJS parks in the list the drag started from and which had the emptied group still counting one.

  The tile is the whole of the empty state. A group used to show a dashed box captioned "drag boards here", from when dragging was the only way to fill one; beside a tile that makes a board, it was two answers to the same question and a lot of furniture for a group with nothing in it. Dropping a board into the group still works — the grid was always the drop target, the dashed border only drew attention to it.

### Fixes

- **Deleting a card left its attachments behind, and their files for ever.** Deleting a card removed its comments and its notifications and stopped there: the attachment rows stayed, the uploaded files stayed on disk, and the reminders and the activity trail stayed with them. Deleting an area or a whole board left the same debris for every card in it. Nothing visible pointed at any of it, which is why it went unnoticed — and why the uploads directory only ever grew.

  Card duplication made it worse rather than causing it: a duplicate's attachments are copies on disk, so from that release every deleted duplicate leaked its own file.

  All three deletions now go through one helper that takes the attachments and their files, the comments, the reminders, the activity and the notifications. A file is only unlinked once nothing else names it — before duplication copied files, nothing stopped two rows pointing at one path, and unlinking a file another attachment still refers to would turn a tidy-up into a broken download. A migration clears what earlier versions left: rows whose card no longer exists, and the uploads only those rows named.

  Verified against a real instance, on disk as well as in the database: deleting a card, an area and a board each leaves no rows and no files; a file shared by two attachments survives the first card's deletion; and the migration, re-run against seeded debris, clears the rows and the file and records itself.

- **The search placeholder was cut off mid-letter.** It is a full sentence and the field is often narrower than it, so the tail has to fade rather than be chopped — and fading it means knowing whether it is too long, which is where this kept going wrong.

  Every way of working that out from the font was a guess, and each guess was wrong somewhere: `measureText` does not know that Safari renders 14px text at whatever minimum font size is set, so it came out under and the fade was withheld from exactly the field that needed it; a cloned input counts a cancel button that a placeholder never has, so it came out over and dimmed text with room to spare.

  The placeholder is an element of our own now rather than the input's attribute — sitting where the input's placeholder sat, from the icon's edge to the padding — and an element can simply be asked: `scrollWidth` against `clientWidth` is what the browser did, not a model of it. It is right whatever the font turns out to be, and it is per placeholder rather than per language: measured again whenever the box resizes and whenever the text changes, so the locale being applied after mount is caught too.

  The field is sized to that same measurement rather than to a fixed maximum, and the figure for each language is in the stylesheet as well as measured. A measurement can only land after the first paint, so a field that arrives at one width and settles at another jumps on every load; the baked value is what the measurement comes to, so it lands on the same number and nothing moves. Regenerating them after changing a placeholder is a line in the stylesheet's own comment. A fixed one has to be the longest language's, which left English sitting in a field half again as wide as its sentence; the header caps it at the width its own placeholder needs, so every language gets its own — 391px for English, 439px for German, 517px for French, each exactly the text plus the icon and the padding. It is still `flex-1` below that, so a narrow window shrinks it and the fade comes back.

  Verified in both engines by reading the rendered pixels: all ten languages sized to the pixel with nothing faded; German crisp from 800px up, fading below, and coming back unchanged on the way out; with the font forced three sizes larger — the case that was broken — it fades at every width instead of chopping; the phone's dialog fades and keeps its own width; the field does not move while a long query is typed; a typed query is never dimmed.

- **Dialogs did not line up with the page behind them.** On a narrow window a dialog was capped at `max-w-lg` and centred, which left it a few pixels wider than the column of board tiles on each side — too close to read as a margin, too far off to read as alignment. And because a dialog is `position: fixed`, its box is the whole window, including the strip the scrollbar occupied that the locked page no longer covers; on any machine where scrollbars take up space (a mouse connected to a Mac, or Windows and Linux always) it also sat half a scrollbar to the right of everything behind it.

  Below `sm` the card is now the width of the window, edge to edge, and its own `p-8` — `.container`'s `2rem`, to the pixel — is what lines its contents up with the page. Inset to the container it would have been aligned and 64 px narrower, and on a phone that width is the whole point: it is where the title, the attachment names and the comments have to fit. From `sm` up there is room for a real dialog, so it becomes one — `max-w-lg`, centred on the page's axis rather than the window's, using the width the lock reserved, which it now publishes as `--scrollbar-gap`.

  Verified at 320, 393, 557, 639, 640, 768 and 1280 px across the board options, invite, delete and card dialogs: below `sm` the card touches both window edges and its content sits on the container's lines to the pixel; above it, a centred 512 px dialog. Close button never clipped, no page overflow, and with a 15 px scrollbar reserved the card's centre follows the page's centre instead of staying at the window's.

### Documentation

- **A guide for setting it up, provider by provider.** Covers both protocols: What the redirect URI has to be and why it has to match exactly, every setting and what it does, then step-by-step registration for Entra ID, Google Workspace, Okta, Keycloak, Authentik and Auth0, plus what to do with a provider that publishes no discovery document or names its fields its own way. Who gets in and how that differs from who the provider lets through, how existing accounts are joined, how to turn it off again without locking anybody out, how the sign-in works for anyone reviewing it before deploying, and a table matching each failure message to what usually causes it.

- **Every screenshot retaken.** All fifteen in the guide, the README's, and the homepage's heroes in each of their widths — one demo run, so they are all the same build on the same day rather than a patchwork of whenever each was last touched. What changed in them: the tile menus, the tiles being dragged by the tile rather than a grip, the unread dot and the shared badge reading from the left, the card dialog's own menu, and a search field sized to its placeholder.

- **The boards guide covers the tile menu.** "Open a board and click the ⋮ at the top right" was the only way described to reach a board's options, and it is no longer the shortest one. The dashboard screenshot was retaken with the menus on the tiles, and the tile menu is shot open beside the text.

## v0.29.0

### New Features

- **A card can be duplicated.** The card dialog's delete icon is a three-dot menu now, the same one the board and the dashboard headers carry, holding *Duplicate card* and *Delete card*. A single irreversible action sitting one press away at the top right of a dialog people open to read a card was the wrong weight for it; delete still asks before it acts, and now it has to be asked for first.

  The copy takes the title, the description and whatever checklist it holds, the due date, its reminders, the assignee and the done state, and lands directly under the original rather than at the foot of a list long enough to hide it. Everything below it moves down one, on the server and on every screen watching the board.

  Comments are not copied. They are a conversation about one card, in the order it happened, and they belong to the card they were written on.

  Attachments are, and each kind on its own terms. A stored file is copied on disk under a new generated name, so the two cards hold two files: pointing both rows at one file would have looked right until the day somebody deleted either card's attachment, because the delete handler unlinks the file and would have left the other card with a row pointing at nothing. A base64 attachment lives in the row, so copying the row copies the bytes. An external URL is not ours to copy, so the copy points where the original points. Verified: deleting the copy's attachment removes the copy's file and leaves the original's exactly where it was.

### Improvements

- **Search on a phone is a button in the nav, not a row of its own.** The field could not fit beside the logo and the nav, so it wrapped to a full-width line underneath — a permanent strip of every phone screen, above the fold, spent on something used occasionally. The nav pill has a search button below `sm` now, and it opens the same search in a dialog: the field, focused, with the results under it and the whole width of the screen to show them in.

  One component either way. `GlobalSearch` takes a `variant`, and the only thing that changes is where the results go — the desktop field teleports them into `<body>` and positions them against itself, because inside the header they would be clipped; in the dialog neither applies, so the Teleport is switched off and they render where they are written. The results markup, the debounce, the request sequencing and the highlighting are one copy, shared.

  The field is focused in the click that opens the dialog rather than in a watcher afterwards: the dialog is always mounted, so the focus still belongs to the original gesture, which is what iOS wants before it will raise the keyboard. Closing clears the query, and following a result closes the dialog — the header is not remounted between pages, so nothing else would.

  Following a result no longer empties the panel on the click. It used to close on the click itself, so the results vanished and left the reader looking at an empty dialog for as long as the page took to arrive. They stay up now, dimmed and no longer clickable, and the arrival closes them — the list is the last thing worth looking at while the board loads, and the thing that was clicked is still on screen. A result pointing at the page you are already on finishes immediately, since the router discards that navigation and no arrival would ever come.

  Verified against a real instance at 390×844: the header is one row, the dialog opens focused, typing returns boards and cards, a result navigates and takes the dialog with it, Escape closes it and reopening starts empty. Desktop is untouched — inline field, no button, results still teleported. Click to board is 183-210 ms on a production build; in dev the first one costs about half a second more while the page chunk is compiled.

### Documentation

- **The cards guide covers the menu and duplication, and its screenshots were retaken.** "The bin icon at the top of an open card deletes it" described a control that is no longer there. Moving and deleting are separate sections now, with the menu shot open beside them, and the API reference documents `POST /api/data/card-duplicate` alongside the other four card endpoints — an endpoint reachable with an API key should not be the one that is missing from the page.

  Three images were stale rather than merely old: the card screenshot in the guide and the README's screenshot both show the card dialog, which had a bin icon in them, and the homepage's phone hero showed the search field wrapped onto its own row under the header. All are retaken from the demo run, which now captures the card menu as a view of its own.

- **The header's button goes to the repository.** It was a mail link, which existed to catch hosting enquiries; with nothing for sale there is nothing to enquire about, and for someone weighing up a self-hosted tool the useful question is whether it is real and maintained — which the repository answers and an address does not. It carries the GitHub mark beside the word, so it reads as a link to the code at a glance rather than as another nav item. No `mailto:` is left anywhere on the site outside the legal pages, where the law wants one.

- **The hosted plan is off the site.** Nothing is sold from lokalboards.com any more: the second pricing card is gone. Pricing keeps its place, but not its shape: with nothing left to compare against, a card with a list of lines under it was arguing a case that no longer had two sides. It is one block now, saying the thing a reader came to the section for: 0 €, forever, for any number of people, open source under the MIT licence, and where to start.

## v0.28.2

### Fixes

- **A board with an invitation from a deleted account answered `500`.** Deleting a user removed their sessions, keys and account, but left every invitation pointing at them on other people's boards. The board then rendered a member with no name, and reading the first letter off that name threw during render — which on a server-rendered page is not a blank avatar but the whole page failing. Opening the permissions dialog hit it first, and a reload could not recover, because the same render runs on the server.

  Three things, so it cannot come back: deleting a user now clears their invitations, their notifications and any unused e-mail invitations they sent; a migration removes the rows already orphaned; and the dialog no longer assumes a name is there — an invitation whose account has gone reads "Deleted account" and can be removed from the board like any other.

  Reproduced against a real database before and after: with an orphaned invitation the board answered `500`, and now answers `200` with the row shown as deleted.

### Documentation

- **The social card carries the real logo and the hero's own words.** It was drawn with two plain rounded rectangles standing in for the mark, under a headline written for the card alone. It uses the logo component's own paths now and says what the page says — "Open-Source Kanban boards for teams" over "Where Humans & Agents work together." — so a shared link and the page it opens read as the same thing. The block is centred against the full height of the card rather than hanging from the top, and the blue rule along the bottom edge is gone.

## v0.28.1

### Documentation

- **Invalid ARIA on every animated heading.** `SplitText` carried the real sentence as an `aria-label` on its container — which is not permitted on an element with no role, so a `p` or a `span` wearing one is both invalid and, on some assistive technology, ignored. The sentence is a visually hidden copy now: read normally, never seen, and the animated pieces stay hidden from assistive technology as before.

- **Nothing blocks the first paint any more.** Component styles were compiled into stylesheet chunks of their own, and a 0.9 KiB file fetched before the page can paint costs 150 ms on a phone — far more in latency than the bytes are worth. All seventeen blocks moved into `main.css`, which is inlined. No page on the site now loads a render-blocking stylesheet; every selector was already namespaced by its component, which is what made the move safe.

- **Images come in more than one size.** The page shipped one width of each and let the browser scale it: a phone downloaded a 1686-wide cloud to paint 721 of it, 120 KiB of 148 wasted. Both heroes and the cloud now offer three widths through `srcset`, and the demo run writes every one of them, so they cannot drift apart. A phone at 2× takes the 800-wide cloud instead of the 1686.

- **A stray space before the comma in the realtime tile's dates.** The meta row is a flex line with a gap, so splitting the date from the time made the time its own flex item — and the gap landed between "Aug 8" and its own comma.

- **Resizing the window left the first feature tile's card in the wrong place.** Its animation is written in `em`, and v0.28.0 tied the fragment's size to the tile's width — so every distance in those keyframes, how far the card travels and how far an area opens to take it, is resolved from a number a resize changes. A running animation keeps the values it resolved with, so after the window grew the card still moved the old distance and came to rest where it belonged at the narrower width. Reloading always fixed it, which is the tell.

  The loop now restarts when the fragment's box changes size, 150 ms after the dragging stops, which re-resolves all of it. Verified across an eighteen-step edge drag from 380 to 900 px in Chromium and WebKit: the font size follows to 11.2 px and the animation clock goes backwards — 2269 ms to 850 ms — which is the restart rather than a stale loop carrying on.

  Only this tile moves anything far enough across itself for the drift to show, but any future fragment with travel of its own wants the same treatment.

## v0.28.0

### New Features

- **Invite somebody who has no account yet.** Until now a board could only be shared with a person who was already on the instance, so bringing in a colleague meant an admin creating their account first. Type a full e-mail address into the invite dialog instead and they are sent a link that creates their account and joins them to the board in one step, with the read or write access you chose.

  The link is a 256-bit random token, of which only the SHA-256 is stored. It is good for **one** registration, expires after **14 days**, and carries the address it was issued to — the sign-up form shows that address and will not let it be changed, and the server pins it regardless of what the request asks for. Inviting the same address again replaces the outstanding link rather than leaving two live.

  It works on an instance with `NUXT_PUBLIC_SIGNUP=false`, which is the point of it: the board owner decides who joins, not the sign-up form. The account and the board access are created in one transaction with the token being spent, so two people racing the same link cannot both get in — one wins and the other's registration rolls back whole.

  Verified end to end against a real database, on an instance with public signup **disabled**: signing up without a token was refused; signing up with the token created the account, granted the board, and spent the link; the request asked to register `attacker@evil.com` and got `newcomer@example.com`, the address the invitation was issued to; the invited user's dashboard showed the board immediately after signing up; and replaying the link, or using an expired one, created nothing.

- **The first administrator comes from the environment.** Set `NUXT_ADMIN_EMAIL` and `NUXT_ADMIN_PASSWORD` and a fresh instance starts with an admin account already in place, rather than asking you to sign up and then change a `role` column in MySQL by hand. `NUXT_ADMIN_NAME` is optional and defaults to "Administrator".

  It is written to be safe to leave configured for ever:

  - It only acts when the instance has **no administrator at all**. Once one exists the variables are ignored, so a role changed in the interface is never quietly reapplied from a stale environment.
  - An address that already has an account is **promoted in place** and its password is left alone. No password is ever overwritten from the environment.
  - Nothing secret reaches the log — not the password, not the hash. The address is the most it will say.
  - A failure is logged rather than thrown. A typo in the address must not stop a running service.

  That also makes it a recovery hatch: if the last administrator is ever deleted, restarting with these set restores access.

  One thing found while testing it: the `1.` filename prefix does **not** reliably order a Nitro plugin after `0.database-migrate.ts`. On a fresh database the bootstrap reached the `user` table 73 ms before the migrations created it. It now waits for the schema itself through the memoised `runMigrations()`, so it awaits the same run rather than starting a second one.

  Verified end to end against a real database: created the account and signed in with it (200, and 401 on a wrong password); a restart with a *different* `NUXT_ADMIN_PASSWORD` left the stored hash untouched; demoting the admin and restarting promoted the same account back without touching its password; an invalid address and a too-short password each logged one clear error, created nothing, and left the server serving; and with nothing configured it says nothing at all.

  The documentation's "access your database directly" instruction is gone with it.

- **The MCP server accepts its key as a bearer token too.** `x-api-key` remains the documented header, and `Authorization: Bearer <key>` is now the same thing. This is not a preference: Mistral's Le Chat sends credentials only as an `Authorization` header, and the OpenAI Responses API passes its `authorization` value the same way — so an instance that read one header name was simply unreachable from both, whatever the user typed. `x-api-key` still wins when a caller sends both, and the bearer form is only consulted for API-key resolution, which the endpoints that also accept session tokens reach after resolving the session.

  The MCP documentation now says how to connect from each client — Claude Code, Claude Desktop, claude.ai, Le Chat, the OpenAI API — and, as plainly, where it cannot: ChatGPT's custom connectors take OAuth or nothing at all, so a LokalBoards instance cannot be added there today. The unauthorized message and the server's own instructions name both headers.

  Six integration tests cover it against a real database, and the flow was checked end to end against a running instance: `tools/list` and a `listBoards` call both succeed with a bearer key and with `x-api-key`, an unauthenticated tool call is still refused, and the tool catalogue stays public.

### Fixes

- **The invitation link bounced off an instance with signup disabled.** `NUXT_PUBLIC_SIGNUP=false` sent every `/sign-up` request to the front page, invitation links included — which defeated the one case the feature exists for. The route middleware now lets `/sign-up` through when the URL carries a 64-hex invitation token. Only the shape is checked there; whether the token is real, unspent and unexpired stays the server's answer, so a bad link lands on the form with a message rather than on a silent redirect.

  Verified against a real database on an instance with signup **off**: `/sign-up/` alone still redirects, `?invite=` with a malformed token still redirects, and a genuine link opens the form with the invited address filled in and read-only, creates the account, grants the board with the permission it was issued for, and spends the token.

- **An e-mail invitation could be typed but not sent.** The permissions dialog recognised an address with no account and said what would happen — and then left **Send invitation** disabled, because the button was gated on a *picked* account and an invitation by address has none to pick. It is enabled by a valid address as well now, which is the whole point of the feature.

  The note explaining it moved out of the suggestion list and under the field. As a list item it was pretending to be something to choose, and it covered the read/write control the reader needs next; the list now closes when there is no account to offer.

- **Four languages were missing the card-deletion prompt.** Spanish, Italian, Dutch and Polish still had it under `deleteCardHeadline`, the name it went by before the key was renamed to `deleteCardTitle` — so the text existed, correctly translated, and the interface never used it. Polish was also missing all three of the API-key deletion strings. Both are now where the code looks for them.

- **A refused registration answered with `200`.** `POST /api/auth/sign-up` on an instance with signup switched off returned `{ "error": "DISABLED_SIGNUP" }` under a success status — fine for the sign-up form, which reads the body, but an error wearing a success code for anything reading the status: proxies, logs, monitoring. It is a `403` now, and the form shows a translated message rather than a raw failure.

### Documentation

- **The documentation was rewritten against the actual interface.** Every page was checked against a running instance, and the steps were wrong in more places than the prose suggested: there is no "Edit" button on a board (it is **⋮ › Board options**), no "Add Card" or "Add Area" button (**Create new card**, **Create new area**), and inviting somebody never worked by typing an address into a field — the dialog searches accounts that already exist. Checklists, due dates, assignees, attachments, the image lightbox and agent accounts were not documented at all.

  Eleven screenshots taken from the demo capture run now illustrate the dashboard, the create and options dialogs, permissions, deletion, an open card, the lightbox and both board layouts — 544 KB of WebP for all of them.

  Two pages were materially out of date rather than merely thin. **Getting started** still said the image "contains only the app — you still need a reachable MySQL", which stopped being true when the image gained its own database; it now opens with the one-command install and keeps the external-database route beside it, points at the two Compose files that ship with the repository, and lists all ten languages rather than seven. **MCP Server** was a connection snippet; it now lists the twenty-six tools by area, explains `claimCard`/`releaseCard` for keeping two agents off the same card, and says to give an assistant its own marked account.

  **Disable Signup** used to end at the flag. It now says how people still get in — a board invitation or an admin-created account — because an instance with signup off is otherwise a locked door with no key.

- **The API reference was rewritten, with examples in five languages.** Every request now carries a tabbed block showing the same call as cURL, JavaScript `fetch`, a Vue `<script setup>` component, a React component and PHP with curl — and the language is remembered, so picking Vue once turns every example on every page into Vue, across navigations and across visits. It is one shared piece of state behind a cookie, and each snippet is highlighted at build time and hidden rather than swapped in, so switching costs nothing.

  Checking each endpoint against its handler while writing them turned up documentation that would not have worked. `POST /api/data/boards` was documented as taking a `userId`; it takes no such thing — the key decides whose boards come back, which is exactly what stops a key being pointed at somebody else's. `DELETE /api/data/area` needs `boardId` as well as `id`. `PUT /api/data/card` is a replacement rather than a patch and rejects a body without `name`, so the old "send only what changes" advice returned a `400`. Three endpoints were not documented at all: moving a card between areas, reordering one inside its area, and the invitation endpoint.

  The reference reads in the order you would use it — authentication, boards, their areas, the cards in them, then comments and invitations — rather than alphabetically, where `Area` came before `Areas` and both before `Board`. Two pages moved to `/api/card-move` and `/api/card-order`: content paths are lower-cased, so the camelCase names resolved to nothing and both pages rendered blank.

  A mistyped documentation or reference URL answers `404` now. Both `/docs/[slug]` and `/api/[slug]` used to render the header and the sidebar around an empty article and return `200`, so a wrong address looked like a real page that happened to have nothing on it — and a crawler had no way to tell either.

  On a 320px screen a four-column parameter table cannot fit however it is wrapped — an id or a variable name is one unbreakable word wider than the screen — so below `xs` the table becomes its own scrolling box rather than pushing the page sideways.

  Two pieces of styling were missing underneath. Parameter tables had no CSS at all, so a type ran straight into whether it was required — "integeryes" — and code blocks were styled by a child selector that the blocks inside a tabbed example did not match, leaving them unstyled and wide enough to push the whole page sideways. Checked at 1440, 768 and 390 px: no page scrolls horizontally.

- **The closing section no longer measures itself against the viewport's height.** It was `min-h-screen`, and `100vh` is the one length on a phone that changes while you are only scrolling: the URL bar slides away, the section grows, and the tile field jumps with it — measured at 74 px of movement for a 100 px change of height, which is what made the animation look broken on a phone and while dragging a window. Its height now comes from the viewport's **width** (`min(56.25vw, 44rem)` — 16:9, the proportion the composition was drawn against), which nothing about scrolling can alter.

  The path itself was redrawn in container units — a share of the section's own width and height, rather than of the tile. It used to be percentages of the tile, whose size follows the section's *width*, so the vertical travel did too: the same animation spanned 73 % of the height on a desktop and 19 % on a phone. Both ends of the path now land on edges the viewer can actually see, whatever shape the section is, and the path now starts as far up from the bottom edge as a full-size tile reaches, rather than at a fixed 74 %. That was the visible fault at 1920×704: a 342 px tile beginning 74 % of the way down a 704 px box, with 159 px of it sliced off by the bottom edge. Moving the start point rather than shrinking the tile matters, because a tile is a quarter of the section's width while the seven are spaced a seventh of the path apart — 19.3 % — so they overlap by about a quarter of a tile, and that overlap is what makes the field read as the logo's two stacked cards instead of a row of separate squares.

  The field is also one isolated stacking context now, at `z-index: 0`. The seven tiles' own z-indexes ran loose in the section's context next to the copy's `z-10` — ten beats seven on paper, but each tile is a composited layer of its own (`will-change` plus an animated `filter`), and a browser sorting those against text that is not composited is where tiles flickering over the "Getting started" button came from. Isolated, they sort among themselves and the field is a single layer beneath the copy, with no ordering left to get wrong.

  Verified by watching every tile for a full cycle at 1920, 1280 and 390, in Chromium and WebKit: no tile that is still solid is cut by any edge, tiles are always overlapping, and after a resize the painted transform matches the keyframes exactly in both axes.

- **Every heading on the homepage now writes itself in, and everything else fades in.** The hero and the closing section had the character-by-character reveal; Features, Pricing and Questions were static text that simply existed when you arrived at them. All three use it now, and so do the lines above them — the three blue ones and the hero's white one — they are part of the same phrase as the heading, so a fade under a character cascade read as two different ideas. The line leads and the heading follows a fifth of a second behind it. The note under the pricing cards fades in. 100 characters of headline across the page, none of them left unrevealed after a full scroll.

  `SplitText` had to stop forcing `display: inline` on itself to make that possible. It is what a `span` already is, and it quietly broke the component the moment it was asked to *be* the heading rather than sit inside one — an inline `h2` drops its vertical margins, so the space under every section title would have vanished.

  **In the hero, the screenshot starts with the headline instead of queueing behind it.** It waited 1.1s for its turn, which made the largest thing on the page the last to appear and read as a delay rather than a sequence. It now begins at 0.15s and takes 1.1s, so it still settles last — because it is the one that takes longest, not the one that starts latest. That needed a gentler curve as well as a longer one: `FadeIn`'s default is a hard expo-out that lands almost immediately and spends the remaining time easing the last few pixels, so raising the duration alone stretched the movement without slowing the fade. The curve is a prop now, defaulting to the old one.

- **An `xs` breakpoint at 25rem**, one step below `sm`. `sm` starts at 40rem and so already covers a 390px phone, which left anything meant for a small screen alone with nowhere to live. Being a breakpoint rather than a one-off media query it works both ways round: `xs:` from 400px up, `max-xs:` below it — the half that "only the smallest phones" usually means.

- **The hero shows a phone-shaped screenshot on a phone.** It was the 1440-wide capture at every size, and scaled into 390 px of viewport the cards became specks — a picture of a board nobody could read, in the place meant to show what the product looks like. The demo run now takes a second capture of the same board at 393×852, trimmed to 1:1.9 from the top — tall enough to read as a phone, without spending bytes on the stretch nobody scrolls to — and the hero picks between them at the `xs` breakpoint. Both carry their own dimensions, so the space is reserved before either loads even though the two ratios differ.

  It comes from the same pipeline as everything else rather than by hand: `scripts/demo/screenshots.mjs` grew a phone context and one view, `40-board-kanban-mobile`, and `run.sh` writes it out beside the desktop one. Neither can go stale while the other is refreshed.

- **The first feature tile broke on a narrow screen.** Its demo is three areas side by side, and below about 400 px a third of the tile is narrower than the "Create new card" button standing in it — which does not wrap, so it hung out of the tile by 10 px on a 390 px screen and 34 px on a 320 px one, taking the cards' due dates with it. Three changes, none of them a scrollbar: the fragments now size themselves from the tile they sit in (`clamp(0.55rem, 3.1cqw, 0.7rem)` against a container query, capped at exactly the size they were, so nothing moves on a desktop); the button says "Create card", since the plus already says "new"; and below `xs` the clock time goes while the date stays — "Aug 14, 10:41 PM" does not fit a third of a 390px screen, "Aug 14" does, and it is the half that says something.

  Measured across 320, 360, 393, 430, 640 and 1280 px in two engines: nothing inside the tile crosses its edge at any width.

- **The pricing section says something now.** Its blue line read "Our", above the word "Pricing" — grammar holding a slot open, telling a reader who had scrolled that far nothing they did not know. It answers the question people arrive with instead: **Free unless we run it for you**.

  The plan rows were rewritten to the same standard. "More of everything whenever you need it" sat directly under the line listing CPU, RAM and storage and said less than that line already had — and it read as though the extra came free. It now names what can be raised and that raising it costs more each month, in the same spirit as the restore fee under the cards: a charge belongs in front of the decision, not on the invoice after it. The two lists also run in the same order — where it runs, what it runs on, who updates it, who backs it up, where support comes from — so the eye can cross between them row by row. Both cards still measure the same height.

  In the FAQ, "a hosted option exists for **people** who would rather not run one" now says organisations, matching the note under the pricing cards; the answer also states plainly that a team of five and a team of five hundred run the same build.

- **Opening the small-screen menu shoved the page around.** Two separate faults, both visible on a documentation page. The header switched from `relative` to `fixed` while the menu was open, which takes it out of the flow, so the article underneath jumped up by the height the header had been occupying. It keeps its ordinary position now, and only the button that opens and closes the menu is pinned — at the exact offsets it rests at when closed, so it does not move at the moment it is pressed. Pinning the whole row instead put the logo over the scrolling list, with menu entries sliding behind it; the logo is simply out of sight while the sheet is open. And the scroll lock removed the scrollbar, taking fifteen pixels of page width with it — the whole page slid sideways. The lock is gone entirely — the menu stops Lenis rather than setting `overflow: hidden` — so the bar never leaves and there is no space to hold open for it. The page's own scrollbar is left exactly as the platform draws it; while the menu is open it is only painted transparent, because the menu is a scrolling panel with a bar of its own and two tracks side by side is one too many. Colour costs no space. The panel declares its own `scrollbar-color` to keep the bar it should have — the property is inherited, so the transparent pair on the root had been taking the menu's own scrollbar with it. It also spans a window's width rather than the page's and reserves a stable gutter of its own, so the bar sits at the right edge of the screen where a page scrollbar belongs — and the list, which fits until a submenu opens, does not reflow by a scrollbar's width the moment it starts scrolling. That reserved channel is also what keeps the entries in line with the close button above them, the panel being exactly one channel wider than the page.

  While looking at that: **smooth scrolling was never actually being stopped.** The code put `lenis-stopped` on the root element by hand, but that class is what Lenis *sets on itself* once stopped — not a switch that stops it. It calls `stop()` and `start()` now, and the menu panel is marked `data-lenis-prevent` so it scrolls on its own while the page behind it does not — which matters as soon as a submenu is open and the entries run past the bottom of the screen. The panel covers the whole viewport rather than starting below the header, and the header row goes transparent to the pointer while the menu is open (its logo and close button take their own back), so the wheel reaches the panel wherever it is on screen instead of dying on the strip across the top. The `overflow: hidden` lock is gone with it: it was only ever compensating for the thing that was not working.

  Measured on the documentation, the reference and the homepage: opening the menu moves the heading 0 px in either axis, and closing it returns everything to where it started.

- **The API section of the small-screen menu opened onto nothing.** The row expanded, the chevron turned, and the list underneath was empty. Its `section` said `"API"` while the navigation calls that section `"API reference"`, and that string is the key the pages are looked up by — so the lookup matched nothing and returned an empty list rather than failing. It lists all eleven reference pages now, and opens itself when you are already reading one.

- **The close mark was not a cross.** Its two bars each travelled `0.3rem` to meet in the middle, but they sit 8px apart — 2px of bar plus a 6px gap — so half that distance is `0.25rem`. The extra 0.8px on each carried them past one another, leaving a visible offset where the strokes should intersect. Measured after: the two bars' centres agree to 0.00px in both axes.

- **Opening the menu and then widening the window left the header wrong.** The sheet, the overlay and the burger are all `md:hidden`, so widening past `md` hid them — but the state behind them stayed open, and everything hanging off it stayed with it: the header pinned `fixed`, the scroll lock still on so the page could not be scrolled at all, and the homepage's white nav and burger rendered in their dark variant against the blue hero. That last one is why it looked like a header at the wrong breakpoint: what came back after a resize was the small-screen colouring at desktop width. Crossing the breakpoint now closes the menu, which is what the visitor sees happen anyway.

  Checked as a round trip on both header variants — open at 500 px, widen to 1200, narrow back, reopen, close with Escape: position, colours, the scroll lock and Lenis all return to where they started each time, and the page scrolls afterwards.

- **The legal pages use the documentation's sidebar.** They had a copy of it — a grey rounded panel, the shape the documentation had already moved away from — so the two halves of the site no longer matched. Both render one `SideNav` component now, which is why they will not drift again: the duplicate markup was the whole cause. The legal sidebar also follows the same breakpoint, hidden below `md`, where the footer's Legal column covers the same ground.

- **Every contact address is `info@lokalboards.com`.** The site, the withdrawal form and the security policy all pointed at a personal address; LokalBoards has its own now. Seven places: the header and footer "Contact" links, the pricing enquiry, the site notice (both the imprint and the DSA contact point), the privacy policy, and `SECURITY.md`. The author's own website is still linked from the footer and the about section — that credits him rather than invites mail.

- **A link to the site unfurls as a card now.** There was no `og:image` anywhere, so sharing lokalboards.com in Slack, on Mastodon or anywhere else produced a bare line of text. A 1200×630 card — the wordmark, the promise, the three badges and the board itself — is the site-wide default, while each page contributes its own `og:title` and `og:description` through a small `usePageMeta` helper. `useSeoMeta` does not derive the Open Graph pair from `title`/`description`, and a crawler falling back to `<title>` is luck rather than a contract, so both pairs are set explicitly.

  **`cloud.png` was 1.3 MB**, and the hero loads it twice. As WebP it is 148 KB — 89 % off the heaviest asset on the front page, with the transparency intact (checked pixel-for-pixel against the original, not assumed).

  **Links in the documentation were invisible.** Body links in the docs and the reference had no styling whatsoever — the same grey as the sentence around them, no underline — so every cross-reference on every page was findable only by dragging a cursor across the text. They are the primary colour and underlined now, in the article only: Nuxt Content wraps each heading in an anchor to itself, and a bare `a` rule turns the whole outline blue.

  **The last two documentation pages were rewritten.** *Health Check* and *Contributing* were the only ones still in the older voice, and *Contributing* had drifted: it described two test suites where there are four, and credited CI with a CodeQL scan it does not run. It now covers the unit, integration, end-to-end and browser suites, says which one a given change needs, and warns that `npm run test:browser` serves the built app on **port 3000** and will silently reuse a dev server it finds there — testing that instead of your build.

  **The site has an error page.** Now that a wrong address actually answers `404` rather than an empty article, the page behind it is something a visitor sees — and it was Nuxt's default: no header, no footer, the browser's own font, and "Page not found" printed twice. It carries the site's chrome now, and offers the homepage, the documentation and the reference rather than one link back.

  **Both sidebar menus read in order now.** The documentation opened on "Adjust Colors" and the reference put "Area" before "Areas", because both were sorted alphabetically; they run install → boards → areas → cards → comments and authentication → boards → … instead. The order lives in numeric filename prefixes, which the content layer strips from the paths, so no URL moved.

- **A rebuilt homepage for [lokalboards.com](https://lokalboards.com).** The old page was a stack of grey tiles under a stock laptop composite. It is now a sequence of sections that each do one job: the screenshot flanked by two drifting clouds, an about block whose text is revealed character by character as you scroll through it, the feature grid, pricing, the FAQ, and a closing call to action.

  Headings are set in **Inter Tight**, self-hosted alongside the Inter the site already served — no request leaves the visitor's browser for a font.

  **The page is white and the tiles on it are grey**, which is the relationship the app itself has between its surface and its panels — and it means a demo can bring the app's own white panels with it and have them land correctly. Every section now shares one container width and one vertical rhythm; they each used to set their own `max-w-2xl` / `max-w-4xl` / `max-w-5xl`, so nothing lined up down the page and the left edge moved as you scrolled.

  The motion is built on [`motion-v`](https://motion.dev/docs/vue), added as a Nuxt module. Two reusable pieces came out of it: `SplitText`, which masks a heading into characters or words and reveals them in sequence, and `FadeIn`, which fades a block in as it enters the viewport. Both observe their *container* rather than their pieces — a character that starts translated outside its own mask is never intersecting, so an observer on the pieces would wait forever.

  The clouds and the about text are scroll-driven rather than time-driven: the clouds rotate and sink as the page moves, and the about text scrubs its reveal against scroll position, so the animation is something the reader controls.

  **The feature tiles show the product rather than describing it.** Each of the eleven carries a piece of the actual interface, built from the same areas, cards, status circles, meta rows and buttons the app draws — not simplified stand-ins, and no grey bars standing in for text.

  Six of them move: a card dragged out of Backlog and dropped into In Progress — the areas opening and closing a slot for it as they do in the app — ticked off a beat after it lands, and only then filed in Done, with a blue cursor making the first hand-over and a green one the second; a board tile working through all twelve colour presets with the picker marking each one as it comes round; the *Create new card* button relabelling itself in all ten languages, the button easing to each new width as it goes; a checklist ticking itself off while the card's count keeps up, 1/3, 2/3, 3/3; the board switching between its column and list layouts; and the same area lit for light and dark. A seventh is the European flag, whose twelve stars turn once a minute and pulse one after another round the ring. The remaining four stand still — the invite dialog with the board's members and their roles, the `docker run` that installs the whole thing, an API request with the agent-marked card it created, and the Trello import — and they are interleaved with the moving ones rather than collected at the bottom.

  That last tile says what the licence alone did not: MIT, written in Germany, and running wherever you put it, with no American cloud standing between a team and its own data. Self-hosting is a question of digital independence before it is a question of price, and the flag says so faster than a paragraph can.

  Every tile's heading is one line and every tile's text is exactly four, which is what makes a row of them read as one object rather than three of different sizes — and each demo carries enough of the interface to fill the space above the words. Measured on the built page: the tiles in a row now come out at identical heights.

  The strings are real throughout: the ten button labels are the `createNewCard` values from the locale files, the board is the one in the demo screenshots, and the twelve colours are `BOARD_COLORS` verbatim.

  All of it is CSS keyframes on transform, opacity, colour and width — no scroll position, so a tile is never caught half-finished, and `prefers-reduced-motion` stops every one. The one exception is the language button, which has to measure its labels to animate between widths, because `width: auto` is not something CSS can transition between. Layouts are fixed rather than generated, so the server and the client render the same markup.

  **The demo screenshots were regenerated.** They still showed the green `secondary` that the app dropped in v0.24.0 — on every completed card, every ticked checkbox and the notification dot — so the site was illustrating a colour the product no longer has. `npm run demo:screenshots` re-captured all 21 views in both languages and refreshed the screenshot the README links to.

  **The homepage hero shows the board now, not one open card.** The two had been sharing a single image, and what suits the README suits the hero badly: the first thing anyone sees should be what LokalBoards looks like in use. The run therefore emits a second file, [`hero-screenshot.webp`](docs/public/images/hero-screenshot.webp), taken whole from the Kanban capture. Both are captured views, so neither can go stale; `HERO_SHOT_VIEW` changes which.

  **The demo board carries a real workload now** — 26 cards across its three areas instead of seven. It had only ever needed enough cards to demonstrate the features, which left two thirds of the page empty; that reads as sparseness in a screenshot the size of the hero. The extra cards fill the frame at the captured 16:10, so the hero needs no cropping to look like a board somebody actually works on.

  **Smooth scrolling and a wipe between pages.** Scrolling is [Lenis](https://lenis.darkroom.engineering/) in its root mode, wrapping the page in `SmoothScroll.vue`; the wheel now eases to a stop instead of jumping. Navigation sweeps a panel in the primary colour up over the outgoing page and off the top of the incoming one — one pseudo-element moved with `clip-path`, and `prefers-reduced-motion` skips it.

  Worth knowing because it is the thing that would have broken: the scroll-driven animations still work under Lenis. It drives the real window scroll rather than transforming a container, so the clouds and the character-by-character reveal below them read their positions exactly as before — checked on the built site, not assumed.

  **The legal pages share one component now**, so the next one costs a Markdown file, a line in a list and a three-line route rather than a design decision. They get the documentation's sidebar, a 68ch measure and more line-height than the docs need — legal text is read in long runs rather than scanned.

  **No right-of-withdrawal page.** One was built, carrying the statutory model form as fields rather than as a paragraph to print out. It is gone again: hosting is arranged by e-mail and invoiced through sevDesk, so there is no contract concluded on the website, and the Widerrufsbutton obligation that applies from 19 June 2026 attaches to sites where there is. It was also the last placeholder on the site — the page opened with a `PLACEHOLDER` comment where the Widerrufsbelehrung belongs, because that text has a prescribed structure and should not be invented here.

  The pricing block states the two options plainly: self-hosted for nothing at all, or hosted for 49 € a month. Both run the same open-source build; the paid option buys someone else running the server and applying the updates, not features withheld from the free one.

### Internal

- **The locale files line up again.** All ten now carry the same 322 keys in the same order, so a diff between two languages shows what actually differs. `privacyPolicyUrl` was dropped from the German file: it was in no other language and referenced nowhere in the code — the privacy link comes from `NUXT_PUBLIC_PRIVACY_URL` at runtime.

## v0.27.0

### New Features

- **The image now carries its own database.** `docker run` on a bare machine gives a working instance with nothing else to install — no MySQL to provision, no credentials to invent, no compose file required. The tables are created on first start as before.

  An external database is still supported and still the better choice for anything long-lived, and nothing about that path changes: set `NUXT_MYSQL_HOST` and the container skips its own MySQL entirely rather than running a second, unused one. A database in its own container can be backed up, upgraded and monitored on its own schedule; the built-in one exists so that trying LokalBoards costs one command.

  Two compose files ship with the repository — [`docker-compose.yml`](docker-compose.yml) for the bundled database and [`docker-compose.external-db.yml`](docker-compose.external-db.yml) for the app and MySQL side by side — replacing the example that previously only existed inline in the README.

  The password for the built-in database is generated on first start and kept beside the data it protects, so no default is shared between instances and nothing has to be chosen. The server binds to the container's loopback interface only; port 3306 is never published. Both processes run as the unprivileged `mysql` user, and `docker stop` shuts them down together so the next start does not begin with a crash recovery.

  **The cost is image size**: the runtime stage is built on `mysql:8.4` instead of `node:slim`, taking the download from about 83 MB to roughly 285 MB, and every deployment pays it — including those using an external database. Publishing two images instead would double the release surface and force a choice on readers before they know what they want.

  One behaviour change worth checking if it applies to you: `NUXT_MYSQL_HOST` set to `localhost`, `127.0.0.1` or `::1` now selects the *built-in* database. An instance running with `network_mode: host` and pointing at a MySQL on the host that way would silently start using the container's own database instead. Any other hostname, including a compose service name, is unaffected.

  Verified end to end on a built image: a container started with no database configuration at all initialised its data directory, applied all 15 migrations, created 20 tables and answered `/api/health` with `{"status":"ok","database":"ok"}`; data survived a restart with the password reused rather than regenerated; `docker stop` shut down cleanly with no crash recovery on the next start; and a container pointed at an external database ran no `mysqld` of its own and migrated the external schema instead.

### Internal

- **The publish workflow declares its token permissions.** `docker-publish.yml` had no `permissions:` block, so it inherited the repository default for `GITHUB_TOKEN` — read-write on repositories created before February 2023 — which CodeQL flagged as `actions/missing-workflow-permissions`. It now declares `contents: read`, matching `ci.yml`, which has always had one.

  Nothing in the job needed more: Docker Hub is authenticated with its own secrets rather than `GITHUB_TOKEN`, and the layer cache uses the Actions runtime token. The omission came from the workflow being adapted from another project whose copy has the same gap.

## v0.26.0

### New Features

- **Three more languages: Ukrainian, Portuguese and Czech.** That takes the interface from seven to ten. All 319 interface strings and all 16 e-mail strings are translated in each — no partial locales, and no English falling through mid-sentence.

  Chosen for reach rather than for count. Portuguese is the largest single addition by far once Brazil is counted, and Brazil has one of the biggest self-hosting communities anywhere. Ukrainian covers around 35 million speakers with an active developer community and an unusually concrete interest in keeping data on their own hardware. Czech is the smallest of the three by population and the strongest by self-hosting culture. Russian is deliberately not included.

  Each language matches `en.json` key for key and in the same order, and every `{placeholder}` survives translation intact — both checked mechanically rather than by eye, since a missing placeholder shows up as a literal `{cardName}` in someone's inbox. Native punctuation throughout: `«»` for Ukrainian, `„“` for Czech, `“”` for Portuguese, following what the existing locales already do. Dates format as `uk-UA`, `pt-BR` and `cs-CZ`.

  Verified by running the app in each language: the dashboard, the header and the search placeholder all render correctly, with no console errors.

  A note for whoever reviews these: they are careful translations, not reviewed by native speakers. The interface strings are short and mechanical, but the longer explanatory ones — the webhook and API-key hints especially — would benefit from a native eye. Corrections are a small pull request, and `CONTRIBUTING.md` now has a Translations section spelling out the five places a language lives and the two rules that matter — identical key sets, and placeholders left intact.

### Internal

- **The README no longer explains how to build and publish Docker images.** It carried a section on `docker buildx ... --push florianstrasser/lokalboards` — instructions nobody but the maintainer can run, in a document people read to *use* the project. Now that CI publishes on a tag, they were wrong as well as misplaced.

  Deleted rather than trimmed: anyone building their own image is a contributor, and contributors read `CONTRIBUTING.md`. The one part worth keeping — that building on an Apple Silicon Mac and deploying to an `amd64` server gives `exec ... : Exec format error`, and why the Dockerfile pins its build stage — moved there, next to the other build instructions. The README now stops at pulling and running the published image, which is what a reader of it wants.

- **Releases publish the Docker image themselves.** Pushing a `v*` tag now triggers `docker-publish.yml`, which builds and pushes to `florianstrasser/lokalboards` — replacing a `docker buildx build --push` run by hand.

  Three things change beyond saving the manual step. The image is built for **linux/arm64 as well as amd64**, so `docker run` stops failing outright on Apple Silicon and ARM servers with `no matching manifest`; every hand-published image so far was amd64 only. Each release gets the full tag ladder — `0.26.0`, `0.26`, `0` and `latest` — so an operator can pin `:0` and take fixes without a surprise upgrade. And the build is cached across runs through GitHub's cache backend.

  Publishing is deliberately tied to the tag rather than to every push to master: `latest` moving on each commit would hand people whatever happened to be in the tree. `workflow_dispatch` is there to re-run a publish whose failure had nothing to do with the code.

  Cutting a release is now `npm version <patch|minor|major> && git push --follow-tags`. A new `.npmrc` sets `message=v%s` so the commit `npm version` creates keeps this project's naming (`v0.26.0`, matching its tag) instead of npm's bare `0.26.0`. `package.json` and the lockfile are bumped together, which is what had been drifting — and the MCP handshake and the README badges both read from `package.json`, so they follow on their own.

## v0.25.2

### Security

- **`nanoid` in the documentation site's lockfile, 3.3.17 → 3.3.18** (high, GHSA-2v37-7h3g-55p8). A custom generator called with a size of zero never satisfies its loop's exit condition and spins forever, hanging the calling thread — a denial of service where the size is attacker-controlled. It arrives through PostCSS, which the docs build uses.

  Not something that was missed earlier: the app's copy was raised to 3.3.18 back in v0.22.3, when the advisory covered `<3.3.17` and the documentation site's 3.3.17 was outside it. The range has since been widened to `<3.3.18`, which brought that copy into scope.

  Both lockfiles now report zero known vulnerabilities, the documentation site builds, and all 135 tests pass.

## v0.25.1

### Fixes

- **The MCP server told agents it was version 0.23.0.** The version an MCP client sees in the handshake was a second copy of the number, written out in `nuxt.config.ts`, and releases stopped touching it — so it sat two versions behind while the project shipped 0.24.0 and 0.25.0. It now derives from `package.json`, leaving one place where the version lives.

  Worth knowing for release day: `package.json` and the lockfile are still the source of that number, and nothing updates them automatically. `npm version <x> --no-git-tag-version` sets both in one step; the README's version badge and the MCP handshake then follow from it.

- **The README's Nuxt badge was three releases behind.** It read 4.4.6 while the project has been on 4.5.2 since v0.22.1, when Nuxt was upgraded to clear eleven advisories — so the one badge a visitor uses to judge whether a self-hosted project is maintained was understating it, and pointing at a version with known CVEs. Corrected to 4.5.2, which is what both `package.json` and the lockfile resolve to.

  Both dependency badges are now read from `package.json` by Shields.io rather than typed by hand, so they follow an upgrade on their own and cannot drift again. The Socket.IO badge was accurate, and both endpoints were checked to resolve before the swap.

- **The documentation site's favicon was still the old green.** The app generates its icons at request time from the configured primary colour, so it followed the palette change on its own; the documentation site ships a static `touchicon.png`, and that file was still the dark green (`#104332`) of the palette the site used before it adopted the app's. Regenerated with the app's own renderer at `#0066cc`, so both sites now serve the same artwork in the same colour — verified against the served file, not just the one on disk.

## v0.25.0

### Improvements

- **Inter, self-hosted, in the app and the documentation site.** Both ran on whatever sans-serif the visitor's operating system happened to supply, so the product looked different on every platform. They now share one typeface. The files are committed rather than fetched: an instance is meant to run on your own server without leaking a request per visitor to a font CDN, and a build that reaches out for fonts is a build that fails when the network hiccups. Verified on a running instance — zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`, and the browser reports Inter as the resolved family.

  Two variable files per site cover the whole weight range, 100–900, so no weight costs an extra download. The `latin-ext` subset is not optional: Polish (ł ą ę ż ź ć ń ś) lives there and the UI ships in Polish — checked by running the app in Polish and confirming both faces load. Inter is under the SIL Open Font License 1.1, and the licence travels with the files in `public/fonts/`.

- **The documentation site uses the app's colours.** It had a palette of its own — a dark green with an orange accent — which made the product and the site documenting it look like two different things. It now takes the app's tokens verbatim, and the `secondary` colour it used for calls to action and nav hovers is gone the same way it went from the app, replaced by `primary` with `primary-hover` for the hover state that used to be a change of hue. Only the light values are taken: the site has no dark mode, and half of one would be worse than none.

  Headings moved to the dark token rather than following `primary`. The old primary was a near-black green, so a heading set in it read as dark text with a tint; the app's primary is a saturated blue, and the app reserves it for actions. Carrying the old rule across would have turned every heading into a shout.

- **The documentation homepage shows the app instead of a laptop.** The hero was a stock photo of a laptop with a screen composited into it — it aged the moment the UI changed, and it showed a desk rather than the product. It now uses the same capture the README does, produced by `npm run demo:screenshots` from the running app, so it is refreshed on every demo run and cannot go stale. Shown whole rather than cropped, so no part of the board is sliced off at narrow widths. The laptop composite is deleted.

### Fixes

- **Code examples in the documentation had their indentation stripped.** Three separate things were wrong with the code-block styling, and the nesting was the worst of them: `white-space: pre-line` preserves newlines but collapses every run of spaces, so a JSON response or a `docker-compose` file rendered flush left with all its structure gone — exactly the part of an example a reader needs. It also carried `text-align: justify`, which stretched the spaces *inside* code to reach both margins, and a white background on a white content box, so the block had no edge at all.

  The block now uses the same rules as the app: the shared code background, text and border tokens — which also arrived with the palette — a monospace stack, and `white-space: pre-wrap`, which keeps the indentation while still wrapping a long `docker run` line rather than forcing a horizontal scrollbar. Verified in the rendered page: the JSON example comes back with its two- and four-space levels intact.

  Inline code in prose was styled not at all — `api/data/board` in a sentence was monospace text and nothing else. It now gets the same small chip the app uses.

- **The address blocks on the site notice and privacy policy run onto separate lines again.** The postal address, the phone/e-mail pairs and the VAT number were each written one item per line in the Markdown, but a single newline inside a paragraph is a *soft* break in CommonMark — it renders as a space. So the four-line address collapsed into one run of text, and so did the contact pairs.

  Ten lines across the two files gained a CommonMark hard break (a trailing `\\`): six on the site notice — the address, `Phone`/`E-mail` under Contact, the VAT number, and the DSA contact pair — and four on the privacy policy, for the controller's address and its phone/e-mail pair. Verified in the rendered DOM: six `<br>` elements on one page and four on the other, all inside the right blocks.

  Fixed in the content rather than by turning on the parser's `breaks: true`, which is shared with the `docs` and `api` collections — there, any paragraph wrapped across several source lines would suddenly gain hard breaks inside it. The trailing backslash is also visible in the source, unlike the two-trailing-spaces form that editors and linters strip on save.

## v0.24.0

### Breaking

- **The secondary colour is gone.** The palette had a green accent alongside the blue, meant to mark "done and positive" — completed cards, ticked checkboxes, live indicators, unread dots, the "+N" avatar overflow. It earned that second hue nowhere: every place it appeared already said what it meant by other means — a tick, a filled circle, a count reaching its total — so the colour added a competing accent without adding information. All of it uses the primary colour now, and the UI reads as one palette instead of two again.

  `NUXT_PUBLIC_COLOR_SECONDARY` and `NUXT_PUBLIC_COLOR_SECONDARY_DARK` no longer exist. An instance that sets them keeps running; the values are simply ignored, and the documentation says so.

  Two deliberate exceptions. The board colour picker marks its chosen swatch with a neutral ring in the page's own foreground rather than the primary colour — the primary colour is itself one of the swatches, so a primary ring would disappear on exactly the swatch it needs to mark. And rich-text link hovers take `primary-hover`, keeping a visible change of state without a second hue.

### Improvements

- **Input fields are a neutral grey instead of faintly blue.** Every text input, textarea, select and the rich-text editor mixed its resting fill and border from the brand colour, which tinted every form in the app. They now mix from `--color-gray` — the same formula and the same weights, just a neutral base — so a field reads as a place to type rather than as something being pointed at. The brand colour still appears on `:focus`, where it marks the field you are in. The dark theme already mixed from white and is unchanged.

### Fixes

- **The image viewer's close button now fades in with the picture.** Opening an image zooms it up from the thumbnail and fades the backdrop in behind it, but the close button appeared instantly, fully formed, before the picture had finished moving. It sits outside the element that animates — unlike the card dialog's close button, which rides along inside its card — so it had nothing to animate it. It now fades and scales in on the backdrop's own signal, using the image's easing and duration, so the three arrive as one movement, and it fades back out on the way down instead of vanishing.

- **The demo attachment no longer says "LocalBoards".** The seeded image had the old name drawn into the picture itself, so the rename's text pass could not reach it and every generated screenshot still carried it. Regenerated at the same 640×400 with the same gradient and, apart from the one word, the same type set in the same place — the heading lands on exactly the rows and columns it did before.

- **An image opened from a card is no longer hidden behind that card.** The viewer and the card dialog both sat at the same stacking level, and Vue places the viewer's teleported markup *ahead* of the app root in the document — so the tie broke the wrong way and the card was drawn over the picture, leaving only the strips either side of the dialog visible. The viewer now sits one level above, which is what it always meant: it is opened from something and belongs on top of it. Closing by button, by backdrop and by Escape all still work and still leave the card open underneath.

## v0.23.0

### Breaking

- **LocalBoards is now LokalBoards.** "Local boards" is a phrase the dictionary already owns — it competes in search with local government boards, local message boards and local bulletin boards, and a purely descriptive name is close to unregistrable as a trademark. `LokalBoards` is a near-unique string, it nods to where the project comes from, and it sets the naming convention for the projects that follow. Better now, at two stars, than after the name has spread.

  **Nothing about a running instance changes.** The app reads its display name from `NUXT_APP_NAME`, and the database, volume and image names in the documentation are only *suggested* values — no instance takes them from this repository. An existing deployment keeps working untouched; renaming anything is optional and entirely up to the operator.

  What did move: the canonical site is now **lokalboards.com** (the old domain redirects), the repository is `florian-strasser/LokalBoards` — GitHub keeps the stars, issues and pull requests and permanently redirects the old URL, including existing git remotes — and the published image is **`florianstrasser/lokalboards`** — the maintainer's own namespace, shared with the projects that follow, rather than one named after a single app. The old image path is no longer updated, so a `docker pull localboards/localboards` needs changing to keep receiving releases; pinned deployments keep running on whatever tag they already have.

  Entries below this one are left as they were written. They describe releases that shipped under the old name, and rewriting them would misreport what happened.

### New Features

- **A board tile can wear a colour instead of a picture.** The board settings gained a **Colour** row beside the thumbnail: twelve presets covering the hue circle, plus a pipette that opens the system colour picker for anything else. The first swatch is the default and leaves the tile in the app's own colour, which is what every existing board keeps — nothing changes until you pick something.

  A picture covers the whole tile, so a colour behind one could never be seen. Rather than let the two quietly fight, they are one choice: picking a colour clears the image and picking an image clears the colour, so the dialog always shows what the tile will actually look like.

  **Any colour stays readable.** The tile works out whether white or near-black gives better contrast against what you picked — by measuring the actual contrast ratio, not by thresholding brightness, which is the difference between getting `#00ff00` and `#0000ff` right and getting them backwards — and the name plate, the "shared" badge, the unread dot and the avatar rings all follow it. On a dark board that is the familiar white plate with the board's colour as its text; on a pale yellow the plate flips to dark with yellow text, instead of turning into white-on-white. The twelve presets are all chosen to clear 4.5:1 against white, with a unit test that fails if a future edit sneaks a brighter shade into the palette. Hovering shades the colour the same direction the primary colour shades — darker on the light theme, lighter on the dark one — so a coloured tile behaves like every other one.

  The colour is a new nullable `color` column, added by a migration that existing installations pick up on their next start; boards that predate it simply read as "no colour". It is validated in one shared place used by the picker, the tile and the API, so a value can never be accepted by one and refused by another — which matters here, because the colour ends up in a CSS custom property and only `#rrggbb` may ever reach the stylesheet. Available over the REST API and through the `createBoard`/`updateBoard` MCP tools, which now also report a board's `image` and `color` back rather than only accepting them. Translated into all seven languages.

### Fixes

- **Attachments that can't be displayed now simply download.** Clicking a spreadsheet, a Word file or a zip asked for permission to open a popup first, and only downloaded the file once that was allowed — in Safari a dialog stood between the click and the file every time. The click fetched the attachment and *then* called `window.open`, by which point the browser no longer connected the new window to the click that caused it and treated it as a popup. A download link is now built and followed straight away, with nothing awaited in between, so there is no popup to allow and no tab that flashes open and closes. Verified in both Chromium and WebKit: the file arrives, no extra tab is opened, and the page underneath doesn't move.

  Only images and PDFs can actually be shown in a browser, and both keep their behaviour — an image opens in the lightbox, a PDF in a new tab. Everything else was already meant to download; it just took a detour to get there.

  Two things improve along the way. The download now carries the attachment's **original filename**, so a spreadsheet saves as `Quartalszahlen Q3.xlsx` instead of the 32-character storage name the file has on disk — including names with umlauts or other non-ASCII characters, which are sent in both the plain and the RFC 5987 form of the header. And the file is streamed from the server instead of being pulled through the browser's memory as a base64 `data:` URL, which for a large attachment meant holding several copies of it at once.

## v0.22.3

### Security

- **Cleared five advisories across both lockfiles.** Dependabot flagged three, `npm audit` surfaced two more; both projects now report zero known vulnerabilities.
  - `dompurify` — an XSS where a hook that removes an element during `IN_PLACE` sanitisation leaves the removed element's descendants attached and executable, so a nested `<img onload=…>` fires after `sanitize()` has returned (GHSA, moderate). It reaches us through `isomorphic-dompurify`, which is what sanitises card descriptions, comments and notification messages before they are rendered with `v-html`. Our own use is not the vulnerable shape — `sanitizeHtml` calls `sanitize()` with an allowlist, not `IN_PLACE`, and registers no hooks — but the package is on the one path that stands between a collaborator's stored Markdown and another user's browser, so it is pinned to the fixed 3.4.13 rather than argued around.
  - `js-yaml` → 4.3.1 and `nanoid` → 3.3.18, both high-severity denial of service (quadratic CPU consumption resolving `!!omap`; a custom generator looping forever when size is zero). Both are build-tool transitives — `js-yaml` via the JSON-schema ref parser, `nanoid` via PostCSS — and neither had an alert open yet; they were taken along because they had fixes waiting.
  - `image-size` — two high-severity infinite loops in the ICNS and JXL/HEIF parsers, reported twice against the documentation site. **There is no patched release**: every published version is affected, upstream has shipped nothing, and the package sits three levels down under `@nuxtjs/seo` → `nuxt-seo-utils`. It turned out that module was never registered in the docs `nuxt.config.ts` in the first place — Nuxt does not load modules just because they are in `package.json` — so nothing it provides was ever running: the live site has no sitemap and emits no `og:` tags, and its `robots.txt` is the static file in `public/`. The dependency has been removed, which takes the advisory with it and drops 50 packages from the docs tree. The inert `site:` block in the config is left in place for whenever the module is actually wired up; a sitemap can be had from `@nuxtjs/sitemap` alone, which does not pull `image-size` in.

  Verified past the audit report: the app builds, all 126 tests pass, and the documentation site builds without the removed module.

### New Features

- **The documentation site now has a sitemap.** `@nuxtjs/sitemap` replaces the `@nuxtjs/seo` bundle that was removed above — it is the one piece of that bundle the site actually wanted, and it brings no `image-size`, so the advisory does not come back. It is registered in `modules` this time, which is what the old dependency never was.

  Page scanning finds the static routes, but the documentation and API pages are all served by a single dynamic route each (`app/pages/docs/[slug].vue`), so their URLs only exist as Markdown files. A small Nitro route reads them back out of the content database and hands them to the module as a source; the legal pages are left to page scanning, because their content paths (`/legal/privacy-policy`) are not the routes they are served at. The result is 26 URLs — the landing page, both section indexes, eleven documentation pages, ten API pages and the two legal pages — and every one of them was requested against the built server and returns 200 with its content rendered.

  Two things were wrong in the site config and are fixed: the canonical URL said `www.localboards.de`, which 301-redirects to the apex host, so every entry would have pointed at a redirect; and the sitemap now honours the trailing slash the live site canonicalises to, so the listed URLs are the ones actually served rather than another redirect hop. `public/robots.txt` points crawlers at the sitemap.

### Fixes

- **The documentation site's `NUXT_APP_NAME` did nothing.** Its `nuxt.config.ts` declared `app.head` twice; in an object literal the second key wins outright, so the first block — the one that read the app name from the environment — was silently discarded, along with the environment-driven `<html lang>` that the second block happened to repeat. The two are now one block, and the app name additionally feeds the `%s | …` title suffix instead of being hard-coded there. Setting `NUXT_APP_NAME` at build time now really does rename the site, in the page titles and the suffix behind them.

  The merge itself is deliberately behaviour-neutral: with no environment variables set, the rendered `<head>` and `<html>` tags of the landing page, a section index, a documentation page and a legal page are byte-identical to what the old config produced. The duplicated `charset`/`viewport` entries were dropped from the `meta` array because the dedicated `charset`/`viewport` keys in the same block already emit them — verified in the output, which contains exactly one of each, before and after.

## v0.22.2

### Fixes

- **A comment found by search now takes you to the comment, not just its card.** The result linked to `?card=…`, so on a card with a long thread you landed at the top and had to hunt for the line you had just searched for. Comment results now link to `?card=…&comment=…`: the card opens, the comment scrolls into the middle of the view and its border is marked in the primary colour for a few seconds, then settles back. It works on a cold deep link as well as from the open app, waits for the authoritative comment list (the comment may not be in the board's prefetched copy at all), and the parameter is dropped from the URL when the card is closed, so a reload doesn't jump again. An unknown or stale comment id simply opens the card as normal.

## v0.22.1

### Security

- **Updated Nuxt to 4.5.2, clearing eleven advisories.** They landed together against 4.5.0 and cover the framework's server-side rendering and routing: a **critical** unauthenticated DevTools RPC allowing arbitrary command execution on a developer's machine, server-side remote code execution through runtime template injection in server island props, a runtime payload cache that could disclose one user's SSR data to another user (or to unauthenticated clients), route rules silently dropped for mixed-case paths — which bypassed `appMiddleware` auth gates, an incomplete fix for CVE-2026-53721 — an unauthenticated out-of-memory crash via unbounded `v-for` expansion in island rendering, and unauthorised component instantiation via server island props.

  The same advisories applied to the documentation site, which was still on 4.4.8; it is now on 4.5.2 as well. Its lockfile had to be re-resolved from scratch, because the pinned `rolldown` blocked the upgrade as a peer conflict — the security `overrides` from earlier releases (`brace-expansion`, `postcss`, `sharp`, `minimatch`) were checked afterwards and all still hold. Both lockfiles report zero known vulnerabilities.

  Verified past the audit report: the app builds, all 126 tests pass, and a running instance serves the dashboard, a board, a deep-linked card, the health endpoint and the search API — with the card modal, the search panel and navigation exercised in a browser with no console errors, since these advisories are in exactly those rendering paths.

## v0.22.0

### New Features

- **Search across everything you can see.** A search field sits in the header between the logo and the nav — same height as the nav beside it, with a border in its own background colour that turns primary on focus, like the card description and comment editors — type in it and results drop down underneath as you go, grouped into boards, cards, comments and attachments. On a phone, where there isn't room beside the nav, the field wraps onto its own full-width line, and the placeholder — a full sentence naming what gets searched — fades out at the right edge instead of being chopped off mid-word. The fade is applied only when the text genuinely doesn't fit (measured against the field, so it appears and disappears as the window is resized) and only while the placeholder is showing, so neither a placeholder that fits nor a typed query is ever dimmed. It doesn't only match names — a card is found by the text of its **description**, by any **comment** on it, or by the **filename of an attachment**, so "where did we discuss that?" is one search rather than a hunt through boards. Each hit shows where it lives (board · area, or comment author · card · board), a snippet of the surrounding text when the match is buried in a description or comment, and the matched term highlighted. Each result is drawn as the thing it found, using the app's own components' styling: a board hit is the same grey box a card uses, with the board's name and the avatars of everyone on it, a card hit is a card tile — status circle, checklist progress (green when complete), comment and attachment counts, the due date (emphasised when it has passed) and the assignee's avatar, from the same parser and formatting the board uses — a comment hit is a comment bubble with the author's avatar and name underneath, the bubble's border lighting up on hover rather than a slab of colour behind the row, and an attachment hit is the file row from the card. Results are recognisable at a glance instead of being one more line of text in a list. Snippets read as prose rather than as Markdown source: link and image labels survive, task items keep their state as ☑/☐, and headings, bullets, quotes and emphasis markers are dropped — a snippet is a fragment cut from the middle of a document, so its block structure is usually broken anyway. Clicking a result opens the board — or the card itself, straight into its modal. The panel closes when you click away or pick a result, and comes back when you return to the field; Escape clears the field, as it does in any search box.

  Results are strictly scoped to what the caller can already open: every query carries the same "owned by me or shared with me" condition, and being an admin grants nothing extra, matching how board access works everywhere else. Typing is debounced into a single request and responses are sequenced, so a slow earlier reply can't overwrite a newer one; searches shorter than two characters never reach the database; and `%` and `_` are escaped so they're searched for literally instead of matching everything. Translated into all seven languages.

- **Checklist progress on the board.** A card whose description contains a task list now shows how far it has got — `0/3`, `2/5` — next to the comment and attachment counts on its tile, so a board can be scanned without opening anything. The counter turns into the secondary color once every item is ticked.

  It updates live for everyone: ticking a box in the card, editing the description, or adding and removing items all move the number immediately, in every open browser, without a reload. That comes for free from where the number is derived — the card's stored Markdown, which the board already loads and which every one of those paths already keeps in sync. Nothing extra is stored, no new column, no extra request. Cards without a checklist look exactly as before. The parser handles the different bullet markers, ordered items, nesting and uppercase `[X]`, and ignores task-list syntax inside fenced code blocks; it's covered by unit tests.

### Internal

- The demo capture gained a **search** view (`30-search`), so the gallery and the README show the feature rather than just the empty field, and one seeded comment now mentions the logo so a single search demonstrates hits across cards, comments and attachments at once.

## v0.21.5

### Security

- **Cleared eleven advisories in transitive dependencies.** Dependabot flagged seven and `npm audit` surfaced four more once those were resolved; all are pinned to fixed releases through `overrides`, and both lockfiles now report zero known vulnerabilities.
  - `undici` — five advisories (one high): cross-user information disclosure and a parse-time crash via degenerate private cache directives, response desynchronisation via the retry interceptor, CRLF injection through a blob-like body `type`, cache-key confusion from whitespace around `=` in `Cache-Control`, and cookie-attribute injection. Two copies exist in the tree, Nuxt's 8.x and the MCP toolkit's 7.x, and **both lines were affected** — pinned to 8.10.0 and 7.29.0 respectively rather than collapsing them onto one major.
  - `ip-address` — two SSRF/trust-boundary bypasses (IPv4-mapped/NAT64 misclassification, and a CIDR suffix suppressing special-use classification), via the MCP toolkit → 10.4.0. Worth noting these do **not** weaken LocalBoards' own webhook SSRF guard, which classifies addresses itself in `server/utils/webhookTarget.ts` and never used this package.
  - `brace-expansion` — a second DoS advisory (GHSA-rgw5-rvv9-x895) that bypasses the mitigation shipped in v0.21.1 → 5.0.9, in the app and the docs site.
  - `fast-uri` (host confusion via a backslash authority introducer), `hono` (ReDoS in the CORS middleware) and `postcss` (arbitrary `.map` read when `from` is unset, an incomplete fix of the earlier advisory) → 3.1.5, 4.13.0 and 8.5.25.

  Verified beyond the audit report: the app builds, all tests pass, and a running instance still serves the dashboard, boards, the deep-linked card, the health endpoint and an MCP `initialize` handshake — the last one matters because `hono` and `ip-address` are the MCP transport's own dependencies.

### Fixes

- **Ticking a card off now shows up in its timeline straight away.** Marking a card done (or reopening it, setting a due date, assigning it) records an activity entry on the server, but the open card's "Comments and activity" list only read that list when the card was opened — so the new line appeared only after closing and reopening the card. The timeline now re-reads the activity whenever the card is saved, and also when the change arrives from someone else over the socket, so a card left open picks up a colleague's changes too.

## v0.21.4

### Improvements

- **Every e-mail now looks like the notification e-mail.** The welcome mails (self sign-up and admin-created), the password-reset link, the board invitation and the account-deletion notice were all bare `<p>` tags with a raw URL pasted in — while the notification digest had a proper layout. They now share one shell (`server/utils/emailLayout.ts`): the same font stack, spacing and 600px measure, with the action as a real button and the raw link kept underneath in small print for clients that strip it or for copying by hand. The button label is translated per action ("Sign in", "Open board", "Set a new password") in all seven languages. Like the notification mail, they set no page background or text colour, so they read correctly in both light and dark mail clients. The notification digest now draws its shell and button from the same place instead of its own copy. Verified by sending all six through a local SMTP server and rendering what actually arrived.

### Fixes

- **The header's notification bell now stops glowing as soon as everything is read.** Opening a card marks its notifications read on the server, and opening a board does the same for its board-level ones — but the bell kept a private copy of the list and never heard about it, so its unread dot stayed lit until the page was reloaded. The bell's notifications now live in shared state that the board page refreshes right after the server confirms the change. The dot follows the real count rather than switching off on the first read: with three unread items it stays lit through the first two cards and only goes out once the last one is read.

## v0.21.3

### Fixes

- **Dates now render in the instance's timezone and language, which also fixes a hydration mismatch.** Every displayed date was formatted with `toLocaleString(undefined, …)`, which resolves to the *renderer's* locale and timezone — the Node process on the server (en-US/UTC inside the Docker image) and the browser on the client. The same instant therefore produced different text on each side, and Vue reported "Hydration completed but contains mismatches". It was most visible when opening a board straight to a card (`?card=`), which server-renders the card with all its comment and activity timestamps, but any board with a due date on a tile hit it too.

  Dates are now pinned to the server's timezone (`TZ`) and the configured `NUXT_LANGUAGE`, carried to the browser the same way the UI language already is. Both sides produce identical text, so dates render during SSR like everything else — no placeholder, nothing appearing after hydration — and everyone working on a board reads the same wall clock instead of each browser showing its own. Verified with a server in UTC and browsers in Berlin, New York and Tokyo: all four see `03.08.2026, 10:24`, with no mismatch across 16 page loads; switching the server to `TZ=Europe/Berlin` moves every viewer to `12:24`, and `NUXT_LANGUAGE=en` reformats it to `08/03/2026, 12:24 PM`.
- **A card opened after someone else commented showed the old comments.** The board prefetches every card's comments when it loads, so the modal can open without a round trip — but another user's comment reaches your browser only as a *count* over the socket, never the content. The tile's badge went from 1 to 2 while the prefetched list stayed at 1, and opening the card rendered that stale list; only a full page reload reconciled them. The comment section now re-fetches the card's comments when it opens: the prefetch still renders instantly and the authoritative list replaces it a moment later, and it's handed back up so the board's cached card and the tile's badge follow. Only an actual difference triggers an update, so reopening an unchanged card is still a no-op. While a card is open, live updates were already covered by its own socket room.

## v0.21.2

### Fixes

- **The dashboard's drag handle no longer covers the unread-notification dot.** Both sat in the top-left corner of a board tile, so on a board with unread activity the handle appeared on hover directly on top of the pulsing dot. The tile's status row is now right-aligned, leaving the top-left corner to the handle alone — and the Kanban/to-do icon that used to sit there is gone: three markers in one corner read as clutter, and a board's layout is obvious the moment you open it. What's left is what carries information: the unread dot and the "Shared" badge.

### Internal

- **The README screenshot now comes from the automated demo capture.** It was a hand-made composite from an older release — green theme, German UI, a card modal that no longer looks like that — and nothing kept it in sync with the app. `npm run demo:screenshots` now also writes `docs/public/images/readme-screenshot.webp` from the run's card-modal capture (the view that fills the frame and shows description, checklist, attachments and the comment/activity timeline), so every capture run refreshes it. Override the source view with `README_SHOT_VIEW` or the destination with `README_SHOT`.
- **Removed two unused font files.** `public/fonts/host-grotesk-{300,regular}.woff2` had been in the repository since the initial commit, were referenced by no stylesheet or component, and were still copied into the build output and the Docker image. Host Grotesk is licensed SIL OFL 1.1, which requires the licence to accompany the font files wherever they're distributed — deleting them removes both the dead weight and the obligation. Everything renders from the system font stack as it already did.

## v0.21.1

### Security

- **Cleared the new high-severity `brace-expansion` advisory (GHSA-mh99-v99m-4gvg / DoS via unbounded expansion length).** `expand()` caps the *number* of results it produces but not their total *length*, so chained brace groups can exhaust memory and crash the process. The fix is `5.0.8`, and it exists **only** on the 5.x line — the 2.x line's newest release (`2.1.2`) is still affected with no backport. Simply forcing `5.0.8` everywhere breaks the old consumers: 5.x's CommonJS entry exports `{ expand }` instead of a callable module, so `minimatch@5`/`@9` fail with `expand is not a function` (verified, not assumed). The 2.x requirement was pinned by those old `minimatch` copies inside Nitro's `archiver` chain, so they're lifted to `minimatch@^10.2.5`, which takes the fixed `brace-expansion` line — leaving exactly one copy of each in the tree. Upgrading `archiver` itself to 8.0.0 was tried first and rejected: it's ESM-only without a default export, which breaks Nitro's `import archiver from "archiver"`. Verified by round-tripping a real zip through both affected code paths (`.directory()` → `readdir-glob`, `.glob()` → `glob`).

- **Cleared four vulnerabilities in the documentation site's dependencies (`docs/`)**: `postcss` (path traversal via source-map auto-loading, GHSA — fixed in 8.5.18), `valibot` (`flatten()` throwing on inherited object property names, fixed in 1.4.2), the same `brace-expansion` DoS, and `sharp` (inherited libvips CVEs below 0.35.0). The docs site is a separate project that isn't part of the deployed app, but the tree is clean again and the docs still build. Both lockfiles now report zero known vulnerabilities.

## v0.21.0

### New Features

- **Arrange your dashboard: sort boards and group them.** The dashboard is now one space you organise yourself. Drag boards into any order, create named groups (e.g. "Work", "Clients", "Personal") and drag boards into them, reorder and collapse groups, and rename or delete a group at any time (deleting a group keeps its boards — they drop back to ungrouped). The old fixed "Your boards / Shared boards" split is gone: owned and shared boards live together and a small **Shared** badge marks the ones you don't own, so a single group can mix both.

  The arrangement is **entirely your own**. It's stored per user against each board, never on the board itself, so two people who both have access to the same shared board can sort and group it completely differently — one person's layout never affects anyone else's. New and newly-shared boards appear ungrouped at the top until you file them. Leaving a board, or a board being deleted, quietly removes it from your arrangement.
- **Cards now keep their own history.** Until now a change to a card only existed as a notification or an e-mail — transient, per-recipient, and gone once read. Card changes are now recorded permanently on the card and shown in the "Comments and activity" section, interleaved with the comments in one chronological timeline: who created it, marked it done or reopened it, moved it between areas (naming both), assigned it to someone, and set or cleared a due date. Each entry carries the actor's avatar and a timestamp, so opening a card months later tells you how it got to where it is. The history is stored structured rather than as prose, so it's rendered in the reader's own language regardless of who performed the action.
- **The notification list was rebuilt to read like the comment section.** Each entry now leads with the actor's **avatar and name**, followed by what they did and when, and a comment appears in its own bubble underneath instead of being crammed into one line of text. Unread entries carry a dot, and an empty list says so rather than showing nothing. Notifications now record *who* triggered them (a new `actorId`), which is what makes the avatar possible — previously the only trace of the actor was their name embedded in the message text. System notifications (due reminders) show as LocalBoards, and notifications created before this release still show the actor's name parsed from the message.

### Fixes

- Fixed comment notifications that showed an empty card name (`on card ""`). A card with a blank name — reachable via the Trello import, which inserted names unchecked — produced a message the display regex couldn't parse, so the name silently vanished. The parser now handles it and falls back to "Untitled card", which also repairs notifications already stored, and the MCP comment path no longer writes an empty name in the first place.
- Tooltips no longer make the board's horizontal scrollbar flicker away on Safari. The tooltip was rendered inside the hovered element, so on a board wide enough to scroll, hovering a button (e.g. an area's delete icon) triggered a WebKit repaint that dropped the scroll area's scrollbar until the next scroll. Tooltips now render into `<body>` with fixed positioning, so they're outside the scroll container entirely — which also stops them being clipped inside modals and the board's scroll area.

### Performance

- **Added the database indexes the query patterns actually need.** The baseline tables shipped with only their primary keys, so every join down the board → areas → cards → comments/attachments chain, every session and API-key lookup, and every membership check was a full table scan. Migration `0012` adds secondary indexes on the columns filtered and joined on — `session(token)`, `apikey(key)`, `invitations(board)` / `invitations(user)`, `areas(board)`, `comments(card)`, `attachments(card)`, `boards(user)`, a composite `notifications(userId, isRead, boardId)`, and a few more. Verified with `EXPLAIN`: the hot queries now do index lookups instead of scans. It's a no-op where an index already exists and is safe to re-run.

## v0.20.4

### Security

- Cleared five vulnerabilities in the documentation site's dependencies (`docs/`), including a critical one in `tar`, plus `svgo`, `js-yaml`, `shell-quote` and `brace-expansion`. These were dev-only — the docs site is a separate project and isn't part of the deployed app (it's excluded from the Docker image) — but the fix keeps the dependency tree clean. All were resolved with semver-compatible updates; the docs still build.

## v0.20.3

### Fixes

- **The Docker image builds again.** `npm install` in the build stage crashed with `Cannot read properties of null (reading 'edgesOut')` — an npm 10.9.2 arborist bug (that's the npm bundled with the `node:22.17.0-slim` base image) resolving the current dependency tree from scratch. The build now installs from the committed lockfile with `npm ci` after upgrading to npm 11, which is both reproducible and clears the bug. This also required un-ignoring `package-lock.json` (it was in `.dockerignore`) so the lockfile reaches the build context. Verified with a full `docker buildx` build. Not exclusive to this project's deps — any tree that trips the npm 10.9.2 bug hit the same wall.

## v0.20.2

### Security

- Cleared the moderate `@hono/node-server` path-traversal advisory (GHSA-frvp-7c67-39w9), pulled in transitively through the MCP SDK. It was not reachable in practice — the vulnerable `serveStatic` is never imported by the SDK or the MCP toolkit, the toolkit's transport doesn't use `@hono/node-server` at all, and the flaw is Windows-only while the app runs on Linux — but the patched version (`>=2.0.5`) is now pinned via `overrides`, so the audit is clean. `npm audit fix --force` was avoided because it wanted to *downgrade* the MCP toolkit.
- Patched a high-severity ReDoS in the transitive `brace-expansion` dependency (GHSA-3jxr-9vmj-r5cp / CVE-2026-13149): a small input could stall the Node event loop for minutes. It came in via Nuxt's and the i18n module's build tooling. Two version lines were affected; each is pinned to its fixed release through `overrides` (2.x → 2.1.2, 5.x → 5.0.7), leaving the other consumers' majors intact.

### Fixes

- Notification e-mails: the grey box around each notification is evenly padded again. It relied on the mail client's default paragraph margins, which left roughly 27px above the text and 5px below — and a comment, which ends in a plain block with no margin at all, sat right on the bottom edge. Spacing is now set explicitly rather than inherited.

## v0.20.1

### Changes
- The unread-notification dot on the bell now uses the secondary colour, like the other "live" indicators.

- **The two theme colours now have distinct jobs.** `secondary` was really the primary's hover shade, which is why it had to be another blue — every button simply darkened into it. Hover now uses its own `primary-hover` shade, which frees `secondary` to be a genuine second colour: it is green (`#12784F` light, `#17996A` dark) and marks *completion and live state* — a finished card's tick, checkboxes (both the form ones and the task-list boxes inside a description), the "viewing now" dot, success toasts. A board can therefore be read at a glance: blue is something to act on, green is something that is done. Overdue due dates, which had been sharing that colour, now stand out by weight instead — green would have read as "fine". The green is matched to the primary's visual weight (luminance 0.141 against the blue's 0.139), and `NUXT_PUBLIC_COLOR_PRIMARY_HOVER` joins the other colour variables.

### Fixes

- The board's three-dots menu opens below the button again instead of over it, and the "create new area" tile keeps a column's width whether or not its form is open, so clicking it no longer shifts the board sideways.
- Board columns fit the window again where scrollbars take up space. The width cap was based on `100vw`, which *includes* the scrollbar, so a column was up to a scrollbar's width too wide and ran past the header. It is now measured against the board area itself (container-query units), which excludes any scrollbar and needs no assumption about how wide one is.
- Opening a dialog no longer nudges the page sideways. Locking the page hides its scrollbar, and where scrollbars take up space (Windows, Linux, and macOS whenever a mouse is connected) that widened the content by ~15px. The scrollbar's width is now measured when the page is locked and re-added as padding, so nothing moves. `scrollbar-gutter: stable` was the obvious alternative, but the gutter it reserves sits outside all layout — a full-screen overlay stops short of it, leaving an undimmed strip beside the dialog's own scrollbar.
- A scrolled dialog no longer looks torn off as it closes. Two things caused it: the open/close transform sat on the card *inside* the scroll container, so animating it moved the card straight through that container's padding edge — the clip boundary — and cut it off; and the card was still faintly visible after the backdrop had faded, leaving the clipped fragment floating over the board. The transform now sits on the scroll container itself, so the dialog travels as one piece, and the card fades out in a little over half the time the backdrop takes.
- Closing a dialog no longer flashes two scrollbars. The page's scroll lock was released the instant the dialog started closing, so the page's scrollbar reappeared while the dialog — and its own scrollbar — was still fading out. The lock is now held until the closing animation has finished. Most visible with a scrollable dialog and macOS set to always show scroll bars (as it is when a mouse is connected).
- The board's three-dots menu now lines up with the *first line* of the board name instead of the top of the whole heading. With the smaller mobile headline the circle sat noticeably below the text; centring it on the heading as a block would have looked wrong for titles that wrap, so it is pinned to a box exactly one line tall.

## v0.20.0

### New Features
- **Agents can safely share a board with humans (and each other).** The MCP gained the pieces an autonomous "pull a task, do it, tick it off" loop actually needs:
  - **`claimCard` / `releaseCard`** — claiming is *atomic*, so two agents (or an agent and a person) can never start the same card. A claim either wins or tells you who holds it; claimed cards drop straight out of the "unassigned" queue. `releaseCard` hands it back if the work is abandoned.
  - **Filtering** on `searchCards` — combine `areaId`, `done`, `unassigned`/`assigneeId` and `dueBefore` (text is now optional), so "open, unassigned cards in the to-do column" is a single call. The same filters are available on the REST endpoint (`GET /api/data/cards?done=&assignee=&unassigned=&dueBefore=`), so they're useful outside the MCP too.
  - **Retry-safe creates** — pass an `idempotencyKey` to `createCard` and a repeated call returns the existing card instead of a duplicate.
  - Corrected the server instructions: they previously implied changes are pushed to agents. They aren't — an MCP client has no push channel and must re-read. The instructions now spell out the whole work loop instead.
- **Human vs. AI accounts.** Accounts can be marked as an **AI agent** when an admin creates or edits a user (public sign-up always creates humans). Agents show a bot badge in the user list and in card presence, and `whoami` reports the type — so you can always tell at a glance whether a person or a bot took a card.
- **See who's on a card.** Live presence avatars show who currently has a card open — **on the card tiles right on the board**, so you can see at a glance where everyone (and every agent) is working without opening anything, and again inside the card modal next to the due-date/assignee row. Built on the existing Socket.IO card rooms: opening a card announces you to everyone watching the board, and presence clears when the modal closes or the connection drops. Opening a board — or a card directly via its link — catches you up on who is already there, a reconnect re-announces you instead of making you vanish, multiple tabs of the same person collapse into one face, and AI agents show a bot icon. A pulsing live dot marks the group as *active* — and on the board it sits with the card's other details on the left, while the assignee stays alone on the right, so "who is looking at this" is never mistaken for "whose job this is". In the card modal the row spells it out ("Bea and 2 others are here right now").
- **Notification e-mails are now optional.** Turn them off in your own profile, or for any account as an admin; AI-agent accounts default to off.
- **Webhooks.** Get another system notified when a board changes — ideal for waking an automation or AI agent when work appears (an MCP agent can't be pushed to, so this is the way to trigger one). Subscriptions live under **Settings → Webhooks** and are **per user *and* per board**: on a shared instance every collaborator wires up their own endpoint, and nobody fires — or even sees — anyone else's. Payloads carry the event, board, card/comment and the actor (including whether they're human or artificial), are optionally HMAC-signed with your secret, and default to **ignoring your own changes** so an agent can't re-trigger itself. Delivery is fire-and-forget with a timeout, so a slow endpoint never slows the app.
- **LocalBoards is now a first-class tool for AI agents.** The built-in MCP server was overhauled so an agent connecting with an API key can discover and use it without reading any source:
  - **Guidance built in.** The server now ships operational **instructions** (the data model, the recommended read→act flow, that content is Markdown, the permission rules), and every tool has a rich description, a human title, per-field docs, input examples and proper annotations (read-only / destructive / idempotent hints) so clients know what each tool does and how to call it.
  - **New tools:** `whoami` (who you're acting as + whether the key is read-only), `getBoardTree` (a whole board — areas + cards — in one call, instead of N calls), `searchCards` (find cards by text across boards, with board/area context) and `listBoardMembers` (who can be assigned).
  - **More capable cards:** `createCard`/`updateCard` can now set a **due date** and **assignee** (parity with the app); updates are partial (change only what you pass).
  - **Read-only API keys.** When creating a key you can choose **Full access** or **Read-only**; read-only keys can read boards but are refused create/update/move/delete. Great for a reporting agent.
  - **Consistent & predictable:** parameters are standardized to `boardId`/`areaId`/`cardId` (the old `*ID` spellings still work as deprecated aliases), return shapes are normalized (booleans, ISO dates, ids), and failures come back as structured errors with a stable code (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `INTERNAL`) instead of vague text. Also fixed two latent bugs: MCP-created comments never notified collaborators, and `createCard` ignored the status field. See the new `AGENTS.md` for the full guide.
- **Leave a board you were invited to.** An invitation grants access immediately and there is no accept step, so until now a collaborator had no way off a board — only the owner could remove them. A board's header menu now offers **leave** (with a confirmation dialog) to everyone except the owner, who deletes the board instead. Leaving removes only your own access: the board is untouched and the owner can invite you back. It also cleans up what hung off that membership — your webhook subscriptions for the board and your notifications about it.

### Security

- **Realtime connections are now authenticated.** The Socket.IO channel previously accepted any connection and trusted whatever the client sent. Every socket is now tied to its session cookie, and joining a board or card room requires actual access to that board. Two consequences worth calling out: card presence takes your identity **from your session**, never from the client, so nobody can put someone else's face on a card; and realtime events (comments, card and board updates) can no longer be injected into a board you have no access to.
- **Read-only API keys are now read-only everywhere.** The restriction was enforced for MCP tools but not for the REST API, so a "read-only" key could still create and delete through `/api/data/*`. It is now enforced centrally: any non-GET request made with a read-only key is refused with 403.
- **`listBoardMembers` no longer returns e-mail addresses.** Read access to a *public* board is granted to every signed-in user, so the tool handed out the owner's and collaborators' e-mails to anyone. It now returns userId, name, type and role — matching what the app's own member endpoint has always exposed.
- **Webhooks re-check access on every delivery** instead of only when the subscription is created, so a collaborator whose invitation is revoked (or whose board turns private) immediately stops receiving card and comment content. Subscriptions are also deleted when an invitation is revoked or a board is deleted.
- **Webhook URLs are validated against internal addresses** (loopback, private ranges, link-local including cloud metadata) at creation *and* before each delivery, closing a server-side request forgery hole. Deliveries also release the response body instead of holding the connection open.

### Fixes

- **The board header's action buttons moved into a three-dots menu.** Board settings, invite and delete (and *leave* for collaborators) used to be a row of round icon buttons, which ate a lot of the screen on a phone and meant every new action needed its own distinguishable icon. They now live in the same menu the dashboard already uses, labelled with text.
- **Headings are no longer oversized on phones.** The 48px section headings (board name, dashboard, settings, user pages) step down below the `sm` breakpoint and keep their original size from tablets up — a long board name took three lines of a phone screen before it showed a single card. The board's title and its menu also stay on one row instead of the menu wrapping onto its own line.
- **Board columns fit the screen on mobile.** A column had a fixed 23rem width whose `max-w-full` resolved against the scrolling flex row rather than the viewport, so on a phone it ran past the header buttons and off the edge of the page. Columns are now capped to the gutter-to-gutter width, lining up exactly with the header. Wider screens are unaffected.
- **The Markdown migration is now safe to re-run.** Its row loop is not transactional and the migration is only recorded as applied once it finishes, so a crash partway through re-ran it from the top — and the conversion is *not* idempotent (Turndown parses its input as HTML, so Markdown fed back in collapses to a single backslash-escaped line). Worse, the backup overwrote itself, destroying the rollback path. The backup is now written once and never overwritten, and each row is converted exactly once from that pristine HTML. Covered by a new integration test that runs the migration twice.
- Schema migrations `0008` and `0009` are now guarded, so a crash between two DDL statements no longer wedges startup with "Duplicate column name" on the retry.
- Ticking a checkbox in a **comment** no longer deletes content the sanitizer strips (a Markdown table, for example). The comment is now rebuilt from its stored Markdown instead of from the rendered DOM — the same approach the card description already used.
- **Markdown tables render properly.** They were being stripped to loose text, which mattered more now that content is authored as Markdown (including by agents).
- **Strikethrough survives editing.** `~~text~~` degraded to literal `~text~` on every save, because the two converters disagreed on the tilde count.
- Rescheduling a card's due date **over MCP** now re-arms its reminders, matching the web app — previously an agent's reschedule left the reminder permanently silent.
- `moveCard` refuses a move to an area on a *different* board, which produced inconsistent realtime updates (the notification went to one board, the socket event to the other).

### Changes
- Checkbox labels (the privacy consent on sign-up, the notification-e-mail and account-type options) were rendered at the base 16px while every other form label is 14px, so they sat noticeably larger than the fields around them. They now match.
- The sign-in, sign-up, forgotten-password and password-reset cards are a little wider (32rem instead of 28rem), so the privacy consent no longer wraps with a single word stranded on its own line. German is the longest of the seven translations and now fits on one line; narrow screens are unaffected.
- **A board no longer scrolls sideways for nothing.** The "create new area" tile reserved a full 23rem column even when idle, so a board whose areas fitted comfortably still showed a horizontal scrollbar just to accommodate a button; it now claims a column only while its form is open. The page itself can no longer scroll sideways at all, and the scroll lock behind modals targets the vertical axis only, so it can't reset the horizontal one — together these stop a stray scrollbar from stealing viewport height and making the page scroll vertically by exactly its own thickness.
- **Scrollbars are native again.** The custom overlay scrollbars (page, board and modal) have been removed. A re-implementation has to reproduce momentum, rubber-banding, scroll anchoring and the user's own "show scroll bars" OS preference, and it never quite matches — for ~480 lines of JS and CSS, three near-identical components and a body-class dance to suppress text selection while dragging a thumb. The native bars were already theme-matched through `color-scheme`, so the look barely changes.
- **Card descriptions and comments are now stored as Markdown** instead of HTML. This is smaller, safe to render (raw HTML embedded in content is escaped rather than executed, so the stored-HTML XSS class is gone by construction), and it's the native format for AI agents working through the MCP. The rich-text editor is unchanged for humans — it now loads from and saves to Markdown behind the scenes — and everything renders identically (bold/italic, headings, bullet/numbered lists, task-list checkboxes, links, images, code). Existing content is converted in place by a database migration that **backs up the original HTML** into `cards_content_html_backup` / `comments_content_html_backup` tables first, so the change is reversible. The Trello importer now stores Markdown directly. Also fixed a latent bug where ticking a checklist item inside a comment (from the read view) discarded the rest of the comment's text. Covered by unit tests (the Markdown⇄HTML converters) and an integration test (the migration against a real database).

## v0.19.0

### New Features
- **Import a board from Trello.** A three-dots menu on the dashboard (next to "create board") holds an "Import from Trello" action that opens an import dialog: paste a Trello board link and LocalBoards recreates the whole board — its lists become areas and its cards come across with names, descriptions (Markdown converted to rich text), checklists (as interactive checkboxes), **completion status** (a card marked complete in Trello imports as done), **comments** and **attachments**, preserving order and skipping archived lists/cards. Comments keep their original author name (shown as a plain, non-editable label — imported comments aren't tied to a local account) and timestamp. Uploaded file attachments are **downloaded and re-hosted** in LocalBoards (up to 10 MB each; the correct image/PDF type is detected so they open normally); link attachments are kept as links on the card. It reads Trello's public board export (`…/b/<id>.json`), so the board must be **public** while importing (Trello: Share → Change visibility → Public); private boards report a clear error. The board/areas/cards/comments are created in one transaction, with attachments fetched best-effort afterwards (a single bad file never loses the import). It only ever fetches `trello.com` URLs derived from the pasted link (no SSRF) and caps very large boards and attachments (Trello also caps the exported comment history at ~1000 actions). The parsing/conversion is covered by unit tests.
- Admins can now **impersonate a user** from the user list ("log in as" that user). A masked-face button on each entry swaps the admin's session for the target user's, so you see the app exactly as they do — useful for reproducing a report or checking permissions. A prominent banner stays pinned at the top while impersonating ("Angemeldet als …") with a **one-click way back to your own account**. It's session-based and reversible: impersonation can't be nested, self-impersonation and banned users are rejected, and returning is only allowed if the original account is still an admin (a demoted/deleted admin can't use a stale impersonation to regain access).
- The **user list** got search and sorting: a search box filters by **name or email**, and a sort control offers **newest / oldest / name A–Z / name Z–A**. Both operate on the already-loaded list, so filtering and reordering are instant. The search field also shows an **autocomplete dropdown** of matching users (avatar, name, email — the same styled typeahead as the invite dialog); picking a suggestion narrows the list to that user. The sort control is a custom styled dropdown with clickable options.
- Redesigned the **user-list entries** as proper cards — each row now shows the user's **avatar** (profile picture or initial), name, a **role badge** (and a "You" badge on your own row), and their email, with compact ghost icon-buttons for impersonate / edit / delete instead of the old email-only row with two big circles.
- Your **role** is now shown in the account settings, below your name. Normal users see it read-only; an **admin can demote themselves to a normal user** with a segmented toggle. Admins editing an existing user from the user list can likewise change that user's role (previously the edit form only let you change name and email). Demoting the **last** admin is blocked on the server so an instance can never end up with no admin. The role pickers (create user, edit user, settings) all use the same segmented toggle as the board dialogs, and self-role changes are restricted server-side so a normal user can't promote themselves. When you change your own role the page reloads so the session — and the admin-only parts of the UI — reflect it immediately.
- Clicking an image in a card description or comment now **zooms it open** — the image animates from its spot on the card to fullscreen, and back to that spot when you close the lightbox — instead of sliding in from the side. Images also get a hover affordance (a zoom cursor and a subtle lift) so it's clear they can be opened. Attachment images, which have no on-screen thumbnail, scale gently from the centre.
- Card attachments can now be **viewed**, not just downloaded. Clicking an **image** attachment opens it in the same lightbox used to enlarge description images; clicking a **PDF** opens it in a new browser tab (served inline — reliable across desktop and mobile, unlike an in-page PDF frame); other file types download. Each attachment row also has its own **download** and **delete** buttons (deleting requires write access, removes the file, and updates the board tile's attachment count live for everyone).

### Improvements
- Radio-button groups (e.g. the API-key expiry choice) now use the app's check style — a round control that fills with the primary colour and shows a checkmark when selected — matching the card status toggle and checklist checkboxes, instead of the old filled dot.

### Bug Fixes
- Redesigned the **comment item**: the comment content sits in its own card (it's the point), with a meta row below the card holding the author's avatar, name, and date on the left and the owner's edit/delete buttons on the right (always visible, as compact ghost icon-buttons). Previously the edit/delete controls were a pill that floated over the top-right of the content, which overlapped full-width image comments. The new layout never overlaps the body.
- Slightly increased the spacing between a card's read-only description and the "edit description" button so the button no longer sits so tight against the text.
- On a board, scrolling the areas all the way to the right now keeps a gutter that **lines up with the header** instead of running the last area flush to the viewport edge. The areas used to sit in a full-width `.container` while the outer element did the scrolling, so at maximum scroll the container's right padding was lost; the padding now lives on the areas row itself (sized to `w-max` so it counts in the scroll width), which also works around Safari dropping a flex container's `padding-right` on overflow.
- User-list controls: the **search field is now the wide one** and the sort control sits in a fixed-width slot beside it (they were reversed — the app's unlayered `.form-control` width was overriding the native select's width cap). The sort control is now a **custom dropdown with styled, clickable options** (hover states and a check on the current choice) instead of the browser's unstyled native menu, and the search field opts out of browser autofill so Safari no longer suggests your own e-mail address into it.
- Checklist items in card descriptions and comments now use a **rounded-square** checkbox instead of a fully round one, so they read as checkboxes rather than radio buttons.
- Closing the enlarged-image lightbox no longer re-enables scrolling of the card modal behind it. The lightbox was resetting the page's scroll lock unconditionally on close; it now shares the same modal-open bookkeeping as the other modals, so scrolling stays locked while any modal is still open.
- Fixed the profile-picture picker layout on the settings page, which the v0.18.3 image-picker rework had cramped (the avatars were squeezed into a couple of columns while the rest of the card sat empty). The actual image is back on the left with the selectable avatars in a neat grid beside it, next to the name field.

## v0.18.5

### Bug Fixes
- Fixed a **fresh-install database error** introduced in v0.18.3: the `notified` column was added to both the `notifications` `CREATE TABLE` and migration `0005`, so on a brand-new database the migration's `ADD COLUMN notified` hit a duplicate-column error and aborted schema setup (the server/CI couldn't start). The column is now only added by the migration, matching the pattern of the other migration-added columns. Existing installs were unaffected (their table already existed, so the base `CREATE TABLE` was a no-op and the migration added the column normally).

## v0.18.4

### Bug Fixes
- Uploading a **WebP** (or GIF) image as a board thumbnail / profile picture now works. The picker was posting to the generic attachment endpoint, which only accepts JPEG/PNG among images; it now uses the image endpoint that also accepts WebP and GIF. Also fixed the upload fallback so a failed upload embeds a valid base64 data URL instead of a broken one (which was showing as a broken-image placeholder).
- The invite dialog's user-search field no longer triggers the browser's own autofill (Safari/iCloud Keychain was treating the "Benutzer"/e-mail field as a login and overlaying saved-password suggestions on top of the app's own results list). The field is now marked as a custom combobox with a non-credential name and autofill/password-manager opt-outs.

## v0.18.3

### New Features
- Board tiles on the dashboard now show who works on each board: up to four collaborator avatars (the owner plus invited members) are stacked in the tile's corner, with a "+N" bubble when a board has more than four members. The board-list endpoint (`/api/data/boards`) now returns each board's members and total member count (fetched in a couple of batch queries, no per-board N+1), and long board names truncate so they don't collide with the avatars.
- Board tiles also show a small pulsing dot when the board has unread notifications for you, so you can spot boards with new activity at a glance. The board-list endpoint returns a per-board unread-notification count for this.
- On a board, individual cards that have unread activity for you (a new comment, a move, an assignment, …) are highlighted with a coloured border, so you can see exactly which cards changed. The highlight clears the moment you open the card.

### Changes
- **Notifications are now marked read when you actually view them, not on a timer.** Previously the hourly notification-email task marked every notification read after emailing it, so the unread indicators self-cleared within an hour regardless of whether you'd seen anything. Now a notification stays unread until you open the thing it's about — the referenced **card** for card notifications, or the **board** for board-level ones (e.g. invitations). Email de-duplication moved to a separate `notified` flag (schema migration `0005`), so emails still go out once but no longer clear your unread state; and anything you've already viewed won't be emailed.

### Improvements
- The custom overlay scrollbars (page, board and modal) are now only used on non-touch devices. On touch devices they were unhelpful — there's no cursor to hover or drag the thumb — so those devices fall back to the platform's native scrollbars (gated via the `(pointer: coarse)` media query).
- Widened the preview/upload box in the image picker from `w-34` to `w-36` for a slightly better fit next to the thumbnail grid.
- The board **display** (KanBan/ToDo) and **status** (private/public) choices in the create- and edit-board dialogs are now shown as full-width segmented toggles — the selected option is a filled pill in the primary colour, the other is muted — laid out side by side in a two-column grid (stacking to one column on narrow/mobile screens) instead of two stacked radio lists. The board-invite permission choice (read-only / read & write) uses the same control. Implemented as a new `SegmentedControl` component (styled radio group, so it stays keyboard- and form-accessible); the remaining radio lists in the app are unchanged.
- Reworked the comment edit/delete controls. Instead of an awkwardly floating edit button and a separate delete button on the author row, both actions now sit together in a small pill in the comment's top-right corner — revealed on hover on pointer devices, and always visible on touch (where there's no hover). The author/date row underneath is now just the avatar and name.

### Bug Fixes
- The editable card title no longer shows a browser focus outline around the whole (full-width) field when you click into or select text in it; instead it shows an animated underline in the primary colour on focus. Copying or cutting from the title now also puts **plain text** on the clipboard instead of the heading's rendered HTML, so pasting into an email or document no longer carries the title's font size/weight/colour.
- Comment timestamps now keep leading zeros for the day and month (e.g. `08.07.2026` instead of `8.7.2026`), matching the notification dates.
- Fixed a stray tooltip appearing over a comment: the new comment action pill used a `group` for its hover reveal, which collided with the tooltip directive's own `group` and made the delete button's tooltip show whenever the comment was hovered. The comment now uses a named group so the tooltip only appears when its button is hovered.
- Clicking a notification for a card on the board you're already viewing now opens that card. Previously the URL updated (`?card=…`) but the modal didn't open, because the page wasn't reloaded and nothing reacted to the query change; the board page now watches the `card` query and opens/closes the modal accordingly.

## v0.18.2

### Improvements
- Reworked the app icons around the logo, and they now follow the instance's configured **primary colour** (`NUXT_PUBLIC_COLOR_PRIMARY`) instead of a hard-coded default. Both are generated at runtime, so a prebuilt Docker image picks up your colour without a rebuild:
  - The **favicon** is served from `/favicon.svg` as an SVG drawn in the primary colour, with the colour baked into an inline `fill` attribute so it renders in every browser.
  - The **touch icon** (`/touchicon.png`, used for the Apple/Android home-screen icon and as the PNG-favicon fallback) is the white logo on the primary-colour background. It's composited at runtime from a small pre-baked alpha mask of the logo and encoded with Node's built-in `zlib` — deliberately **without** a native SVG rasterizer, so no per-architecture binary is added and the Docker `.output` stays portable across architectures. The result is cached per colour. (`scripts/gen-touchicon-template.mjs` regenerates the mask if the logo ever changes.)
- Added two more board placeholder thumbnails (now eight), and reworked the thumbnail picker to use the full width of the dialog. The thumbnails now sit in a responsive grid whose square cells stretch to fill the available width and whose column count adapts to it (roughly four columns in the board dialog, fewer on a narrow/mobile viewport) instead of small fixed-size thumbnails capped at three columns. The preview/upload box on the left keeps a fixed square aspect ratio at every width.

## v0.18.1

### Improvements
- Modal windows now animate open: the dimmed backdrop fades in and the dialog scales in with a quick, subtle easing (powered by Motion). While a modal is open the page behind it is locked so it can't scroll.
- Custom overlay scrollbars throughout. The native scrollbars are replaced by slim, rounded bars — a vertical one on the right of the page (and of tall modals) and a horizontal one pinned to the bottom of a board, so you can pan across areas without first scrolling to the bottom of a long page (a pain for anyone without a horizontal scroll wheel). Each bar fades in only when its content overflows, has a draggable thumb (powered by Motion) and click-to-jump on the track, and is theme-coloured for light and dark. Their inset/size/rounding live in `main.css`.
- Native UI that isn't replaced by the custom bars — the scrollbars inside small dropdowns/popovers (notifications, the invite search, the assignee picker), date pickers and other form controls — now follows the light/dark theme via CSS `color-scheme`.
- Session lifetime is now configurable via the `NUXT_SESSION_MAX_AGE_DAYS` environment variable (default `1` day, as before). Both the session record and the auth cookie use it, so self-hosters can keep users logged in for longer (e.g. `30`).
- Real-time board updates recover more gracefully from brief WebSocket drops (background-tab throttling, network blips, proxy idle timeouts). Socket.IO connection-state recovery is now enabled, so a short disconnection restores the same session and rooms and replays the events missed during the gap, instead of a cold reconnect. (The browser may still log a one-off "WebSocket connection … was lost" when the drop happens — that line comes from the browser itself — but the board resyncs automatically.)

### Bug Fixes
- You can now select text with the mouse in the card-name and area-name fields without accidentally dragging the whole area. The area drag-and-drop (SortableJS) no longer starts when the click begins on an `input`, `textarea` or contenteditable field.

## v0.18.0

### New Features
- **First-run onboarding tour.** New accounts are offered an optional guided walkthrough on first sign-in: it highlights the "new board" button, then on the fresh board walks through creating two areas, adding a card, dragging it to another area, and inviting a collaborator. Each step **auto-advances when you actually do it**, and you can end the tour at any time. Whether an account has been onboarded is tracked server-side (schema migration `0004`; existing users are marked as already onboarded so only brand-new accounts see it). Public self-signups get the tour by default; when an **admin creates** a user there's a checkbox to opt that account into the tour (off by default, since admin-created accounts are usually managed). Fully translated in all seven languages.
- **Account-deletion email with a reason.** When an admin deletes a user, they now must enter a reason, and the deleted user receives a translated email letting them know their account was removed and why — so a deletion is no longer silent. (The user's email/name are captured before deletion; the reason is required and HTML-escaped; email delivery is best-effort and never blocks the deletion.)
- **Welcome emails for new accounts.** Users now get a translated welcome email when their account is created. Public self-signups receive a simple welcome (no credentials). When an **admin** creates an account there's a new opt-in checkbox — *"Send the login details to the user by email"* — that emails the new user their credentials and states who created the account (e.g. *"Carol has created a LocalBoards account for you"*), so admins no longer have to copy/paste and share the password manually. The checkbox is off by default (unchanged copy-the-credentials behaviour); if sending fails the account is still created and the credentials are shown for manual sharing. Emails are translated in all seven languages, and user-supplied values are HTML-escaped.

### Improvements
- **Invite people by searching, instead of typing their full email.** The board-invite dialog now has a searchable user picker: start typing a name or email and pick the person from a list (name + avatar), mirroring the card-modal assignee picker. To respect the earlier anti-enumeration hardening, the search runs server-side and only a board's owner can search its invitable users; results return names/avatars plus a **masked** email (e.g. `fl••@exa••.com`) so same-name users can be told apart without exposing real addresses. Invites are sent by the picked user's id (typing a full email still works for API clients).

### Changes
- **Board invitations now send a dedicated email instead of an in-app notification.** When you invite someone to a board they receive a direct, translated email with a link straight to the board and their access level (read-only vs. read & write), rather than the previous in-app notification that was only delivered in the hourly notification digest. New invitations no longer create an `invitation` notification. (Best-effort delivery: the invite is still created if the email can't be sent; the invited user's board name is HTML-escaped.)

## v0.17.0

### New Features
- Cards can now have a **due date & time**, an **alert/reminder schedule**, and an **assignee**, all set in the card modal. Reminders are Apple-Calendar-style offsets — at due time, or 5 / 15 / 30 minutes, 1 hour, 1 day, or 1 week before — and multiple can be added per card. The board tile shows a due-date badge (red when overdue) and the assignee's avatar. To keep the modal uncluttered, the due date and assignee live behind Trello-style popover menus: a small button opens a menu to pick the value (date + reminders, or an assignee from the member list), and once set the button shows the value and reopens the menu when clicked. The "add attachment" button now sits below the attachment list when one exists.
- When a reminder comes due, everyone with access to the board is notified — **or, if the card is assigned, only the assignee**. Assigning a card also notifies the new assignee. Notifications appear in-app and in the existing hourly notification email, and are fully translated in all seven languages. This is backed by a new `card_reminders` table and a `due-reminders` scheduled task that runs every 5 minutes (schema migration `0003`, which also adds the `dueDate`/`assignee` columns and extends the notification-type enum).

### Bug Fixes
- The attachment upload area now also lets you **click to pick a file** (not just drag & drop), **highlights** while a file is dragged over it, and is taller so it's easier to hit.
- Dates in notifications (both the in-app bell and the reminder email) and on the card due-date chip now keep locale-correct leading zeros — e.g. German `03.07.2026, 02:09:00` instead of `3.7.2026, 02:09:00` — by formatting with explicit 2-digit day/month/hour/minute (and seconds for notifications).

### Improvements
- Unified the look of every input across the app: text inputs, textareas, selects and the rich-text editor now share one subtle style (a faint filled background that stands out from the card, a light border, and a primary-colour focus ring) in both light and dark mode. The appearance is defined once as a `.form-control` class in `app/assets/css/main.css` and reused by the shared `InputField.vue` component and the remaining controls, so future restyles only touch one place. Native `<select>` chrome is replaced with a custom chevron so selects match the text inputs' height and padding.

### Internal
- The notification email task now reads its strings from the shared i18n locale files (`i18n/locales/*.json`) instead of a duplicated inline translation table, so notification translations have a single source of truth (shared with the UI). The reminder-firing logic lives in a testable `runDueReminders` helper with DB-backed integration tests (unassigned → all board members, assigned → assignee only, not-yet-due, no double-fire).

### Security Fixes
- Fixed a stored XSS vulnerability. Card descriptions, comments, and notification messages are rendered as HTML (`v-html`) and were not sanitized, so a user with write access to a shared board could store markup like `<img src=x onerror=…>` that runs JavaScript in a collaborator's authenticated session (letting it call the API as that user and exfiltrate everything they can see). All three render sites now pass content through a new `sanitizeHtml` helper (`app/utils/sanitizeHtml.ts`, backed by isomorphic-dompurify, unit-tested) that allows only the markup TipTap emits — including task-list checkboxes and images — and strips `<script>`, inline event handlers, and dangerous URI schemes. Sanitizing at render protects existing content too, not just new posts
- Closed a write-access gap in the MCP tools. The v0.16.0 fix that made public boards read-only for non-collaborators was applied to the REST endpoints but not to the MCP tools, which kept their own inline access logic where `status === "public"` still granted write. Any user with a valid API key could therefore create/edit/move/delete cards & areas and post comments on **any** public board via MCP. All MCP write tools (`createArea`, `createCard`, `deleteArea`, `deleteCard`, `updateArea`, `updateCard`, `writeComment`, `moveAreas`, `moveCard`, `orderCard`) now use the shared, tested `authorizeBoard` helper, so public boards are read-only there too and the duplicated logic can no longer drift from the REST layer. `moveCard` additionally now requires write access to the **destination** board, not just the source
- Removed a board-existence oracle. `authorizeBoard` returned `403` for an existing board the user can't access but `404` for a missing one, so an authenticated user could tell which (sequential integer) board ids exist by probing. It now returns `404` in both cases; a `403` is only returned when the user already has read access but lacks the required write access (which reveals nothing new)
- Removed an email-enumeration vector in the board-invite endpoint. Inviting a non-existent email address previously returned a distinct `404 "User not found"`, letting a board owner probe which emails have accounts. It now returns the same generic success as a real invite (no invitation is created), matching how password-reset requests avoid enumeration

## v0.16.2

### Bug Fixes
- Long unbreakable strings (e.g. URLs) in card descriptions and comments no longer overflow the box — the rich-text content now wraps them (`overflow-wrap`/`word-break` on the `.wysiwyg-wrapper`/`.tiptap` containers)
- Timestamps (e.g. comment times) were shown shifted by the server's UTC offset — a comment posted at 00:56 displayed as 02:56 in CEST. The connection pool reads timestamps as UTC (`timezone: "Z"`), but the MySQL session used the server's local timezone, so `CURRENT_TIMESTAMP`/`NOW()` returned local time that was then reinterpreted as UTC. Each pooled connection now sets `time_zone = '+00:00'`, so writes and reads are consistently UTC. No data migration is needed (TIMESTAMP columns are stored as UTC internally; only the read path was affected), and existing comments now display with the correct time

## v0.16.1

### Internal
- Fixed the CI `npm ci` failure: pinned npm to 11 in the install jobs so it matches the npm major that generates `package-lock.json` (Node 22 bundles npm 10, which resolves `crossws` differently and rejected the lockfile with "Missing: crossws@0.4.6"). Also bumped the GitHub Actions to current Node 24 majors (`actions/checkout@v7`, `actions/setup-node@v6`, `docker/setup-buildx-action@v4`, `docker/build-push-action@v7`), clearing the Node 20 deprecation warnings
- Documented why `hashApiKey` uses SHA-256 in `server/utils/apiKey.ts`: CodeQL's `js/insufficient-password-hash` is a false positive here — API keys are high-entropy random tokens, not passwords, so a fast deterministic hash is correct and is required for the indexed key lookup. The alert is dismissed in code scanning

## v0.16.0

### New Features
- Added a public health-check endpoint `GET /api/health` that returns `200` (`{ status: "ok", database: "ok" }`) when the app is up and can reach its database, or `503` when the database is unreachable. The Docker image now declares a `HEALTHCHECK` against it (using Node's built-in `fetch`, so no extra tools are needed in the slim image), so Docker/compose/orchestrators report container health automatically

### Improvements
- Session resolution no longer makes an internal HTTP round-trip. `getSession` previously called `$fetch("/api/auth/get-session")` on every authenticated request; the session + user lookup is now done directly against the database via a shared `resolveSession` helper in `server/utils/auth.ts`, which both the internal `getSession` and the `/api/auth/get-session` endpoint use. This removes one self-request per API call and a layer of failure, with no change to behaviour or response shape
- The database schema is no longer (re)created on every request. `setupDatabase()` previously issued all `CREATE TABLE IF NOT EXISTS` statements on each call (i.e. every request); it now just returns the connection pool. Schema setup runs **once at startup**.

### Internal
- Added DB-backed integration tests that run the real code against a real MySQL: `verifyApiKey` (including the legacy-plaintext → hash migration), `resolveSession` (valid / expired / banned / unknown), `authorizeBoard` (owner, invitation read/edit, public, and strict `publicWrite:false`), and `requireBoardAccess` end-to-end via API-key auth (owner / invited / uninvited, missing & invalid board id, unauthenticated, invalid key) using a small fake-h3-event helper. They live in `test/integration/`, run via `npm run test:integration` against a throwaway database (configured with `TEST_MYSQL_*` env vars), and run in CI against a MySQL service container. The default `npm test` stays fast and dependency-free (integration tests are excluded). `databaseSetup.ts` now falls back to `process.env` when Nuxt's `useRuntimeConfig` isn't available, so it can be imported outside the Nuxt runtime by the tests
- Introduced a versioned database migration system in `app/lib/databaseSetup.ts`: an ordered list of migrations tracked in a new `migrations` table, applied once at startup by a `server/plugins/0.database-migrate.ts` Nitro plugin. The existing schema is the `0001_baseline_schema` migration (using `CREATE TABLE IF NOT EXISTS`, so it is a safe no-op on existing databases — it just records the baseline as applied). Future schema changes are added as new migration entries instead of relying on ad-hoc `CREATE TABLE IF NOT EXISTS` at runtime, which could not evolve an already-populated database
- Versioning hygiene: `package.json` now has a proper `name` (`localboards`) and a `version` (`0.16.0`), and the README version badge is now a dynamic shields `package-json/v` badge that reads the version straight from `package.json` — so it no longer has to be bumped by hand
- CI now also builds the production Docker image on every push/PR (build-only, no push, with layer caching) so Dockerfile regressions — like a broken `HEALTHCHECK` — are caught automatically
- CI `npm audit` is now blocking for production dependencies (`--omit=dev`, the deps that ship in the image), while a full audit including dev tooling runs as a non-blocking informational step
- Structured logging: added a small zero-dependency leveled logger (`server/utils/logger.ts`, unit-tested) that emits one JSON line per event (timestamp, level, message, serialized error/context) to stdout/stderr, with the minimum level controlled by `NUXT_LOG_LEVEL` (default `info`). Replaced the scattered `console.log/warn/error` calls across the server with it; noisy Socket.IO and trace logs are now `debug` level and silent by default in production
- Added end-to-end HTTP tests (`@nuxt/test-utils`) that build and start the real server against a throwaway MySQL and exercise the auth endpoints over HTTP: `sign-in` (405 / 400 / 401 / rate-limit 429), `sign-up` happy path, `request-password` generic-success for an unknown email, a `reset-password` happy path (reset via a seeded token, then sign in with the new password), `get-session` (401 unauthenticated / 200 authenticated), the API-key lifecycle (`create` → `list` → `delete`), `admin/list` authorization (403 for non-admins, 200 for admins), and `sign-out` (invalidates the session). Run via `npm run test:e2e`; also run in CI
- Added a Playwright browser test (`test/playwright/`) covering the real-time multiplayer flow: two authenticated browser contexts open the same board, one creates a card, and the other sees it appear live via Socket.IO. Run via `npm run test:browser` (needs a throwaway MySQL and a built app); also run in CI against a MySQL service container. Added `data-testid` hooks to the new-card form for stable, language-independent selectors

### Bug Fixes
- Removed a duplicate `changePassword` key that appeared twice in every i18n locale file (`i18n/locales/*.json`); the redundant entry is gone (values were identical), silencing the build-time "Duplicate key" warnings
- Renamed the internal `getSession` auth helper to `getUserSession` (`server/utils/auth.ts` and all call sites). Its old name shadowed h3's auto-imported `getSession`, producing a build warning and an ambiguous binding; the rename removes the collision

### Security Fixes
- **Public boards are now read-only for users who aren't the owner or explicitly invited with edit access.** Previously any authenticated user could create, edit, move, or delete cards/areas and post comments on any public board. Public boards are still viewable by anyone, but writing now requires ownership or an `edit` invitation — the same rule that already governed private boards. This also removed an inconsistency where a stranger could create/rename areas on a public board but not delete them. (As before, deleting a board and managing invitations remain owner-only.)
- Added rate limiting to the authentication endpoints to curb brute-force and abuse: `sign-in` (10 **failed** attempts / 15 min per IP — successful logins don't count, so teams behind a shared office IP aren't locked out), `request-password` (5 / 15 min — limits reset-email bombing and probing), and `reset-password` (10 / 15 min — limits reset-token brute-forcing). Over the limit returns `429` with a `Retry-After` header. The limiter (`server/utils/rateLimit.ts`, unit-tested) is in-memory and keyed by client IP (honouring `X-Forwarded-For`); limits are per-instance, which suits the single-container deployment (a multi-replica setup would need a shared store)
- API keys are now stored as a SHA-256 hash instead of plaintext, so a database leak no longer exposes usable keys (a hash can't be presented to authenticate). A new `hashApiKey` helper (`server/utils/apiKey.ts`, unit-tested) is used when creating keys and when verifying them. Any pre-existing plaintext keys are converted to hashes by a one-time database migration (`0002_hash_legacy_api_keys`) at startup, so no key needs to be regenerated and verification needs no plaintext fallback. The previous bcrypt "constant-time" code around the plaintext lookup (which protected nothing, since the lookup itself matched plaintext) was removed; a fast hash is the correct choice for high-entropy random tokens

### Documentation
- Added `CONTRIBUTING.md` covering dev setup (Node 22, `.env.local`), running the unit and integration test suites, the schema-migration workflow, and a PR checklist; linked from the README's Contribute section
- Added a "Backup and Restore" section to the README covering the two things to back up (the MySQL database and the `/app/public/uploads` directory), with `mysqldump`/restore and Docker volume examples
- Added "Health Check" and "Contributing" articles to the documentation site

## v0.15.5

### Internal
- Added a test runner (Vitest) with `npm test` / `npm run test:watch` scripts — the first automated tests in the project
- Added integration tests for `authorizeBoard` (10 cases) driving it with a fake DB connection, covering invitation-lookup conditions and the `publicWrite: false` strict-edit mode — including the assertion that strict mode looks up an invitation even on a public board, and that the owner/standard-public paths skip the lookup entirely
- Added a GitHub Actions CI workflow (`.github/workflows/ci.yml`) that runs on pushes and PRs to `master`: installs with `npm ci` (Node 22), runs the test suite and the production build, and runs `npm audit` as a non-blocking step
- Committed `package-lock.json` (removed it from `.gitignore`) so installs are reproducible and `npm ci` works in CI — previously the lockfile was ignored, which made the CI install step fail
- Extracted the board access-control decision (owner / public / invitation → none/read/edit), previously re-implemented inline in every data endpoint, into a single pure `resolveBoardAccess` helper in `server/utils/boardAccess.ts`, covered by exhaustive unit tests
- Added `resolveUserId`, `authorizeBoard`, and `requireBoardAccess` helpers in `server/utils/auth.ts` that centralize the per-endpoint "verify API key / session → load board + invitation → decide access" boilerplate (`authorizeBoard` works on an already-loaded board for endpoints that reach it via a `card → area → board` join). Migrated **all** data endpoints to them: `board.ts`, `boards.ts`, `area.ts`, `areas.ts`, `card.ts`, `cards.ts`, `cardMove.ts`, `cardOrder.ts`, `comment.ts`, `invite.ts`, `notifications.ts`, `attachment.ts`. Access behaviour is unchanged, including the stricter paths that do **not** grant write via a `public` status (board-record update, area deletion) and the owner-only paths (board deletion, all invite operations), which now use an explicit `publicWrite: false` option or inline owner checks

### Bug Fixes
- Images in a card's description (in `CardModal`) now open enlarged in an image modal on click, matching the existing behaviour for images in comments. Previously only comment images were clickable
- Clicking the dimmed area of the image lightbox now closes it. The enlarged image uses `object-contain`, so its `<img>` element still covered the full box (including the visually empty letterbox margins) and sat on top of the background close handlers, swallowing the click. The `ImageWindow` content wrapper now closes on click, so clicking anywhere — the image or the surrounding space — dismisses the modal

## v0.15.4

### Improvements
- Responses are now compressed with brotli (falling back to gzip) based on the client's `Accept-Encoding`. A `beforeResponse` server plugin compresses dynamic responses — notably the large API JSON for populated boards (hundreds of areas/cards) — and `nitro.compressPublicAssets` pre-compresses static assets at build time (the ~1 MB client bundle drops to ~200 KB brotli). Socket.IO traffic and binary downloads are left untouched

### Bug Fixes
- Custom colors (`NUXT_PUBLIC_COLOR_*`) now apply in dark mode. The static dark-mode color tokens in `main.css` were unlayered and overrode the runtime colors injected in `app.vue`; they are now placed in a cascade layer (`@layer app-theme`) so the runtime (unlayered) values win. Light mode already worked, so custom colors were silently ignored only in dark mode — most visible in the Docker image, where colors come entirely from runtime env variables

## v0.15.3

### Bug Fixes
- The UI language (`NUXT_LANGUAGE`) is now applied at runtime instead of being baked at build time, so it works in the Docker image (where the env isn't set during the build) — previously the app was always English regardless of the variable. All locales are now bundled and the active one (plus the `<html lang>` attribute) is selected at startup from `NUXT_LANGUAGE` via `app/plugins/i18n-locale.ts`
- Removed the leftover build-time `site.defaultLocale` from `nuxt.config.ts`

## v0.15.2

### New Features
- Added optional TLS for the MySQL connection via `NUXT_MYSQL_SSL=true` (required by managed/external databases such as Mittwald). Certificate verification stays on by default; set `NUXT_MYSQL_SSL_REJECT_UNAUTHORIZED=false` for servers whose certificate can't be verified against a public CA

### Bug Fixes
- Fixed the page title showing `undefined` (e.g. "Board | undefined"): the `titleTemplate` in `nuxt.config.ts` was built from `process.env.NUXT_APP_NAME` at build time (when the env var isn't set) and had an operator-precedence bug that defeated its fallback. The title is now driven entirely by a runtime `titleTemplate` in `app.vue` sourced from `runtimeConfig` (`NUXT_APP_NAME`) — so a custom app name applies at runtime, pages render as "<page> | <appName>", and title-less pages fall back to just "<appName>". The duplicate `app.head` block was also removed
- Removed a duplicate `site` block in `nuxt.config.ts` that hardcoded a specific domain/locale and silently overrode the env-based one; the remaining `site` config now derives from `NUXT_BOARDS_URL` / `NUXT_APP_NAME` / `NUXT_LANGUAGE`
- The `Dockerfile` now declares `/app/public/uploads` as a volume and makes it writable by the non-root user, so uploaded files persist across container recreations and no longer hit a permission error when written by the `nodejs` user
- The Docker container now applies configuration from a mounted `/app/.env` file at runtime. Nuxt's production server only reads real environment variables (it does not auto-load `.env` like the dev server), so a mounted `.env` was previously ignored and the app fell back to the image's baked defaults. Real environment variables still take precedence over the file. Set `ENV_FILE` to use a different path

### Documentation
- Expanded the docs "Getting started" page with the `NUXT_MYSQL_SSL` env variable and a "Run with Docker" section covering the Docker Hub image, building from the `Dockerfile` with `docker buildx`, and how configuration is applied at runtime

## v0.15.1 - Security Hotfix

### Security Fixes
- Pinned `esbuild` to `0.28.1` via npm `overrides` (app and docs) to resolve [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) — arbitrary file read via the dev server on Windows, affecting `0.27.3`–`0.28.0`. Dependabot flagged the nested `esbuild@0.27.7` copies that older sub-dependencies pinned in `docs/package-lock.json`. (esbuild is a build/dev-time dependency and is not part of the production server output.)
- Pinned `ws` to `8.21.0` via npm `overrides` (app and docs) to resolve [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) — memory-exhaustion DoS, affecting the nested `ws@8.20.1` pulled in via `engine.io-client` in `docs/package-lock.json`. Both projects now report zero npm audit vulnerabilities.

## v0.15.0

### New Features
- Open images in comments or card description on click in the new `ImageWindow.vue` component
- Created a `Dockerfile` file
- Created a `.dockerignore` file
- Created a `docker-entrypoint.sh`

### Improvements
- Changed the `NotificationBell` unread indicator dot from `secondary` to `primary`
- Headlines no longer use the accent color (`text-primary`); they now render in a neutral near-black/white (`text-dark dark:text-white`). The accent `text-secondary` color is now used exclusively for hover states (required-field markers, error text, editor active-state, and inline links switched to `text-primary`)
- Replaced the default green color scheme with a neutral, Apple-style palette (blue accent, true-gray surfaces, light-gray `slate`) for both light and dark mode, with WCAG-checked contrast. Defaults updated in `nuxt.config.ts`, `app/assets/css/main.css`, and the `adjust-colors` docs; colors remain overridable via the `NUXT_PUBLIC_COLOR_*` environment variables
- Card descriptions now show a read-only view with an "edit description" button for write-access users instead of always showing the editor; the editor only opens immediately for a freshly created card opened for the first time (new `editDescription` translation added for all languages)
- Eliminated the layout shift when opening a card: `/api/data/cards` now prefetches each card's comments and attachment metadata, and `CardModal` renders instantly from the already-loaded board data instead of fetching on open
- Added a `/api/data/attachment` endpoint to fetch a single attachment's file payload on download, keeping the board response lean
- Removed the remaining modal shift by dropping the `await useFetch("/api/auth/get-session")` from `CommentSection` and `NewCommentForm` (which made them render a tick late); the current user id is now passed down from the board

### Bug Fixes
- Fixed duplicated cards/areas/comments from real-time updates: `Connection` and `CommentConnection` registered their socket listeners inside the `connect` handler, so every reconnect (and every card-modal open) stacked another set that was never removed. Listeners are now registered once and cleaned up on unmount
- Added an idempotency guard in the board's `card-created` handler so a card received more than once is updated in place instead of inserted again
- Code blocks in `CardEditor` now wrap long lines instead of overflowing the modal
- Code blocks (and inline code) are now visually highlighted with dedicated colors in both light and dark mode

### Improvements
- `Dockerfile` now pins its build stage to `$BUILDPLATFORM` so the build toolchain (esbuild/Vite) runs natively when cross-building, instead of under QEMU emulation (which crashed with random segfaults); only the final runtime image targets the requested platform

### Documentation
- Added a "Run with Docker" section to the README covering the Docker Hub image (`localboards/localboards`), a `docker run` example, and a Docker Compose setup that includes MySQL
- Updated the README Docker section to build images with `docker buildx --platform`, fixing the `Exec format error` that occurs when an `arm64` image (e.g. built on Apple Silicon) is deployed to an `amd64` server

### Dependencies
- Upgraded: nuxt, @tiptap/extension-emoji, @tiptap/extension-file-handler, @tiptap/extension-image, @tiptap/pm, @tiptap/starter-kit, @tiptap/vue-3, mysql2, nodemailer
- Droped: sass-embedded
- Upgraded docs: nuxt, @nuxtjs/seo

## v0.14.0

### New Features
- Added customizable colors via environment variables — see [color customization documentation](https://localboards.de/docs/adjust-colors)

### Dependencies
- Upgraded: mysql2, nodemailer

## v0.13.2

### Dependencies
- Docs dependencies upgraded: nuxt, @nuxt/content, better-sqlite3

## v0.13.1

### Bug Fixes
- Set scheduldedTask back to once an hour at minute "0". Was set to "12" in last version for testing reasons.

### Dependencies
- Upgraded: nuxt, @nuxtjs/i18n, @nuxtjs/mcp-toolkit, @tiptap/extension-emoji, @tiptap/extension-file-handler, @tiptap/extension-image, @tiptap/pm, @tiptap/starter-kit, @tiptap/vue-3

## v0.13.0

### New Features
- Added `card` URL parameter on board pages to directly open a specific card when the page loads
- Added direct links to boards and cards from notifications in `NotificationBell`

### Improvements
- Enhanced new card notifications to include the creator's username and the board name
- Increased spacing between individual notifications in notification emails

### Dependencies
- Upgraded: nuxt, @tiptap/extension-emoji, @tiptap/extension-file-handler, @tiptap/extension-image, @tiptap/pm @tiptap/starter-kit, @tiptap/vue-3

## v0.12.2 - Security Hotfix

### Security Fixes
- Fixed new ReDoS vulnerability in comment checklist validation by using a non-ambiguous regex pattern that prevents catastrophic backtracking (https://github.com/florian-strasser/LocalBoards/security/code-scanning/4)

## v0.12.1 - Security Hotfix

### Security Fixes
- Fixed ReDoS vulnerability in comment checklist validation by replacing ambiguous nested regex quantifiers with a safer pattern that prevents catastrophic backtracking (https://github.com/florian-strasser/LocalBoards/security/code-scanning/2, https://github.com/florian-strasser/LocalBoards/security/code-scanning/3)

## v0.12.0

### New Features
- Added support for toggling checklist item states in comments — users can now check/uncheck task items, with the API validating that only the checked state (`data-checked` and `checked` attributes) has changed

### Improvements
- Disabled scroll on body when `ModalWindow` is activated
- Added a hover state for links within card description or comments
- Removed footer with copyright information, since it steals space especially on the board pages

### Bug Fixes
- `/api/auth/api-key/create`: Returns now correctly the generated `key`

### Dependencies
- Upgraded: @nuxtjs/mcp-toolkit, tailwindcss, @tailwindcss/vite, @tiptap/extension-emoji, @tiptap/extension-file-handler, @tiptap/extension-image, @tiptap/pm, @tiptap/starter-kit, @tiptap/vue-3

### Docs
- Added PUT, PATCH and DELETE method documentation for comment API endpoint in `docs/content/api/comment.md`

## v0.11.3

### New Features
- Added inline confirmation dialog for comment deletion in `CommentSection.vue` — clicking the trash icon now shows "Are you sure?" with Delete/Cancel buttons, preventing accidental deletions
- Added inline comment editing in `CommentSection.vue` — comment creators can click the pen icon to edit using the `CardEditor` component, with Save/Cancel buttons
- Added PUT endpoint in `server/api/data/comment.ts` for updating comments, restricted to comment creators only
- Added real-time comment update synchronization via `CommentConnection` component and socket.io (`commentUpdated`/`updateComment` events)

### Improvements
- Changed all error messages in `server/api/auth/sign-in.ts` to return snake_case error codes (e.g., `method_not_allowed`, `invalid_credentials`) instead of descriptive messages, improving consistency and i18n support
- Added translations for all sign-in error codes (`error_method_not_allowed`, `error_required_fields_missing`, `error_invalid_credentials`, `error_invalid_email_or_password`, `error_authentication_failed`, `error_internal_server_error`) to all 7 locale files (en, de, es, fr, it, nl, pl)

### Bug Fixes
- Fixed duplicate comment entries in `CommentSection.vue` by adding existence check in `handleCommentCreated` before unshifting new comments to the array

### Dependencies
- Upgraded: nuxt, nodemailer, @tiptap/vue-3, @tiptap/starter-kit, @tiptap/pm, @tiptap/extension-image, @tiptap/extension-file-handler, @tiptap/extension-emoji

## v0.11.2

### Security Fixes
- **XSS Protection**: Strengthened URL scheme validation for user profile images in `server/api/auth/update-user.ts` to block `javascript:`, `vbscript:`, and non-image `data:` URIs (e.g., `data:text/html`). Only `http:`, `https:`, `data:image/*`, and relative paths are now permitted. Addresses Dependabot security advisory regarding executable URL schemes.

## v0.11.1

### Hotfix
- Fixed session creation failure for installations with numeric user IDs by removing strict UUID validation in `server/utils/auth.ts` createSession function

## v0.11.0

This release is all around security. I spent alot time to make every single API Endpoint more secure.

### New Features
- Added comment deletion capability in `server/api/data/comment.ts` with DELETE endpoint for comment creators
- Added delete button in `CommentSection.vue` with i18n translation key "deleteMessage" (added to all 7 language files)
- Added `handleCommentDeleted` in `CardModal.vue` to update comment count on deletion
- Real-time sync: comment deletion and count updates broadcast via socket events

### Authentication & Authorization (Applied to all data endpoints)
- Added early authentication checks blocking unauthenticated access to: `area.ts`, `areas.ts`, `board.ts`, `boards.ts`, `card.ts`, `cards.ts`, `cardMove.ts`, `cardOrder.ts`, `comment.ts`, `invite.ts`, `notifications.ts`
- Added userId null checks for defense in depth in all data endpoints before SQL queries
- Removed redundant inner authentication checks throughout all endpoints

### IDOR (Insecure Direct Object Reference) Fixes
- Fixed IDOR in `api/data/area` POST by adding board verification to area SELECT queries
- Hardened DELETE authorization in `api/data/area` to only allow board owners and edit-invited users
- Fixed IDOR in `api/data/board` GET and DELETE by removing query userId parameter and using authenticated userId
- Fixed IDOR in `api/data/boards` GET by using authenticated userId instead of client-provided userId from body
- Fixed IDOR in `api/data/card` POST by removing user parameter from body and using authenticated userId for notifications
- Fixed IDOR in `api/data/cardMove` by implementing access checks for both source AND destination boards
- Fixed IDOR in `api/data/comment` POST by removing user parameter from body and using authenticated userId
- Fixed IDOR in `api/data/invite` GET by removing client-provided userId from query and using authenticated userId
- Fixed IDOR in `api/data/invite` DELETE by validating invitation exists before deletion
- Fixed IDOR in `api/data/notifications` GET and PATCH by using authenticated userId instead of client-provided userId

### Input Validation (Applied across all data endpoints)
- Added boardId, areaId, cardId, card, content, notificationId parameter validation to ensure positive integers
- Added validation for shared parameter in `api/data/boards` to ensure proper boolean handling
- Added boardId input validation in `api/data/invite` to ensure positive integer
- Fixed undefined boardId variable in `api/data/cardOrder` socket event emit
- Updated `InviteModal.vue` to use boardId and userId (instead of deleteUser) in DELETE request URL
- Added Number() conversion for boardId prop in `InviteModal.vue`

### Information Leakage Prevention
- Changed all error messages from specific ("Board not found", "Card not found", "Area ID is required") to generic "Resource not found" or "Invalid request" in all data endpoints to prevent enumeration
- Fixed internal error details leakage in `api/data/cardOrder` inner catch handler
- Fixed typo in `api/data/cardOrder` error message from "Internal Server error" to "Internal server error"
- Fixed internal error details leakage in `api/data/comment` by removing details from error response
- Removed client-provided userId parameter from `api/data/notifications` GET endpoint

### Session Management Endpoints
- Fixed missing import in `api/auth/sign-in` by uncommenting createSession import
- Fixed HTTP status code in `api/auth/sign-in` and `api/auth/sign-up` from 403 to 405 Method Not Allowed for non-POST requests
- Added input validation in `api/auth/sign-in` for email format and minimum password length
- Fixed timing attack vulnerability in `api/auth/sign-in` by adding constant-time bcrypt comparisons for non-existent users and accounts
- Fixed CRITICAL session token leakage in `api/auth/get-session` by removing token from response data
- Fixed banned user information disclosure in `api/auth/get-session` by removing banReason and banExpires from response
- Fixed missing import in `api/auth/get-session` by adding getCookie and bcrypt imports
- Added session token format validation in `api/auth/get-session` to reject malformed tokens
- Added timing attack protection in `api/auth/get-session` with constant-time bcrypt comparisons for failed session and user lookups
- Fixed information leakage in `api/auth/sign-out` by using generic "Logout failed" error message
- Added session token format validation in `api/auth/sign-out` to reject malformed tokens
- Fixed session enumeration in `api/auth/sign-out` by checking affectedRows before returning success

### User Registration & Password Management
- Fixed timing attack vulnerability in `api/auth/sign-up` by adding constant-time bcrypt comparisons for existing email checks
- Added input validation in `api/auth/sign-up` for email format, password length (min 8 chars), and required fields
- Added database transaction in `api/auth/sign-up` for atomic user and account creation
- Fixed silent error swallowing in `api/auth/sign-up` session check to properly log errors
- Fixed timing attack vulnerability in `api/auth/request-password` by always generating token and using same code path regardless of user existence
- Added strong email validation regex in `api/auth/request-password` replacing weak `includes(@)` check
- Fixed inconsistent success messages in `api/auth/request-password` by always returning same message (prevents user enumeration)
- Fixed timing attack vulnerability in `api/auth/reset-password` by adding constant-time bcrypt comparisons for token and user existence checks
- Added token format validation (UUID v4 regex) in `api/auth/reset-password` to reject malformed tokens
- Changed error messages in `api/auth/reset-password` to generic INVALID_TOKEN, INVALID_PASSWORD, INTERNAL_SERVER_ERROR for consistent translation keys
- Changed success message in `api/auth/reset-password` to PASSWORD_RESET_SUCCESSFUL for translation consistency

### User Profile & Password Update
- Applied generic error messages in `api/auth/update-user` (maintaining raw format for translation keys)
- Added image field validation in `api/auth/update-user` to accept http/https URLs, base64 data URIs, relative paths (/, ./, ../), or null while blocking dangerous schemes like javascript:
- Added image size limit (1MB) in `api/auth/update-user` to prevent DoS attacks with huge base64 strings
- Fixed timing attack vulnerability in `api/auth/update-password` by adding constant-time bcrypt comparisons for account existence check
- Added password inequality check in `api/auth/update-password` by checking old !== new password and returning OLD_NEW_SAME error
- Fixed undefined SQL parameter error in `api/auth/update-password` by getting current session token directly from request (cookie/Authorization header) instead of from session object
- Updated error messages in `api/auth/update-password` to BOTH_PASSWORDS_REQUIRED, PASSWORD_TOO_SHORT, OLD_NEW_SAME for clearer translation keys
- Fixed ZodError handling in `PasswordForm.vue` by removing incorrect JSON.parse call and using `e.errors[0]?.code` directly

### Admin Endpoints
- Applied generic error codes and input validation across all admin endpoints (`create`, `list`, `update`, `delete`)
- Added UUID validation for userId in `admin/create`, `admin/update`, `admin/delete`
- Added strong email validation regex in `admin/create` and `admin/update`
- Added input length limits (255 chars) for name, email, password in `admin/create` and `admin/update`
- Added database transactions in `admin/create`, `admin/update`, `admin/delete` for atomic operations with proper rollback
- Added timing attack protection with constant-time bcrypt comparisons in `admin/create`, `admin/update`, `admin/delete`

### API Key Management
- Fixed CRITICAL security vulnerability in `api/auth/api-key/create` by removing full API key secret from response (now returns only id, name, start prefix, expiresAt)
- Fixed response ID issue in `api-key/create` by returning actual database ID
- Added input validation with name length limit (255 chars) in `api-key/create`
- Added expiresIn validation (positive number, max 365 days) in `api-key/create`
- Applied generic error codes in `api-key/create`, `api-key/list`, `api-key/delete`
- Added UUID validation for keyId in `api-key/delete` to reject malformed IDs
- Fixed information leakage in `api-key/delete` by removing ownership-revealing message
- Added timing attack protection with constant-time bcrypt comparisons in `api-key/delete`
- Fixed specific error message in `api/auth/api-key/delete` that revealed key ownership ("API key not found or doesn't belong to you" → "API_KEY_NOT_FOUND")

### Utility Functions (`server/utils/auth.ts`)
- Fixed timing attack vulnerability in verifyApiKey by adding constant-time bcrypt comparisons for both key existence and expiration checks
- Fixed information leakage in verifyApiKey by using generic error codes (INVALID_API_KEY, API_KEY_VERIFICATION_FAILED) instead of specific messages
- Added API key input validation in verifyApiKey with length limit (64 chars) to prevent abuse
- Added userId UUID validation in createSession to reject malformed user IDs
- Fixed information leakage in createSession by using generic error code SESSION_CREATION_FAILED instead of "Failed to create session"

### File Upload Security
- Fixed CRITICAL unauthenticated file upload in `server/api/upload/image.post.ts` by adding early authentication check (session or API key required)
- Fixed missing file validation in `server/api/upload/image.post.ts` by adding magic bytes verification to prevent MIME type spoofing
- Fixed insufficient file type validation in `server/api/upload/image.post.ts` by restricting to whitelisted types (png, jpg, jpeg, gif, webp)
- Fixed file extension spoofing in `server/api/upload/image.post.ts` by using validated MIME type for extension instead of user-provided filename
- Added file size limit (10MB) in `server/api/upload/image.post.ts` to prevent DoS via large uploads
- Fixed information leakage in `server/api/upload/image.post.ts` by removing original filename from response and using generic error messages
- Added user authentication context in `server/api/upload/image.post.ts` by importing and using getSession and getApiKeyUser for auth verification
- Fixed CRITICAL unauthenticated file upload in `server/api/upload.post.ts` by adding early authentication check (session or API key required)
- Fixed missing file validation in `server/api/upload/post.ts` by adding magic bytes verification for all allowed file types (PDF, DOC, DOCX, XLS, XLSX, CSV, PPT, PPTX, JPEG, PNG, ZIP) to prevent MIME type spoofing
- Fixed file extension spoofing in `server/api/upload/post.ts` by using validated file type for extension instead of user-provided filename
- Added file size limit (50MB) in `server/api/upload.post.ts` to prevent DoS via large uploads
- Fixed information leakage in `server/api/upload/post.ts` by removing original filename from response and using generic error messages
- Added user authentication context in `server/api/upload/post.ts` by importing and using getSession and getApiKeyUser for auth verification

### File Serving Security
- Fixed path traversal vulnerability in `server/api/uploads/[...path].ts` by using path.normalize and path.resolve with directory boundary check
- Fixed information leakage in `server/api/uploads/[...path].ts` by using generic error messages ("Invalid request", "Resource not found", "Download failed") instead of specific ones
- Fixed filename leakage in `server/api/uploads/[...path].ts` Content-Disposition header by using safe basename from resolved path instead of user-provided path

### Dependencies
- Updated @nuxtjs/mcp-toolkit
- Updated @nuxtjs/i18n
- Updated @tailwindcss/vite
- Updated tailwindcss
- Updated mysql2

## v0.10.1

### Webapp
- Fixed an issue with additional ":" characters in some notification mails
- Added missing paragraph elements in notification mails
- Removed unnecessary dependencies
- Updated dependencies

### Docs
- Updated migration docs
- Removed unnecessary dependencies
- Updated dependencies

## v0.10.0 - Complete Authentication System Overhaul

### 🚀 Major Architecture Change: Dropped better-auth
**Breaking Change**: Replaced entire `better-auth` dependency with custom authentication system for improved reliability, performance, and maintainability. Backup your database and merge it with the adjusted structure. User passwords need to be reseted.

### 🔄 Real-Time Event Enhancements
**Multi-Platform Real-Time Updates**: Extended existing Socket.IO event system to API and MCP tools, ensuring consistent real-time updates across all interaction methods.

### 📡 Real-Time Events Extended to API & MCP
- **Card Operations**: `addCard`, `updateCard`, `deleteCard`, `moveCard` events
- **Area Operations**: `addArea`, `updateArea`, `deleteArea`, `updateAreas` events  
- **Board Operations**: `updateBoard`, `deletedBoard` events
- **Comment Operations**: `addComment` events
- **Multiplayer Collaboration**: Real-time updates for opened cards (title, content, attachments)

### 🔧 Authentication Core (Replaced better-auth)
- **Session Management**: Custom session creation, validation, and destruction
- **Performance**: No external auth server dependency
- **Endpoints Created**:
  - `/api/auth/sign-in` - User login with session creation
  - `/api/auth/sign-up` - User registration with auto-login
  - `/api/auth/logout` - Session termination
  - `/api/auth/get-session` - Session validation middleware

### 👤 User Management
- **Profile Updates**: `/api/auth/update-user` endpoint
- **Password Changes**: `/api/auth/update-password` endpoint
- **Admin Functions**: Complete admin user CRUD operations
  - `/api/auth/admin/create` - Admin user creation
  - `/api/auth/admin/list` - User listing
  - `/api/auth/admin/update` - User updates
  - `/api/auth/admin/delete` - User deletion

### 🔑 API Key Management
- **Generation**: `/api/auth/api-key/create` endpoint
- **Listing**: `/api/auth/api-key/list` endpoint  
- **Deletion**: `/api/auth/api-key/delete` endpoint
- **Security**: Proper ownership validation and cleanup

### 🔒 Password Reset System
- **Request Reset**: `/api/auth/request-password` endpoint
- **Complete Reset**: `/api/auth/reset-password` endpoint
- **Email Integration**: Proper translated email sending
- **Token Security**: 24-hour expiration, one-time use

### 🌍 Internationalization
- **New Translation Keys**: Added to all 7 languages (en, de, es, fr, it, nl, pl)
- **Error Messages**: Comprehensive error translations for all endpoints
- **Email Translations**: Server-side translation utility for emails

### 📝 Component Updates
**Removed all `better-auth` dependencies and updated to use custom endpoints:**
- `SettingsForm.vue` - Profile updates
- `PasswordForm.vue` - Password changes
- `ApiForm.vue` - API key creation
- `ApiList.vue` - API key listing
- `ApiItem.vue` - API key deletion
- `UserList.vue` - User management
- `NewUserForm.vue` - User creation
- `EditUserForm.vue` - User profile editing
- `EditUserPassword.vue` - User password updates
- `lost-password.vue` - Password reset request
- `reset-password/[token].vue` - Password reset completion

### 🔧 Technical Improvements
- **Session Utility**: Created `server/utils/auth.ts` with reusable functions
- **Translation Utility**: Created `server/utils/translations.ts` for server-side emails
- **Middleware Updates**: Updated auth middleware for new session validation
- **Error Handling**: Consistent error responses across all endpoints
- **Security**: Proper input validation and sanitization

## v0.9.2

- Fixed issue with public registration, env variable was not checked correctly
- Board and user images are now also stored as physical files instead of Base64 decoded

## v0.9.1

- Fix: Required some changes to the creation of api keys
- Picked a better matching icon for commentCount

## v0.9.0

- /api/data/card.ts: Returns additionally commentCount and attachmentCount
- /api/data/cards.ts: Returns additionally commentCount and attachmentCount
- Multiplayer updates for title, content and attachments on opened cards
- Added comment and attachment count below the title on cards
- Update commentCount when a new comment is created
- Update attachmentCount when a new attachment is uploaded
- Updated all dependencies

## v0.8.1

### Bug Fixes

- Fixed an error with images in comments on the email notification. It was missing the baseURL.
- Resolved issue where notification messages were output as a by comma seperated string

## v0.8.0

### 🚀 Major Architecture Changes

**🔧 Storage System Overhaul**
- **Migrated from base64 to file-based storage**: Images and attachments are now uploaded to the server and stored as files rather than base64-encoded data in the database
- **Performance improvements**: Significantly reduces database size and improves API response times
- **Backward compatibility**: Existing base64-encoded attachments continue to function normally
- **Migration recommendation**: Consider recreating cards with new attachments to optimize database performance

### ✨ Enhancements

**📁 Expanded Attachment Support**
- Added support for **image files (JPG, PNG)** and **ZIP archives** as card attachments
- Images can now be attached directly to cards (previously only available in rich text content)

**🔄 Improved User Experience**
- Added **back button** to card delete confirmation dialog for easier navigation
- Added **back button** to attachments upload interface for better user flow

### 🐛 Bug Fixes

**🎨 Layout Improvements**
- **Fixed layout shift** in card modal caused by asynchronous comment section loading
- Comments now load before modal rendering to prevent visual jumping

**📧 Email Notifications**
- **Fixed notification email formatting**: Properly joins notification messages array into readable text
- Resolved issue where notification messages were output as raw array

## v0.7.3

Quick-Hotfix: Disabling the signup functionality with flag `NUXT_PUBLIC_SIGNUP` caused some issues

## v0.7.2

### Improvements
- Introduced an enviroment variable `NUXT_PUBLIC_SIGNUP` to enable or disable the signup functionality

### Fixes
- Solved problems with the comment notifications when they contained an image
- API Endpoint returned an error when trying to create a notification with too long text, especially in the case of comments with screenshots, since it was defined as `TEXT` column instead of `LONGTEXT`
- Fetching invites when opening a board, instead of when opening the inviteModal. Removes an unnecessary layout shift.

### Docs

- Introduced new page disable-signup

## v0.7.1

- Fix: Changing a cards description after uploading an attachment caused duplicates
- Fix: Set modal window background to position fixed
- Fix: Dark background of "adding an attachment" option on the card modal window was overlapping with the modal box rounded corners

## v0.7.0

- Introduced non image attachments to cards. You can now add PDF, DOCX, PPTX, CSV etc. to a card.
- Long titles have been cut off on card modal window, fixed by switch from input "text" to an editable div
- Updated  dependencies (better-auth)

## v0.6.1

- Added Emoji-Support (@tiptap/extension-emoji)
- Completed the documentation for API
- Slightly adjusted the featurelist on docs landingpage
- Updated dependencies (nuxt, better-auth, @nuxtjs/i18n)

## v0.6.0

- Installed MCP-Toolkit
- Introduced a `NUXT_MCP` flag to disable the MCP Server entirely
- Added a `createArea` tool for the MCP Server, to create a new area on an existing board
- Added a `createBoard` tool for the MCP Server, to create a new board
- Added a `createCard` tool for the MCP Server, to create a new card in an existing area
- Added a `deleteArea` tool for the MCP Server, to delete an area
- Added a `deleteBoard` tool for the MCP Server, to delete a board
- Added a `deleteCard` tool for the MCP Server, to delete a card
- Added a `getArea` tool for the MCP Server, to fetch a specific area
- Added a `getBoard` tool for the MCP Server, to fetch a specific board
- Added a `getCard` tool for the MCP Server, to fetch a specific card
- Added a `listAreas` tool for the MCP Server, to expose all available areas on an existing board
- Added a `listBoards` tool for the MCP Server, to expose all available boards of the user
- Added a `listCards` tool for the MCP Server, to expose all available cards in an area
- Added a `listComments` tool for the MCP Server, to expose all available comments on a card
- Added a `moveAreas` tool for the MCP Server, to update the order of areas in a board
- Added a `moveCard` tool for the MCP Server, to move a card from one area to another
- Added a `orderCard` tool for the MCP Server, to update the order of cards in an area
- Added a `updateArea` tool for the MCP Server, to update an existing area
- Added a `updateBoard` tool for the MCP Server, to update an existing board
- Added a `updateCard` tool for the MCP Server, to update an existing card
- Added a `writeComment` tool for the MCP Server, to create a new comment on a card
- Added a MCP-Server page to the docs
- Improved comment notification, includes the content and name of the content creator
- Switched to a HTML from plain text for mails
- Fixed an issue with the dark background of a card modal window. Users have not been able to close the card by clicking on this backgrond.

## v0.5.7

- Adjusted query keys for docs to prevent issues when built static
- Fixed mobile issues for docs
- Optimized accessibility for docs
- Optimized SEO for docs

## v0.5.6

- Fixed a issue that prevented to save a board when no image was
provided

## v0.5.5

- Allows the upload or selection of an thumbnail for a board
- Added 6 board placeholder images to the public folder
- Add a screenshot to the landingpage
- Add a screenshot to the README.md file

## v0.5.4

- Created a first version of documentation with nuxt/content in docs folder
- Removed `pointer-events-auto` class from ModalWindow Component due to mobile problems
- Adjusted minimum screen size to `min-h-svh` instead of `min-h-screen` due to mobile problems
- Adjusted slate color in bright theme

## v0.5.3

- Added an delete button for cards
- Changed the color of the status checkbox to primary color
- Minimal updates to the color schemes
- Removed relict api route: api/upload/image.ts
- Added a new touchicon
- Introduced a CHANGELOG.md file
- Updated dependencies

## 0.5.2

- Fixed a small issue with the invite system after the API Access was introduced.

## 0.5.1

- We introduced a dark mode. If the device prefers a dark scheme we show it to the user. Otherwise they will still see the bright layout.

## 0.5.0

- You can now generate API keys with the same permissions as your user account. This enables you to build custom tools and automate workflows, making your experience with LocalBoards even more powerful and efficient.
