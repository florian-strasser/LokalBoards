// Builds a single browsable index.html pairing every view across the captured
// languages side by side.
//
//   node scripts/demo/gallery.mjs <output-dir>
//
// Languages come from DEMO_LANGS (default "en de"); each must be a subdirectory
// of <output-dir> containing the PNGs.
import { writeFileSync } from "node:fs";

const outDir = process.argv[2] ?? "demo-screenshots";
const langs = (process.env.DEMO_LANGS ?? "en de").split(/\s+/).filter(Boolean);
const langLabel = { en: "English", de: "Deutsch", fr: "Français", es: "Español", it: "Italiano", nl: "Nederlands", pl: "Polski" };

const views = [
  ["01-sign-in", "Sign in", "page"], ["02-sign-up", "Sign up", "page"], ["03-lost-password", "Lost password", "page"],
  ["10-dashboard", "Dashboard", "page"], ["11-board-kanban", "Board — Kanban", "page"], ["12-board-todo", "Board — To-do list", "page"], ["37-my-work", "My work", "page"], ["40-board-kanban-mobile", "Board — phone", "page"],
  ["13-settings", "Settings", "page"], ["14-users", "Users (admin)", "page"], ["15-new-user", "New user", "page"], ["16-edit-user", "Edit user", "page"],
  ["20-modal-create-board", "Create board", "modal"], ["21-menu-actions", "Actions menu (⋮)", "modal"], ["32-menu-board-tile", "Board tile menu", "modal"], ["22-modal-trello-import", "Import from Trello", "modal"],
  ["23-modal-board-options", "Board options", "modal"], ["24-modal-invite", "Invite user", "modal"], ["25-modal-delete-board", "Archive board", "modal"], ["33-modal-duplicate-board", "Duplicate board", "modal"], ["34-modal-archive", "Recently archived", "modal"], ["35-board-filter", "Board filter", "modal"],
  ["26-modal-card", "Card", "modal"], ["31-menu-card", "Card menu", "modal"], ["27-modal-image-lightbox", "Image lightbox", "modal"], ["28-modal-delete-area", "Archive area", "modal"], ["29-modal-delete-user", "Delete user", "modal"],
  ["30-search", "Search", "modal"], ["36-oauth-consent", "OAuth consent", "modal"],
];

const cols = `repeat(${langs.length}, 1fr)`;
const row = ([f, t, k]) => `
  <section class="view">
    <h3>${t} <span class="tag ${k}">${k}</span></h3>
    <div class="pair">
      ${langs.map((l) => `<figure><figcaption>${langLabel[l] ?? l}</figcaption><a href="${l}/${f}.png" target="_blank"><img loading="lazy" src="${l}/${f}.png"></a></figure>`).join("")}
    </div>
  </section>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LokalBoards — demo screenshots</title>
<style>
  :root{color-scheme:light dark}
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f5f7;color:#1c1c1e}
  header{padding:28px 32px;border-bottom:1px solid #0001;background:#fff;position:sticky;top:0;z-index:1}
  h1{margin:0;font-size:22px}
  header p{margin:6px 0 0;color:#666;font-size:14px}
  main{padding:24px 32px;max-width:1600px;margin:0 auto}
  .view{margin:0 0 40px}
  h3{font-size:16px;font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:8px}
  .tag{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px}
  .tag.page{background:#0066cc1a;color:#0066cc}
  .tag.modal{background:#8a8a8f1a;color:#6b6b70}
  .pair{display:grid;grid-template-columns:${cols};gap:16px}
  figure{margin:0}
  figcaption{font-size:12px;color:#888;margin:0 0 6px}
  img{width:100%;height:auto;border:1px solid #0001;border-radius:10px;display:block;background:#fff}
  @media (prefers-color-scheme:dark){body{background:#1c1c1e;color:#eee}header{background:#2c2c2e;border-color:#fff1}img{border-color:#fff2}}
</style></head><body>
<header><h1>LokalBoards — demo screenshots</h1><p>Fresh seeded demo (${langs.map((l) => langLabel[l] ?? l).join(" &amp; ")}) · ${views.length} views each · click any image to open full size</p></header>
<main>${views.map(row).join("")}</main></body></html>`;

writeFileSync(`${outDir}/index.html`, html);
console.log(`gallery written to ${outDir}/index.html (${langs.length} languages × ${views.length} views)`);
