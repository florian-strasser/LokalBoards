// Scratch: measure the card list in real Safari, before and with a dialog open.
import fs from "node:fs";
import { spawn } from "node:child_process";
const [, , info, out] = process.argv;
const { base, board, card, token } = JSON.parse(fs.readFileSync(info, "utf8"));
const driver = spawn("safaridriver", ["-p", "4447"], { stdio: "ignore" });
const W = "http://127.0.0.1:4447";
for (let i = 0; i < 40; i++) { try { if ((await fetch(W + "/status")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const call = async (method, path, body) => {
  const res = await fetch(W + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${path}: ${json.value.error} ${json.value.message}`);
  return json.value;
};
let session;
try {
  session = (await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })).sessionId;
  const s = (p) => `/session/${session}${p}`;
  await call("POST", s("/window/rect"), { width: 1000, height: 700, x: 40, y: 40 });
  await call("POST", s("/url"), { url: base + "/login" });
  await call("POST", s("/cookie"), { cookie: { name: "session_token", value: token, path: "/", domain: "127.0.0.1" } });
  await call("POST", s("/url"), { url: `${base}/board/${board}` });
  await new Promise((r) => setTimeout(r, 3000));
  const measure = `
    const list = document.querySelector(".card-wrapper");
    const cards = [...list.querySelectorAll(".card-list > *")].filter((el) => el.offsetParent);
    const reg = cards.find((el) => el.textContent.includes("Registrierung"));
    const r = reg.getBoundingClientRect();
    const scroller = list.closest(".\\\\@container");
    return {
      listOffsetW: list.offsetWidth, listClientW: list.clientWidth, bar: list.offsetWidth - list.clientWidth,
      listScrollH: list.scrollHeight, listClientH: list.clientHeight,
      cardW: Math.round(r.width * 100) / 100, cardH: Math.round(r.height),
      scrollerClientH: scroller.clientHeight, scrollerOffsetH: scroller.offsetHeight, scrollerPad: getComputedStyle(scroller).paddingBottom,
      scrollerOverflowX: getComputedStyle(scroller).overflowX,
      winGap: window.innerWidth - document.documentElement.clientWidth, bodyPad: document.body.style.paddingRight,
      dpr: devicePixelRatio, innerW: innerWidth,
    };`;
  const shot = async (name) => fs.writeFileSync(`${out}-${name}.png`, Buffer.from(await call("GET", s("/screenshot")), "base64"));
  const before = await call("POST", s("/execute/sync"), { script: measure, args: [] });
  await shot("closed");
  await call("POST", s("/execute/sync"), { script: `[...document.querySelectorAll(".card-list > *")].find((el) => el.textContent.includes("Registrierung")).querySelector("p, h3, span, div").click(); return true;`, args: [] });
  await new Promise((r) => setTimeout(r, 2000));
  const during = await call("POST", s("/execute/sync"), { script: measure + "", args: [] });
  await shot("open");
  console.log("before", JSON.stringify(before));
  console.log("during", JSON.stringify(during));
  console.log("url", await call("GET", s("/url")));
} finally {
  if (session) await fetch(`${W}/session/${session}`, { method: "DELETE" }).catch(() => {});
  driver.kill();
}
