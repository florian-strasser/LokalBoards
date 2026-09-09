import { createPool } from "mysql2/promise";
import { logger } from "../../server/utils/logger";

// Read DB config from Nuxt's runtimeConfig at runtime, falling back to
// process.env when it isn't available (e.g. integration tests that import this
// module outside the Nuxt/nitro context). `typeof` guards the auto-imported
// global so referencing it in a plain Node test doesn't throw.
const runtimeConfig: any =
  typeof useRuntimeConfig !== "undefined" ? useRuntimeConfig() : null;

const mysqlHost = runtimeConfig?.mysqlHost ?? process.env.NUXT_MYSQL_HOST;
const mysqlUser = runtimeConfig?.mysqlUser ?? process.env.NUXT_MYSQL_USER;
const mysqlPassword =
  runtimeConfig?.mysqlPassword ?? process.env.NUXT_MYSQL_PASSWORD;
const mysqlDatabase =
  runtimeConfig?.mysqlDatabase ?? process.env.NUXT_MYSQL_DATABASE;

// Enable TLS when the database server requires it (e.g. managed/external MySQL
// such as Mittwald). Opt-in via NUXT_MYSQL_SSL=true so local/compose MySQL
// without TLS keeps working. Certificate verification stays on by default;
// set NUXT_MYSQL_SSL_REJECT_UNAUTHORIZED=false only if the server presents a
// certificate that can't be verified against a public CA.
const mysqlSsl =
  String(
    runtimeConfig?.mysqlSsl ?? process.env.NUXT_MYSQL_SSL,
  ).toLowerCase() === "true";
const mysqlSslRejectUnauthorized =
  String(
    runtimeConfig?.mysqlSslRejectUnauthorized ??
      process.env.NUXT_MYSQL_SSL_REJECT_UNAUTHORIZED,
  ).toLowerCase() !== "false";

const db = createPool({
  host: mysqlHost,
  user: mysqlUser,
  password: mysqlPassword,
  database: mysqlDatabase,
  timezone: "Z", // mysql2 parses returned DATETIME/TIMESTAMP values as UTC
  ...(mysqlSsl
    ? { ssl: { rejectUnauthorized: mysqlSslRejectUnauthorized } }
    : {}),
});

// Force every pooled connection to UTC. The pool reads timestamps as UTC
// (`timezone: "Z"` above), so the MySQL session must also be UTC — otherwise the
// server's local session timezone (e.g. CEST) makes `CURRENT_TIMESTAMP`/`NOW()`
// return local time that mysql2 then reinterprets as UTC, shifting every stored
// timestamp (e.g. a comment posted at 00:56 showing as 02:56). `+00:00` is a
// fixed offset, so it works without MySQL's named-timezone tables being loaded.
db.on("connection", (connection: any) => {
  connection.query("SET time_zone = '+00:00';");
});

/**
 * Return the shared MySQL connection pool.
 *
 * The schema is created and kept up to date once at startup by `runMigrations()`
 * (invoked from the `server/plugins/0.database-migrate.ts` Nitro plugin), so
 * request handlers just grab the pool here instead of re-issuing DDL on every
 * call as this function used to.
 */
export function setupDatabase() {
  return db;
}

// --- Schema migrations -------------------------------------------------------

interface Migration {
  // Stable, ordered identifier. Never change an id once it has shipped.
  id: string;
  up: (db: any) => Promise<void>;
}

// A migration's id is recorded only after `up()` resolves, so a crash between
// two DDL statements re-runs the whole migration. MySQL has no
// "ADD COLUMN IF NOT EXISTS", so ask the catalogue instead of letting the retry
// die on "Duplicate column name" — which would wedge startup permanently.
async function columnExists(db: any, table: string, column: string) {
  const [rows]: any = await db.execute(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return rows.length > 0;
}

async function indexExists(db: any, table: string, index: string) {
  const [rows]: any = await db.execute(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, index],
  );
  return rows.length > 0;
}

// Ordered list of migrations. To evolve the schema, append a new entry — never
// edit or remove an existing one (it may already be applied in the wild).
const migrations: Migration[] = [
  {
    // Baseline schema. Uses CREATE TABLE IF NOT EXISTS so it is safe to run
    // against databases that already contain these tables (existing
    // deployments): it records the baseline as applied without altering them.
    id: "0001_baseline_schema",
    up: async (db) => {
      // account
      await db.execute(`CREATE TABLE IF NOT EXISTS \`account\` (
        \`id\` varchar(36) NOT NULL,
        \`accountId\` text NOT NULL,
        \`providerId\` text NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`password\` text,
        \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);

      // apikey
      await db.execute(`CREATE TABLE IF NOT EXISTS \`apikey\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` text,
        \`start\` text,
        \`prefix\` text,
        \`key\` varchar(255) NOT NULL,
        \`refillInterval\` int DEFAULT NULL,
        \`refillAmount\` int DEFAULT NULL,
        \`lastRefillAt\` timestamp(3) NULL DEFAULT NULL,
        \`enabled\` tinyint(1) DEFAULT NULL,
        \`rateLimitEnabled\` tinyint(1) DEFAULT NULL,
        \`rateLimitTimeWindow\` int DEFAULT NULL,
        \`rateLimitMax\` int DEFAULT NULL,
        \`requestCount\` int DEFAULT NULL,
        \`remaining\` int DEFAULT NULL,
        \`lastRequest\` timestamp(3) NULL DEFAULT NULL,
        \`expiresAt\` timestamp(3) NULL DEFAULT NULL,
        \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`permissions\` text,
        \`metadata\` text,
        \`configId\` varchar(255) NOT NULL DEFAULT 'default',
        \`referenceId\` varchar(255) NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);

      // boards
      await db.execute(`CREATE TABLE IF NOT EXISTS \`boards\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`name\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`style\` enum('kanban','todo','notices') COLLATE utf8mb4_general_ci DEFAULT 'kanban',
        \`status\` enum('private','public') COLLATE utf8mb4_general_ci DEFAULT 'private',
        \`image\` longtext COLLATE utf8mb4_general_ci,
        \`color\` varchar(7) COLLATE utf8mb4_general_ci DEFAULT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // areas
      await db.execute(`CREATE TABLE IF NOT EXISTS \`areas\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`board\` int NOT NULL,
        \`name\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`sort\` int DEFAULT '0',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // cards
      await db.execute(`CREATE TABLE IF NOT EXISTS \`cards\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`area\` int NOT NULL,
        \`name\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`sort\` int DEFAULT '0',
        \`content\` longtext COLLATE utf8mb4_general_ci,
        \`status\` tinyint(1) DEFAULT '0',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // attachments
      await db.execute(`CREATE TABLE IF NOT EXISTS \`attachments\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`card\` int NOT NULL,
        \`filename\` varchar(255) NOT NULL,
        \`filetype\` varchar(100) NOT NULL,
        \`filesize\` int NOT NULL,
        \`filedata\` longtext NOT NULL,
        \`createdAt\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);

      // comments
      await db.execute(`CREATE TABLE IF NOT EXISTS \`comments\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`card\` int NOT NULL,
        \`user\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
        \`content\` longtext COLLATE utf8mb4_general_ci,
        \`date\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // invitations
      await db.execute(`CREATE TABLE IF NOT EXISTS \`invitations\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`board\` int NOT NULL,
        \`user\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
        \`permission\` enum('read','edit') COLLATE utf8mb4_general_ci DEFAULT 'read',
        \`date\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // notifications
      await db.execute(`CREATE TABLE IF NOT EXISTS \`notifications\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
        \`type\` enum('invitation','comment','card_created','card_moved','card_status_changed') COLLATE utf8mb4_general_ci NOT NULL,
        \`boardId\` int DEFAULT NULL,
        \`cardId\` int DEFAULT NULL,
        \`message\` longtext COLLATE utf8mb4_general_ci,
        \`isRead\` tinyint(1) DEFAULT '0',
        \`createdAt\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // session
      await db.execute(`CREATE TABLE IF NOT EXISTS \`session\` (
        \`id\` varchar(36) NOT NULL,
        \`expiresAt\` timestamp(3) NOT NULL,
        \`token\` varchar(255) NOT NULL,
        \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`ipAddress\` text,
        \`userAgent\` text,
        \`userId\` varchar(36) NOT NULL,
        \`impersonatedBy\` text,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);

      // user
      await db.execute(`CREATE TABLE IF NOT EXISTS \`user\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`emailVerified\` tinyint(1) NOT NULL,
        \`image\` longtext,
        \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`role\` varchar(5) NOT NULL DEFAULT 'user',
        \`banned\` tinyint(1) DEFAULT NULL,
        \`banReason\` text,
        \`banExpires\` timestamp(3) NULL DEFAULT NULL,
        \`displayUsername\` text,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);

      // verification
      await db.execute(`CREATE TABLE IF NOT EXISTS \`verification\` (
        \`id\` varchar(36) NOT NULL,
        \`identifier\` varchar(255) NOT NULL,
        \`value\` text NOT NULL,
        \`expiresAt\` timestamp(3) NOT NULL,
        \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);
    },
  },

  {
    // Hash any API keys still stored in plaintext so the on-verify plaintext
    // fallback can be removed. Plaintext keys are 32-char tokens; SHA-256
    // digests are 64 hex chars, so LENGTH = 32 selects exactly the legacy rows.
    // MySQL's SHA2(x, 256) yields the same lowercase-hex digest as Node's
    // createHash('sha256') (see server/utils/apiKey.ts) for these ASCII tokens,
    // so migrated keys match what verifyApiKey computes. The `start` column
    // (first 8 plaintext chars, for display) is intentionally left untouched.
    id: "0002_hash_legacy_api_keys",
    up: async (db) => {
      await db.execute(
        "UPDATE `apikey` SET `key` = SHA2(`key`, 256) WHERE LENGTH(`key`) = 32",
      );
    },
  },

  {
    // Card due dates, assignment, and per-card reminder schedule.
    id: "0003_card_due_dates_and_assignment",
    up: async (db) => {
      await db.execute(
        "ALTER TABLE `cards` ADD COLUMN `dueDate` timestamp NULL DEFAULT NULL, ADD COLUMN `assignee` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL",
      );
      await db.execute(`CREATE TABLE IF NOT EXISTS \`card_reminders\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`card\` int NOT NULL,
        \`minutesBefore\` int NOT NULL,
        \`notified\` tinyint(1) NOT NULL DEFAULT '0',
        PRIMARY KEY (\`id\`),
        KEY \`card\` (\`card\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
      // Extend the notification type enum with the two new kinds.
      await db.execute(
        "ALTER TABLE `notifications` MODIFY COLUMN `type` enum('invitation','comment','card_created','card_moved','card_status_changed','card_due','card_assigned') COLLATE utf8mb4_general_ci NOT NULL",
      );
    },
  },

  {
    // First-run onboarding flag. Existing users are marked as already
    // onboarded, so only brand-new accounts see the guided tour.
    id: "0004_user_onboarded",
    up: async (db) => {
      await db.execute(
        "ALTER TABLE `user` ADD COLUMN `onboarded` tinyint(1) NOT NULL DEFAULT '0'",
      );
      await db.execute("UPDATE `user` SET `onboarded` = 1");
    },
  },

  {
    // Split "emailed" from "read" on notifications. Previously the hourly email
    // task set `isRead = TRUE` after sending, which doubled as the unread
    // indicator — so notifications self-cleared within an hour regardless of
    // whether the user had seen them. `notified` now tracks email dedup, leaving
    // `isRead` to mean "the user has actually viewed it" (opened the card, or the
    // board for non-card notifications). Existing already-emailed notifications
    // are marked notified so they aren't re-sent.
    id: "0005_notifications_notified_flag",
    up: async (db) => {
      await db.execute(
        "ALTER TABLE `notifications` ADD COLUMN `notified` tinyint(1) NOT NULL DEFAULT '0'",
      );
      await db.execute(
        "UPDATE `notifications` SET `notified` = 1 WHERE `isRead` = 1",
      );
    },
  },

  {
    // Preserve the original author's name on comments that aren't tied to a
    // local user account — currently comments imported from Trello, where the
    // Trello author has no LokalBoards account. Comment queries COALESCE this
    // after user.name, so normal comments (authorName NULL) are unaffected.
    id: "0006_comment_author_name",
    up: async (db) => {
      await db.execute(
        "ALTER TABLE `comments` ADD COLUMN `authorName` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL",
      );
    },
  },

  {
    // Card descriptions and comments are now stored as Markdown instead of
    // HTML (smaller, safe to render, native for AI agents via the MCP). Convert
    // existing HTML content in place, backing up the original HTML first so the
    // change is reversible. Fresh installs have no rows, so this is a no-op.
    id: "0007_content_html_to_markdown",
    up: async (db) => {
      // Deferred import so turndown/markdown-it aren't pulled into every
      // endpoint's module graph — only when this one-off migration runs.
      const { convertContentColumnsToMarkdown } =
        await import("./contentMarkdownMigration");
      await convertContentColumnsToMarkdown(db);
    },
  },

  {
    // Accounts can now be marked as non-human ("artificial") so AI agents get
    // their own identity — shown as a bot in the user list, on claimed cards and
    // in card presence. Only admins can create/change them (public signup always
    // creates humans). `emailNotifications` lets a user opt out of notification
    // mails; artificial accounts default to off since bots don't read email.
    id: "0008_user_type_and_email_prefs",
    up: async (db) => {
      if (!(await columnExists(db, "user", "type"))) {
        await db.execute(
          "ALTER TABLE `user` ADD COLUMN `type` varchar(10) NOT NULL DEFAULT 'human'",
        );
      }
      if (!(await columnExists(db, "user", "emailNotifications"))) {
        await db.execute(
          "ALTER TABLE `user` ADD COLUMN `emailNotifications` tinyint(1) NOT NULL DEFAULT '1'",
        );
      }
    },
  },

  {
    // Lets an agent retry createCard safely: re-sending the same key returns the
    // existing card instead of creating a duplicate. Unique per area; NULL is
    // allowed many times over (MySQL unique indexes ignore NULLs).
    id: "0009_card_idempotency_key",
    up: async (db) => {
      if (!(await columnExists(db, "cards", "idempotencyKey"))) {
        await db.execute(
          "ALTER TABLE `cards` ADD COLUMN `idempotencyKey` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL",
        );
      }
      if (!(await indexExists(db, "cards", "cards_area_idempotency"))) {
        await db.execute(
          "CREATE UNIQUE INDEX `cards_area_idempotency` ON `cards` (`area`, `idempotencyKey`)",
        );
      }
    },
  },

  {
    // Per-user, per-board webhook subscriptions. Each collaborator subscribes
    // their *own* endpoint to a board they can access, so on a shared instance
    // one party's automation never fires from (or hijacks) another's.
    // `ignoreOwnActions` prevents an agent's own writes re-triggering itself.
    id: "0010_webhooks",
    up: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS \`webhooks\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
        \`board\` int NOT NULL,
        \`url\` varchar(2048) COLLATE utf8mb4_general_ci NOT NULL,
        \`secret\` varchar(128) COLLATE utf8mb4_general_ci DEFAULT NULL,
        \`ignoreOwnActions\` tinyint(1) NOT NULL DEFAULT '1',
        \`enabled\` tinyint(1) NOT NULL DEFAULT '1',
        \`createdAt\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`webhooks_board\` (\`board\`),
        KEY \`webhooks_user\` (\`user\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
    },
  },

  {
    // Per-user dashboard arrangement: each user sorts and groups their boards
    // independently, including boards shared with them. The arrangement lives on
    // (user, board) — never on the board itself — so two people who both see the
    // same shared board can file it differently.
    //
    //   board_groups     — a user's own named groups (id, name, order, collapsed).
    //   board_placements — where a user has put a board: which group (NULL =
    //                      ungrouped) and its position. Unique per (user, board);
    //                      a board with no row yet is ungrouped in default order.
    id: "0011_board_groups_and_placements",
    up: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS \`board_groups\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`name\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`sort\` int NOT NULL DEFAULT '0',
        \`collapsed\` tinyint(1) NOT NULL DEFAULT '0',
        PRIMARY KEY (\`id\`),
        KEY \`board_groups_user\` (\`user\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
      await db.execute(`CREATE TABLE IF NOT EXISTS \`board_placements\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user\` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
        \`board\` int NOT NULL,
        \`group\` int DEFAULT NULL,
        \`sort\` int NOT NULL DEFAULT '0',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`board_placements_user_board\` (\`user\`,\`board\`),
        KEY \`board_placements_user\` (\`user\`),
        KEY \`board_placements_group\` (\`group\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
    },
  },

  {
    // Secondary indexes on the columns actually filtered and joined on. The
    // baseline tables shipped with only their primary keys, so every join down
    // the board → areas → cards → comments/attachments chain, every session and
    // API-key lookup, and every membership check was a full table scan. These
    // indexes turn those into key lookups. Guarded so the migration is safe to
    // re-run and safe on databases that already grew one of these by hand.
    //
    // Deliberately NOT added: cards(area) — the 0009 unique index
    // (area, idempotencyKey) already serves `WHERE area = ?` via its leftmost
    // prefix — and anything already covered by an existing key.
    id: "0012_performance_indexes",
    up: async (db) => {
      const ensureIndex = async (
        table: string,
        name: string,
        columns: string,
      ) => {
        if (!(await indexExists(db, table, name))) {
          await db.execute(
            `CREATE INDEX \`${name}\` ON \`${table}\` (${columns})`,
          );
        }
      };

      // Auth hot paths: hit on essentially every request.
      await ensureIndex("session", "session_token", "`token`");
      await ensureIndex("session", "session_user", "`userId`");
      await ensureIndex("apikey", "apikey_key", "`key`");
      await ensureIndex("apikey", "apikey_reference", "`referenceId`");
      await ensureIndex("account", "account_user", "`userId`");
      await ensureIndex("verification", "verification_identifier", "`identifier`");
      await ensureIndex("user", "user_email", "`email`");

      // The board → areas → cards → comments/attachments join chain.
      await ensureIndex("boards", "boards_user", "`user`");
      await ensureIndex("areas", "areas_board", "`board`");
      await ensureIndex("cards", "cards_assignee", "`assignee`");
      await ensureIndex("comments", "comments_card", "`card`");
      await ensureIndex("attachments", "attachments_card", "`card`");

      // Membership: invitations are queried by both board and user constantly.
      await ensureIndex("invitations", "invitations_board", "`board`");
      await ensureIndex("invitations", "invitations_user", "`user`");

      // Notifications: the dashboard unread-count query filters userId + isRead
      // + boardId; cleanup deletes filter by board or card.
      await ensureIndex(
        "notifications",
        "notifications_user_read_board",
        "`userId`, `isRead`, `boardId`",
      );
      await ensureIndex("notifications", "notifications_board", "`boardId`");
      await ensureIndex("notifications", "notifications_card", "`cardId`");
    },
  },

  {
    // Who triggered a notification. Until now a notification only knew its
    // recipient, so the UI had to parse the actor's name back out of the
    // message text and could never show their avatar. `actorId` is nullable:
    // system-generated notifications (due reminders) have no actor, and rows
    // created before this migration keep NULL.
    id: "0013_notification_actor",
    up: async (db) => {
      if (!(await columnExists(db, "notifications", "actorId"))) {
        await db.execute(
          "ALTER TABLE `notifications` ADD COLUMN `actorId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL",
        );
      }
      if (!(await indexExists(db, "notifications", "notifications_actor"))) {
        await db.execute(
          "CREATE INDEX `notifications_actor` ON `notifications` (`actorId`)",
        );
      }
    },
  },

  {
    // A card's own history. Notifications are transient and per-recipient; this
    // is the durable record that stays on the card, so opening it later shows
    // what happened and when, interleaved with the comments.
    // `data` holds the type-specific detail as JSON (old/new area, status, the
    // assignee's name, a due date), so new event types don't need new columns.
    id: "0014_card_activity",
    up: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS \`card_activity\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`card\` int NOT NULL,
        \`actorId\` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
        \`type\` varchar(32) COLLATE utf8mb4_general_ci NOT NULL,
        \`data\` longtext COLLATE utf8mb4_general_ci,
        \`createdAt\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`card_activity_card\` (\`card\`, \`createdAt\`),
        KEY \`card_activity_actor\` (\`actorId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
    },
  },

  {
    // A board tile's colour, as `#rrggbb`. NULL means the tile keeps the
    // instance's primary colour, which is what every existing board gets — the
    // column is purely additive and nothing has to be backfilled.
    id: "0015_board_color",
    up: async (db) => {
      if (!(await columnExists(db, "boards", "color"))) {
        await db.execute(
          "ALTER TABLE `boards` ADD COLUMN `color` varchar(7) COLLATE utf8mb4_general_ci DEFAULT NULL",
        );
      }
    },
  },

  {
    // Invitations to people who have no account yet. The board owner supplies an
    // e-mail address, we send a link carrying a one-time token, and signing up
    // through it both creates the account and grants the board access that was
    // promised — so the invitation is honoured even on an instance where public
    // signup is switched off.
    //
    // Only the token's SHA-256 is stored. It is a 256-bit random value rather
    // than a password, so a single fast hash is the right choice: a leaked
    // database cannot be used to accept an invitation, and verification stays an
    // indexed equality lookup. (Same reasoning as `hashApiKey`.)
    id: "0016_board_email_invites",
    up: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS \`board_email_invites\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`board\` int NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`permission\` enum('read','edit') NOT NULL DEFAULT 'read',
        \`tokenHash\` char(64) NOT NULL,
        \`invitedBy\` varchar(36) NOT NULL,
        \`expiresAt\` timestamp NOT NULL,
        \`usedAt\` timestamp NULL DEFAULT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`board_email_invites_token\` (\`tokenHash\`),
        KEY \`board_email_invites_email\` (\`email\`),
        KEY \`board_email_invites_board\` (\`board\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
    },
  },

  {
    // Invitations left behind by a deleted account. Deleting a user removed
    // their sessions, keys and account but not the rows pointing at them from
    // other people's boards, so the board rendered a member with no name — and
    // reading a letter off that name took the whole page down with a 500. The
    // deletion clears them now; these are the ones already there.
    id: "0017_orphaned_invitations",
    up: async (db) => {
      await db.execute(
        "DELETE `invitations` FROM `invitations` LEFT JOIN `user` ON `invitations`.`user` = `user`.`id` WHERE `user`.`id` IS NULL",
      );
      await db.execute(
        "DELETE `notifications` FROM `notifications` LEFT JOIN `user` ON `notifications`.`userId` = `user`.`id` WHERE `user`.`id` IS NULL",
      );
    },
  },

  {
    // Single sign-on links live in the same `account` table local passwords do,
    // under `providerId = 'sso'` with the provider's subject as `accountId`.
    // That lookup runs on every SSO sign-in and was a full scan, and nothing
    // stopped two rows claiming the same subject. Both columns are TEXT, so the
    // index takes a prefix — 190 characters is longer than any subject a
    // provider issues, and short enough to stay inside the key length limit.
    id: "0018_sso_account_index",
    up: async (db) => {
      const [rows]: any = await db.execute(
        "SHOW INDEX FROM `account` WHERE Key_name = 'account_provider_subject'",
      );
      if (rows.length) return;
      // Any duplicates from before the index would stop it being created, and a
      // duplicate here means two accounts claiming one identity: keep the
      // oldest, which is the one that has been in use.
      await db.execute(
        "DELETE a FROM `account` a JOIN `account` b ON LEFT(a.`providerId`, 32) = LEFT(b.`providerId`, 32) AND LEFT(a.`accountId`, 190) = LEFT(b.`accountId`, 190) AND a.`createdAt` > b.`createdAt`",
      );
      await db.execute(
        "CREATE UNIQUE INDEX `account_provider_subject` ON `account` (`providerId`(32), `accountId`(190))",
      );
    },
  },

  {
    // Assertions that have already been used.
    //
    // A SAML assertion is a bearer token: whoever holds it can present it. When
    // we start the sign-in ourselves the answer is tied to our request, but an
    // instance that accepts provider-initiated sign-in has no such tie — the
    // response simply arrives — so the same assertion could be replayed until
    // its window closed. Each one is recorded as it is consumed and refused if
    // it comes back.
    //
    // Rows are dropped once the assertion could no longer be valid anyway, so
    // the table stays the size of a few minutes of sign-ins rather than growing
    // for ever.
    id: "0019_saml_assertions_seen",
    up: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS \`saml_assertions_seen\` (
        \`id\` varchar(255) NOT NULL,
        \`expiresAt\` timestamp NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`saml_assertions_expiry\` (\`expiresAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
    },
  },

  {
    // The debris left by every card, area and board deleted before those
    // deletions cleared up after themselves.
    //
    // Only rows whose card no longer exists are touched — that is what makes
    // them unreachable: nothing in the app can show them, and no board they
    // belonged to still has them. The uploaded files those attachments named go
    // with them, unless another attachment still points at the same file.
    id: "0020_orphaned_card_data",
    up: async (db) => {
      const [orphans]: any = await db.execute(
        "SELECT `filedata` FROM `attachments` WHERE `card` NOT IN (SELECT `id` FROM `cards`)",
      );

      for (const table of [
        "attachments",
        "comments",
        "card_reminders",
        "card_activity",
      ]) {
        await db.execute(
          `DELETE FROM \`${table}\` WHERE \`card\` NOT IN (SELECT \`id\` FROM \`cards\`)`,
        );
      }
      await db.execute(
        "DELETE FROM `notifications` WHERE `cardId` IS NOT NULL AND `cardId` NOT IN (SELECT `id` FROM `cards`)",
      );

      if (orphans.length) {
        const { unlinkOrphanedFiles } = await import(
          "../../server/utils/cardCleanup"
        );
        const removed = await unlinkOrphanedFiles(db, orphans);
        logger.info(
          `Cleared ${orphans.length} orphaned attachment row(s) and ${removed} unreferenced upload(s)`,
        );
      }
    },
  },

  // The placeholder pictures people can pick for themselves or for a board
  // shipped as PNGs — 1.9MB of them, redrawn on every dashboard. They are WebP
  // now, a tenth of the size, and the PNGs are gone. Anyone who picked one has
  // its old path saved, so those paths are rewritten to match; a row pointing at
  // a file that no longer exists would show a broken image for ever.
  //
  // Only the placeholders are touched. An uploaded picture is stored under
  // `/api/uploads/` and keeps whatever name it was given.
  {
    id: "0021_placeholder_images_to_webp",
    up: async (db) => {
      let rewritten = 0;
      for (const [table, column] of [
        ["user", "image"],
        ["boards", "image"],
      ]) {
        const [result]: any = await db.execute(
          `UPDATE \`${table}\` SET \`${column}\` = REPLACE(REPLACE(\`${column}\`, '.png', '.webp'), '.jpg', '.webp')
             WHERE \`${column}\` LIKE '/images/%placeholder%'`,
        );
        rewritten += result.affectedRows ?? 0;
      }
      if (rewritten) {
        logger.info(`Pointed ${rewritten} placeholder image(s) at their WebP`);
      }
    },
  },

  // Profile pictures uploaded before the app started re-encoding them are still
  // whatever arrived — commonly a phone photograph of several megabytes, drawn
  // at 36 pixels and downloaded in full by everyone who opens a board it appears
  // on. Each one is re-encoded to a bounded WebP and the row pointed at the new
  // file.
  //
  // Only `user.image`, and only files this instance stored itself. A picture
  // that is already a small WebP is left alone rather than re-encoded for
  // nothing, which also makes the migration safe to look at twice.
  {
    id: "0022_shrink_existing_profile_pictures",
    up: async (db) => {
      const { readFile, writeFile, unlink } = await import("node:fs/promises");
      const { join, resolve } = await import("node:path");
      const { randomBytes } = await import("node:crypto");
      const { toWebp, AVATAR_MAX_WIDTH } = await import(
        "../../server/utils/imageProcessing"
      );
      const sharp = (await import("sharp")).default;

      const stored = /^\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)$/;
      const uploadDir = resolve(join(process.cwd(), "public", "uploads"));

      const [rows]: any = await db.execute(
        "SELECT `id`, `image` FROM `user` WHERE `image` LIKE '%/uploads/%'",
      );

      let converted = 0;
      let saved = 0;

      for (const row of rows) {
        const match = String(row.image || "").match(stored);
        if (!match) continue;

        const oldName = match[1];
        const oldPath = resolve(uploadDir, oldName);
        if (!oldPath.startsWith(uploadDir)) continue;

        try {
          const original = await readFile(oldPath);

          // Already small and already WebP: nothing to gain, and re-encoding
          // would only lose a little more of the picture.
          const meta = await sharp(original).metadata();
          if (meta.format === "webp" && (meta.width ?? 0) <= AVATAR_MAX_WIDTH) {
            continue;
          }

          const encoded = await toWebp(original, { maxWidth: AVATAR_MAX_WIDTH });
          if (!encoded) continue;

          // A new name rather than the old one: whatever is holding the old URL
          // — a cached page, another tab — keeps working until it reloads.
          const newName = `${randomBytes(16).toString("hex")}.webp`;
          await writeFile(resolve(uploadDir, newName), encoded.data);
          await db.execute("UPDATE `user` SET `image` = ? WHERE `id` = ?", [
            `/api/uploads/${newName}`,
            row.id,
          ]);

          converted += 1;
          saved += original.length - encoded.data.length;

          // The old file goes only once nothing else names it. A board cover or
          // an attachment may point at the same upload, and unlinking it would
          // break them.
          const [alsoUsed]: any = await db.execute(
            `SELECT 1 FROM \`user\` WHERE \`image\` LIKE ? LIMIT 1`,
            [`%/uploads/${oldName}`],
          );
          const [onBoard]: any = await db.execute(
            "SELECT 1 FROM `boards` WHERE `image` LIKE ? LIMIT 1",
            [`%/uploads/${oldName}`],
          );
          const [onCard]: any = await db.execute(
            "SELECT 1 FROM `attachments` WHERE `filedata` LIKE ? LIMIT 1",
            [`%/uploads/${oldName}`],
          );
          if (!alsoUsed.length && !onBoard.length && !onCard.length) {
            await unlink(oldPath).catch(() => {});
          }
        } catch {
          // Unreadable, missing, or not an image sharp can parse. The row keeps
          // pointing where it did — a picture that still shows is better than a
          // broken one.
        }
      }

      if (converted) {
        logger.info(
          `Re-encoded ${converted} profile picture(s), ${Math.round(saved / 1024)}KB smaller`,
        );
      }
    },
  },

  // The same treatment for the images 0022 did not reach: board covers, and the
  // pictures already sitting inside card descriptions and comments. New ones
  // have been re-encoded on upload since v0.33.0, but everything stored before
  // that is still whatever arrived.
  //
  // These keep their dimensions — a cover and a screenshot in a comment are
  // meant to be looked at, unlike an avatar drawn at 36 pixels — so only the
  // format changes. Files that back an attachment are left alone entirely:
  // somebody attached those to be downloaded as they were sent.
  {
    id: "0023_convert_remaining_images_to_webp",
    up: async (db) => {
      const { readFile, writeFile, unlink } = await import("node:fs/promises");
      const { join, resolve } = await import("node:path");
      const { randomBytes } = await import("node:crypto");
      const { toWebp } = await import("../../server/utils/imageProcessing");
      const sharp = (await import("sharp")).default;

      const uploadDir = resolve(join(process.cwd(), "public", "uploads"));
      const REFERENCE = /\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)/g;

      // Everywhere an upload can be named, and how to find it there.
      const [covers]: any = await db.execute(
        "SELECT `id`, `image` AS text FROM `boards` WHERE `image` LIKE '%/uploads/%'",
      );
      const [cards]: any = await db.execute(
        "SELECT `id`, `content` AS text FROM `cards` WHERE `content` LIKE '%/uploads/%'",
      );
      const [comments]: any = await db.execute(
        "SELECT `id`, `content` AS text FROM `comments` WHERE `content` LIKE '%/uploads/%'",
      );
      // A comment notification stores a copy of the comment it announces, which
      // means a copy of the picture's address too. Left out of this, the copy
      // went on naming a file the rest of the migration had just replaced and
      // then deleted, and the bell showed a broken image while the comment
      // itself was fine.
      const [notes]: any = await db.execute(
        "SELECT `id`, `message` AS text FROM `notifications` WHERE `message` LIKE '%/uploads/%'",
      );

      const names = new Set<string>();
      for (const row of [...covers, ...cards, ...comments, ...notes]) {
        for (const match of String(row.text || "").matchAll(REFERENCE)) {
          names.add(match[1]);
        }
      }
      if (!names.size) return;

      // old name -> new name, for the rewrite below.
      const renamed = new Map<string, string>();
      let saved = 0;

      for (const name of names) {
        const oldPath = resolve(uploadDir, name);
        if (!oldPath.startsWith(uploadDir)) continue;

        try {
          const original = await readFile(oldPath);
          const meta = await sharp(original).metadata();
          // Already the format we want; re-encoding would only lose a little
          // more of the picture for nothing.
          if (meta.format === "webp") continue;

          const encoded = await toWebp(original);
          if (!encoded) continue;
          // Never make a file bigger. A small PNG of flat colour can beat WebP,
          // and swapping it for something larger is the opposite of the point.
          if (encoded.data.length >= original.length) continue;

          const newName = `${randomBytes(16).toString("hex")}.webp`;
          await writeFile(resolve(uploadDir, newName), encoded.data);
          renamed.set(name, newName);
          saved += original.length - encoded.data.length;
        } catch (err) {
          // Unreadable, missing, or not an image. Leave the reference alone —
          // a picture that still shows beats a broken one — but say so, or a
          // migration that silently converted nothing looks like one that had
          // nothing to convert.
          logger.warn(`Could not convert upload ${name}: ${(err as Error)?.message}`);
        }
      }
      if (!renamed.size) return;

      const rewrite = (text: string) =>
        String(text || "").replace(REFERENCE, (whole, name) =>
          renamed.has(name) ? whole.replace(name, renamed.get(name)!) : whole,
        );

      for (const [table, column, rows] of [
        ["boards", "image", covers],
        ["cards", "content", cards],
        ["comments", "content", comments],
        ["notifications", "message", notes],
      ] as const) {
        for (const row of rows) {
          // Re-read rather than rewriting the copy taken at the top: encoding
          // the images takes long enough that a comment could have been edited
          // in between, and writing back the older text would undo that edit.
          const [current]: any = await db.execute(
            `SELECT \`${column}\` AS text FROM \`${table}\` WHERE \`id\` = ?`,
            [row.id],
          );
          const text = current[0]?.text;
          if (text == null) continue;
          const next = rewrite(text);
          if (next === text) continue;
          await db.execute(
            `UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`id\` = ?`,
            [next, row.id],
          );
        }
      }

      // Old files go only once nothing names them any more — including the
      // attachments, which were never rewritten and still point at theirs.
      let removed = 0;
      for (const oldName of renamed.keys()) {
        const like = `%/uploads/${oldName}%`;
        const [used]: any = await Promise.all([
          db.execute("SELECT 1 FROM `boards` WHERE `image` LIKE ? LIMIT 1", [like]),
          db.execute("SELECT 1 FROM `user` WHERE `image` LIKE ? LIMIT 1", [like]),
          db.execute("SELECT 1 FROM `cards` WHERE `content` LIKE ? LIMIT 1", [like]),
          db.execute("SELECT 1 FROM `comments` WHERE `content` LIKE ? LIMIT 1", [like]),
          db.execute("SELECT 1 FROM `attachments` WHERE `filedata` LIKE ? LIMIT 1", [like]),
          db.execute("SELECT 1 FROM `notifications` WHERE `message` LIKE ? LIMIT 1", [like]),
        ]).then((results) => [results.some(([r]: any) => r.length)]);
        if (used) continue;
        try {
          await unlink(resolve(uploadDir, oldName));
          removed += 1;
        } catch (err) {
          logger.warn(
            `Converted ${oldName} but could not remove the original: ${(err as Error)?.message}`,
          );
        }
      }

      logger.info(
        `Converted ${renamed.size} image(s) to WebP, ${Math.round(saved / 1024)}KB smaller, removed ${removed} original(s)`,
      );
    },
  },

  // Repairs what the version of `0023` that shipped in v0.33.0 left behind. That
  // one converted the pictures named by boards, cards and comments, and deleted
  // each original once nothing it knew about named it any more — but it did not
  // know about `notifications`, which keep their own copy of the comment they
  // announce. So the copy went on naming a file that had just been deleted, and
  // a picture posted in July showed as broken in the bell while the very same
  // picture was still fine on the card.
  //
  // `0023` has been taught about notifications since, which is enough for an
  // instance that has not run it yet. This is for the ones that already have:
  // there the damage is done and the old name is the only thing left pointing at
  // what the picture used to be.
  //
  // The repair is possible because a comment notification is a copy: its message
  // is `New comment by "X" on card "Y": ` followed by the comment's own HTML. So
  // for a notification that names a file which is no longer there, the comments
  // on that same card are read, and the one whose text matches — every upload
  // address blanked out first, since those are exactly what differ — says what
  // the picture is called now. Anything that cannot be matched that way is left
  // exactly as it is: a broken picture is better than a wrong one.
  {
    id: "0024_repair_notification_images",
    up: async (db) => {
      const { access } = await import("node:fs/promises");
      const { join, resolve } = await import("node:path");

      const uploadDir = resolve(join(process.cwd(), "public", "uploads"));
      const REFERENCE = /\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)/g;
      const namesIn = (text: string) =>
        [...String(text || "").matchAll(REFERENCE)].map((m) => m[1]);

      const [notes]: any = await db.execute(
        "SELECT `id`, `cardId`, `message` FROM `notifications` WHERE `message` LIKE '%/uploads/%'",
      );
      if (!notes.length) return;

      const known = new Map<string, boolean>();
      const present = async (name: string) => {
        if (!known.has(name)) {
          const file = resolve(uploadDir, name);
          if (!file.startsWith(uploadDir)) known.set(name, false);
          else
            known.set(
              name,
              await access(file).then(
                () => true,
                () => false,
              ),
            );
        }
        return known.get(name)!;
      };

      // Two texts are the same message when they differ only in which files
      // they name — which is the whole of what this migration is fixing.
      const blanked = (text: string) =>
        String(text || "").replace(REFERENCE, "/uploads/#");

      let repaired = 0;
      let unmatched = 0;

      for (const note of notes) {
        const named = namesIn(note.message);
        let missing = false;
        for (const name of named) {
          if (!(await present(name))) {
            missing = true;
            break;
          }
        }
        if (!missing) continue;

        if (!note.cardId) {
          unmatched += 1;
          continue;
        }

        const [comments]: any = await db.execute(
          "SELECT `content` FROM `comments` WHERE `card` = ? AND `content` LIKE '%/uploads/%'",
          [note.cardId],
        );

        const message = blanked(note.message);
        const matches = comments.filter((row: any) =>
          message.endsWith(blanked(row.content)),
        );
        // Two comments with the same words and different pictures cannot be
        // told apart; that is a guess, and this does not guess.
        const distinct = new Set(
          matches.map((row: any) => namesIn(row.content).join("|")),
        );
        if (matches.length === 0 || distinct.size !== 1) {
          unmatched += 1;
          continue;
        }

        const replacements = namesIn(matches[0].content);
        if (replacements.length !== named.length) {
          unmatched += 1;
          continue;
        }

        let index = 0;
        const next = String(note.message).replace(REFERENCE, (whole, name) => {
          const replacement = replacements[index++];
          return replacement ? whole.replace(name, replacement) : whole;
        });
        if (next === note.message) continue;

        await db.execute(
          "UPDATE `notifications` SET `message` = ? WHERE `id` = ?",
          [next, note.id],
        );
        repaired += 1;
      }

      if (repaired || unmatched) {
        logger.info(
          `Repaired the pictures in ${repaired} notification(s)` +
            (unmatched
              ? `; ${unmatched} still name a file that is gone and could not be matched to a comment`
              : ""),
        );
      }
    },
  },

  // Labels: a small named, coloured set per board, and which cards wear them.
  //
  // Per board rather than per instance, because "Blocked" on one board and
  // "Blocked" on another are rarely the same thing, and a shared list would
  // grow to hold everybody's. It also means a board carries its own vocabulary
  // when it is duplicated or handed over.
  //
  // No foreign keys, as everywhere else here: rows are cleaned up where they
  // are deleted, and the orphan-sweeping migrations above are the safety net.
  {
    id: "0025_card_labels",
    up: async (db) => {
      await db.execute(`CREATE TABLE IF NOT EXISTS \`labels\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`board\` int NOT NULL,
        \`name\` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
        \`color\` varchar(7) COLLATE utf8mb4_general_ci NOT NULL,
        \`sort\` int NOT NULL DEFAULT '0',
        PRIMARY KEY (\`id\`),
        KEY \`labels_board\` (\`board\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);

      // The pair is the key: a card wears a label once or not at all, and the
      // second index is what makes "every card with this label" cheap, which
      // is the whole point of filtering by one.
      await db.execute(`CREATE TABLE IF NOT EXISTS \`card_labels\` (
        \`card\` int NOT NULL,
        \`label\` int NOT NULL,
        PRIMARY KEY (\`card\`, \`label\`),
        KEY \`card_labels_label\` (\`label\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;`);
    },
  },

  {
    // One name, one label — per board.
    //
    // A label started out as a board's vocabulary: a list you kept and switched
    // on and off per card. That is not what it is any more. A label is a word
    // typed on a card, and the row in `labels` exists only so the same word
    // typed on two cards is one thing — which is what makes a tile, a filter and
    // the list of names offered when adding one all agree.
    //
    // The index is that rule written down. Without it two people typing "Bug" at
    // the same moment on the same board get a label each, and the board quietly
    // holds two of everything.
    id: "0026_label_names_unique",
    up: async (db) => {
      // Anything already duplicated is collapsed onto the oldest of its name,
      // and the cards wearing the others are moved across. `UPDATE IGNORE`
      // covers the card that wore both: its row for the survivor already
      // exists, so the move is dropped and the delete below clears the rest.
      const [duplicated]: any = await db.execute(
        "SELECT `board`, `name`, MIN(`id`) AS keeper FROM `labels` GROUP BY `board`, `name` HAVING COUNT(*) > 1",
      );
      for (const group of duplicated as any[]) {
        const [extras]: any = await db.execute(
          "SELECT `id` FROM `labels` WHERE `board` = ? AND `name` = ? AND `id` <> ?",
          [group.board, group.name, group.keeper],
        );
        for (const extra of extras as any[]) {
          await db.execute(
            "UPDATE IGNORE `card_labels` SET `label` = ? WHERE `label` = ?",
            [group.keeper, extra.id],
          );
          await db.execute("DELETE FROM `card_labels` WHERE `label` = ?", [
            extra.id,
          ]);
          await db.execute("DELETE FROM `labels` WHERE `id` = ?", [extra.id]);
        }
      }

      await db.execute(
        "ALTER TABLE `labels` ADD UNIQUE KEY `labels_board_name` (`board`, `name`)",
      );
    },
  },

  {
    // Deleting becomes archiving.
    //
    // Everything a board is made of could only ever be destroyed: a card, an
    // area with every card in it, a whole board with every area, card, comment
    // and uploaded file. One misplaced click and the answer was "restore your
    // backup" — an unkind answer from an app whose whole pitch is that the data
    // is yours and it is on your machine.
    //
    // A date rather than a flag: it says when, which is what you want to know
    // when you find something in the archive and cannot remember putting it
    // there. Null means live, and every list the app draws asks for null.
    id: "0027_archive_instead_of_delete",
    up: async (db) => {
      for (const table of ["cards", "areas", "boards"]) {
        if (!(await columnExists(db, table, "archivedAt"))) {
          await db.execute(
            `ALTER TABLE \`${table}\` ADD COLUMN \`archivedAt\` datetime NULL DEFAULT NULL`,
          );
        }
      }
    },
  },

  // To add a further schema change, append a new migration here, e.g.:
  // {
  //   id: "0015_add_x",
  //   up: async (db) => {
  //     await db.execute("ALTER TABLE `cards` ADD COLUMN `x` int NULL");
  //   },
  // },
];

let migrationPromise: Promise<void> | null = null;

/**
 * Apply any not-yet-applied migrations, once. Safe to call repeatedly — the work
 * happens a single time per process. Called at server startup; the server should
 * not begin serving requests until this resolves.
 */
export function runMigrations(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = applyMigrations().catch((err) => {
      // Allow a later call to retry after a transient failure.
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

// One database, one migration at a time. The name is scoped to the schema so two
// instances sharing a MySQL server don't wait on each other; MySQL caps a lock
// name at 64 characters.
const MIGRATION_LOCK = `lokalboards_migrations_${mysqlDatabase}`.slice(0, 64);

// Long enough for the slowest migration on a large database — the image
// conversions re-encode every picture — and short enough that a lock left behind
// by a killed process does not hang a deployment forever.
const MIGRATION_LOCK_TIMEOUT = 600;

async function applyMigrations(): Promise<void> {
  // Tracks which migrations have run.
  await db.execute(`CREATE TABLE IF NOT EXISTS \`migrations\` (
    \`id\` varchar(191) NOT NULL,
    \`appliedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`);

  // Two processes can arrive here at once — a deployment rolling a second
  // replica, or the browser tests, where the server and the test harness both
  // migrate the same fresh database. Both would read an empty `migrations`
  // table, both would start at `0001`, and the slower one would fail on the
  // primary key with every table already created by the other. A named lock
  // makes one wait and then find the work already recorded.
  //
  // The lock lives on its own connection for as long as it is held: MySQL ties
  // it to the session, so releasing the connection back to the pool mid-run
  // would drop the lock. The migrations themselves keep using the pool.
  const guard = await db.getConnection();
  let held = false;
  try {
    try {
      const [rows]: any = await guard.query("SELECT GET_LOCK(?, ?) AS ok", [
        MIGRATION_LOCK,
        MIGRATION_LOCK_TIMEOUT,
      ]);
      held = rows?.[0]?.ok === 1;
      if (!held) {
        logger.warn(
          "Timed out waiting for another process to finish migrating; continuing without the lock",
        );
      }
    } catch (err) {
      // GET_LOCK is standard in MySQL and MariaDB, but a proxy or a restricted
      // grant could refuse it. That is how this ran before the lock existed, so
      // carry on rather than refusing to start.
      logger.warn(
        `Could not take the migration lock, continuing without it: ${(err as Error)?.message}`,
      );
    }

    // Read inside the lock: whoever waited here needs the list as it is now,
    // not as it was before the other process ran.
    const [rows]: any = await db.execute("SELECT `id` FROM `migrations`");
    const applied = new Set((rows as any[]).map((r) => r.id));

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await migration.up(db);
      await db.execute("INSERT INTO `migrations` (`id`) VALUES (?)", [
        migration.id,
      ]);
      logger.info(`Applied database migration: ${migration.id}`);
    }
  } finally {
    if (held) {
      await guard
        .query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK])
        .catch(() => {});
    }
    guard.release();
  }
}
