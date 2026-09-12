// Seeds the demo database with placeholder data (users, boards, areas, cards,
// comments, an image attachment and notifications). The schema must already
// exist — the app's migrations create it on server startup, which run.sh does
// before calling this. Connection is configured via env (see defaults below).
//
// SAFETY: this TRUNCATEs tables, so it refuses to run against a database whose
// name doesn't look like a throwaway ("demo"/"test") unless DEMO_DB_FORCE=1.
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const cfg = {
  host: process.env.DEMO_DB_HOST ?? "127.0.0.1",
  user: process.env.DEMO_DB_USER ?? "root",
  password: process.env.DEMO_DB_PASS ?? "root1234",
  database: process.env.DEMO_DB_NAME ?? "lokalboards_demo",
};

if (!/demo|test/i.test(cfg.database) && process.env.DEMO_DB_FORCE !== "1") {
  console.error(
    `Refusing to seed "${cfg.database}" — the name doesn't look like a throwaway ` +
      `database (expected "demo"/"test"). Set DEMO_DB_FORCE=1 to override.`,
  );
  process.exit(1);
}

const db = await mysql.createConnection({ ...cfg, multipleStatements: true });

const mockupB64 = readFileSync(new URL("./mockup.png", import.meta.url)).toString("base64");
const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const days = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

// The server creates the schema on startup, and answers requests before it has
// finished: run.sh waits for the port, which is not the same as waiting for the
// last migration. Wait for the table the newest one adds, or the seed races it
// and falls over on whichever table was added most recently.
const LAST_MIGRATION = "0027";
for (let i = 0; i < 240; i++) {
  const [rows] = await db
    .query("SELECT 1 FROM `migrations` WHERE `id` LIKE ?", [`${LAST_MIGRATION}%`])
    .catch(() => [[]]);
  if (rows.length) break;
  if (i === 239) {
    console.error(`Gave up waiting for migration ${LAST_MIGRATION} to be applied.`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 250));
}

// Clean slate.
await db.query("SET FOREIGN_KEY_CHECKS=0");
for (const t of ["user","session","boards","areas","cards","card_labels","labels","comments","attachments","invitations","notifications"]) {
  await db.query(`TRUNCATE TABLE \`${t}\``);
}
await db.query("SET FOREIGN_KEY_CHECKS=1");

// --- Users ---
await db.query(
  "INSERT INTO `user` (id,name,email,emailVerified,image,role,onboarded) VALUES ?",
  [[
    ["u-alex","Alex Morgan","alex@demo.local",1,"/images/profile_placeholder_01.webp","admin",1],
    ["u-ben","Ben Schmidt","ben@demo.local",1,"/images/profile_placeholder_02.webp","user",1],
    ["u-carol","Carol Nguyen","carol@demo.local",1,"/images/profile_placeholder_03.webp","user",1],
  ]],
);

// Session for Alex (the account the screenshots are taken as). The token is
// fixed so the screenshot script can authenticate by setting the cookie.
await db.query(
  "INSERT INTO `session` (id,expiresAt,token,userId) VALUES (?,?,?,?)",
  ["demo-sess-alex", future, process.env.DEMO_TOKEN ?? "demo-token-alex", "u-alex"],
);

// --- Boards ---
await db.query(
  "INSERT INTO `boards` (id,user,name,style,status,image) VALUES ?",
  [[
    [1,"u-alex","Product Roadmap","kanban","public","/images/board_placeholder_01.webp"],
    [2,"u-alex","Website Relaunch","kanban","private","/images/board_placeholder_04.webp"],
    [3,"u-alex","Personal Tasks","todo","private","/images/board_placeholder_06.webp"],
    [4,"u-ben","Marketing Ideas","kanban","private","/images/board_placeholder_03.webp"],
  ]],
);

// Collaborators / shares.
await db.query(
  "INSERT INTO `invitations` (board,user,permission) VALUES ?",
  [[
    [1,"u-ben","edit"],
    [1,"u-carol","read"],
    [4,"u-alex","edit"], // makes "Marketing Ideas" show under Alex's shared boards
  ]],
);

// --- Areas ---
await db.query(
  "INSERT INTO `areas` (id,board,name,sort) VALUES ?",
  [[
    [1,1,"Backlog",0],
    [2,1,"In Progress",1],
    [3,1,"Done",2],
    [4,2,"Design",0],
    [5,3,"This Week",0],
    [6,4,"Ideas",0],
  ]],
);

const richDesc =
  "Refresh the brand mark for the 2.0 launch. Keep it **simple** and _legible_ at small sizes.\n\n" +
  "### Requirements\n\n" +
  "- Works on light and dark backgrounds\n" +
  "- Scales down to a 16px favicon\n\n" +
  "- [x] Collect references\n" +
  "- [ ] First round of concepts\n" +
  "- [ ] Team review";

// --- Cards ---  [id, area, name, sort, content, status, dueDate, assignee]
await db.query(
  "INSERT INTO `cards` (id,area,name,sort,content,status,dueDate,assignee) VALUES ?",
  [[
    // Board 1 carries a full workload rather than a token card or two: it is
    // the board in the homepage hero, and a nearly empty one there would say
    // the wrong thing about what this is for.
    [1,1,"Competitor research",0,"Analyse the top five competitors and summarise their pricing.",0,null,null],
    [2,1,"Redesign the logo",1,richDesc,0,days(5),"u-ben"],
    [3,1,"Draft the pricing page",2,"Three tiers: Free, Pro, Team.",0,days(9),null],
    [14,1,"Write the launch announcement",3,"Blog post and the mail to existing customers.",0,null,null],
    [15,1,"Audit the onboarding e-mails",4,"- [x] Welcome\n- [ ] Password reset\n- [ ] Invitation",0,days(6),"u-carol"],
    [16,1,"Plan the Q4 roadmap workshop",5,"Half a day, everyone, agenda beforehand.",0,days(14),null],
    [17,1,"Collect customer feedback",6,"Ten interviews, fifteen minutes each.",0,null,null],
    [18,1,"Sketch the mobile navigation",7,"",0,null,null],
    [19,1,"Review the accessibility report",8,"Contrast and focus order, mostly.",0,days(11),null],
    [20,1,"Evaluate a status page provider",9,"",0,null,null],

    [4,2,"Build the public API",0,"- [x] Boards\n- [x] Cards\n- [ ] Comments",0,days(3),"u-alex"],
    [5,2,"New onboarding flow",1,"A three-step guided tour for first-time users.",0,null,null],
    [21,2,"Migrate to the new mail provider",2,"Move the templates over and reverify the domain.",0,days(4),"u-ben"],
    [22,2,"Rework the settings screen",3,"- [x] Group the sections\n- [ ] Move the danger zone",0,days(7),"u-carol"],
    [23,2,"Write the API documentation",4,"Every endpoint, with an example request.",0,days(8),null],
    [24,2,"Add board templates",5,"",0,null,null],
    [25,2,"Speed up the dashboard query",6,"It fans out one query per board.",0,null,null],
    [26,2,"Finish the Czech translation",7,"",0,null,null],

    [6,3,"Set up CI/CD",0,"Automated tests and deploys on every push.",1,null,null],
    [7,3,"Launch the landing page",1,"Ship the marketing site.",1,null,null],
    [27,3,"Ship the dark theme",2,"",1,null,null],
    [28,3,"Publish the Docker image",3,"Both architectures, on every tag.",1,null,null],
    [29,3,"Add two-factor sign-in",4,"- [x] TOTP\n- [x] Recovery codes",1,days(-3),"u-alex"],
    [30,3,"Import boards from Trello",5,"Lists, cards, checklists, comments, attachments.",1,null,null],
    [31,3,"Move attachments to disk",6,"",1,null,null],
    [32,3,"Wire up the webhooks",7,"- [x] Signing\n- [x] Retries",1,days(-1),"u-ben"],
    [8,4,"Website Relaunch: hero section",0,"Bold headline, product screenshot, one clear call to action.",0,null,null],
    [9,5,"Buy groceries",0,"Milk, bread, coffee.",0,null,null],
    [10,5,"Call the dentist",1,"",0,days(1),null],
    [11,5,"Finish the quarterly report",2,"Numbers are in the shared drive.",1,null,null],
    [12,6,"Referral programme",0,"Give a month free for every friend invited.",0,null,null],
    [13,6,"Launch a newsletter",1,"",0,null,null],
  ]],
);

// --- Labels on board 1 ---
// Words on cards rather than a palette to manage: the rows exist so the same
// word on two cards is one thing. Enough of them here that the guide's
// screenshots show the filter with something to filter by.
await db.query(
  "INSERT INTO `labels` (id,board,name,color,sort) VALUES ?",
  [[
    [1, 1, "Design", "#0066cc", 0],
    [2, 1, "Bug", "#0066cc", 1],
    [3, 1, "Documentation", "#0066cc", 2],
  ]],
);
await db.query(
  "INSERT INTO `card_labels` (card,label) VALUES ?",
  [[
    // Card 2 ("Redesign the logo") deliberately has none: it already carries a
    // checklist, comments, an attachment and a due date, and a label on top of
    // those is the one thing that pushes a tile onto a third row.
    [18, 1],
    [15, 2], [25, 2],
    [23, 3], [5, 3],
  ]],
);

// --- Attachment on the "Redesign the logo" card (image, opens in the lightbox) ---
await db.query(
  "INSERT INTO `attachments` (card,filename,filetype,filesize,filedata) VALUES (?,?,?,?,?)",
  [2,"logo-mockup.png","image/png",mockupB64.length,mockupB64],
);

// --- Comments on the "Redesign the logo" card ---
await db.query(
  "INSERT INTO `comments` (card,user,authorName,content,date) VALUES ?",
  [[
    [2,"u-ben",null,"Looks promising! Could we try a slightly darker blue?",days(-2)],
    [2,"u-alex",null,"Sure — I'll prepare a couple of logo options for the review.",days(-1)],
    [2,null,"Jordan Rivera","Imported from our old Trello board — keep the rounded corners 👍",days(-3)],
  ]],
);

// --- Notifications for Alex (unread → the bell shows a badge) ---
await db.query(
  "INSERT INTO `notifications` (userId,type,boardId,cardId,message,isRead) VALUES ?",
  [[
    ["u-alex","comment",1,2,'Ben Schmidt commented on "Redesign the logo"',0],
    ["u-alex","invitation",4,null,'Ben Schmidt invited you to "Marketing Ideas"',0],
    ["u-alex","card_created",1,3,'A new card "Draft the pricing page" was created',0],
  ]],
);

const [[{ c: users }]] = await db.query("SELECT COUNT(*) c FROM `user`");
const [[{ c: cards }]] = await db.query("SELECT COUNT(*) c FROM `cards`");
console.log(`seeded ${cfg.database}: ${users} users, ${cards} cards, boards 1-4`);
await db.end();
