// LokalBoards as an OAuth authorization server, driven the way an MCP client
// drives it.
//
// This is the flow ChatGPT performs: hit /mcp with nothing, read the challenge,
// follow it to the protected-resource metadata, follow that to the
// authorization server, get a client_id, run authorization code + PKCE, and come
// back with a bearer token. Each step here is one the real client takes, in the
// order it takes them — if this passes, a connector can be added.
//
// Requires a built app (`npm run build`) and the credentials in `.env.local`.
// Creates and drops a database of its own; it never touches an existing one.
import fs from "node:fs";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DB = "lokalboards_oauth";
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const CLIENT_PORT = 3131;
const creds = { host: env.NUXT_MYSQL_HOST, user: env.NUXT_MYSQL_USER, password: env.NUXT_MYSQL_PASSWORD };

const admin = await mysql.createConnection(creds);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\``);
await admin.end();

const child = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, ...env, NUXT_MYSQL_DATABASE: DB, NUXT_MYSQL_SSL: "false",
         NUXT_PUBLIC_SIGNUP: "true", PORT: String(PORT), NITRO_PORT: String(PORT),
         NUXT_BOARDS_URL: BASE, NUXT_LOG_LEVEL: "error",
         // So the fake client can serve its metadata document over loopback.
         NUXT_OAUTH_ALLOW_INSECURE_CLIENT_METADATA: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});
if (process.env.OAUTH_TEST_VERBOSE) {
  child.stdout.on("data", (d) => process.stderr.write(`[server] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
}
for (let i = 0; i < 160; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const c = await mysql.createConnection({ ...creds, database: DB });
for (let i = 0; i < 200; i++) {
  const [r] = await c.query("SELECT 1 FROM `migrations` WHERE `id` LIKE '0028%'").catch(() => [[]]);
  if (r.length) break;
  await new Promise((r) => setTimeout(r, 250));
}

// The fake client's own web server, serving its Client ID Metadata Document —
// the client_id *is* this URL.
const CLIENT_ID = `http://127.0.0.1:${CLIENT_PORT}/client.json`;
const REDIRECT_URI = `http://127.0.0.1:${CLIENT_PORT}/callback`;
let metadataDocument = {
  client_id: CLIENT_ID,
  client_name: "Fake Assistant",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
};
const clientServer = http.createServer((req, res) => {
  if (req.url.startsWith("/client.json")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(metadataDocument));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => clientServer.listen(CLIENT_PORT, "127.0.0.1", r));

let failures = 0;
const stop = async () => {
  clientServer.close();
  child.kill("SIGKILL");
  const cleanup = await mysql.createConnection(creds);
  await cleanup.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await cleanup.end();
  await c.end();
};

try {
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
    if (!ok) failures++;
  };

  // ------------------------------------------------------- 1. the challenge --
  const bare = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const challenge = bare.headers.get("www-authenticate") || "";
  check("an unauthenticated /mcp request is refused", bare.status === 401, `status ${bare.status}`);
  check("and says where to find the resource metadata",
    /resource_metadata="[^"]+oauth-protected-resource"/.test(challenge), challenge);
  check("and which scopes it wants", /scope="boards:read boards:write"/.test(challenge), challenge);

  // --------------------------------------------------------- 2. discovery ---
  const metaUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  const resourceMeta = await fetch(metaUrl).then((r) => r.json());
  check("the resource metadata names this server as the resource",
    resourceMeta.resource === `${BASE}/mcp`, resourceMeta.resource);
  check("and points at an authorization server",
    resourceMeta.authorization_servers?.[0] === BASE, JSON.stringify(resourceMeta.authorization_servers));
  check("the path-suffixed metadata is served too",
    (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).ok);

  const asMeta = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) => r.json());
  check("the authorization server advertises S256 only",
    JSON.stringify(asMeta.code_challenge_methods_supported) === '["S256"]');
  check("and the authorization code grant", asMeta.grant_types_supported.includes("authorization_code"));
  check("and that it supports metadata-document clients", asMeta.client_id_metadata_document_supported === true);
  check("and that it returns iss", asMeta.authorization_response_iss_parameter_supported === true);

  // ------------------------------------------ 3. the person doing the allowing
  await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@example.test", password: "correct horse battery" }) });
  const signIn = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }) });
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0])
    .find((x) => x.startsWith("session_token="));

  // --------------------------------------------------- 4. authorization -----
  const verifier = randomBytes(48).toString("base64url");
  const challengeValue = createHash("sha256").update(verifier).digest("base64url");
  const authParams = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "boards:read boards:write",
    state: "opaque-state",
    code_challenge: challengeValue,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
  };

  const described = await fetch(
    `${BASE}/api/oauth/authorize?${new URLSearchParams(authParams)}`,
    { headers: { cookie } },
  ).then((r) => r.json());
  check("the consent screen is told the client's name, read from its document",
    described.client?.name === "Fake Assistant", JSON.stringify(described));
  check("and that the request wants to write", described.writes === true);

  const approved = await fetch(`${BASE}/api/oauth/authorize`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...authParams, approve: true }),
  }).then((r) => r.json());
  const back = new URL(approved.redirect);
  check("allowing sends the browser back to the client", back.origin + back.pathname === REDIRECT_URI);
  check("with the state it came with", back.searchParams.get("state") === "opaque-state");
  check("and with iss, so the client can tell who answered", back.searchParams.get("iss") === BASE);
  const code = back.searchParams.get("code");
  check("and an authorization code", !!code);

  // --------------------------------------------------------- 5. the token ---
  const tokenBody = {
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    resource: `${BASE}/mcp`,
  };
  const wrongVerifier = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tokenBody, code_verifier: randomBytes(48).toString("base64url") }),
  });
  check("a code without its PKCE verifier is refused", wrongVerifier.status === 400, `status ${wrongVerifier.status}`);

  // That attempt spent the code, so start again for the real exchange.
  const second = await fetch(`${BASE}/api/oauth/authorize`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...authParams, approve: true }),
  }).then((r) => r.json());
  const freshCode = new URL(second.redirect).searchParams.get("code");

  const tokens = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tokenBody, code: freshCode }),
  }).then((r) => r.json());
  check("the code is exchanged for a bearer token", !!tokens.access_token, JSON.stringify(tokens).slice(0, 90));
  check("with a refresh token", !!tokens.refresh_token);
  check("and the scope that was granted", tokens.scope === "boards:read boards:write", tokens.scope);

  // -------------------------------------------------------- 6. using it ----
  const rpc = (token, body) =>
    fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
  const initialised = await rpc(tokens.access_token, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } },
  });
  check("the MCP endpoint accepts the token", initialised.status === 200, `status ${initialised.status}`);

  // ------------------------------------------------- 7. a code used twice ---
  const replay = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tokenBody, code: freshCode }),
  });
  check("a code cannot be spent twice", replay.status === 400, `status ${replay.status}`);
  const afterReplay = await rpc(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "ping" });
  check("and the replay takes the tokens it produced with it",
    afterReplay.status === 401, `status ${afterReplay.status}`);

  // ------------------------------------------------------ 8. read-only -----
  const readOnlyAuth = await fetch(`${BASE}/api/oauth/authorize`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...authParams, approve: true, readOnly: true }),
  }).then((r) => r.json());
  const readOnlyCode = new URL(readOnlyAuth.redirect).searchParams.get("code");
  const readOnlyTokens = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tokenBody, code: readOnlyCode }),
  }).then((r) => r.json());
  check("choosing read-only narrows the token's scope",
    readOnlyTokens.scope === "boards:read", readOnlyTokens.scope);
  const [[stored]] = await c.query(
    "SELECT scope FROM oauth_tokens WHERE accessHash = SHA2(?, 256)", [readOnlyTokens.access_token]);
  check("and that is what is stored", stored?.scope === "boards:read", stored?.scope);

  // --------------------------------------------------------- 9. refresh ----
  const refreshed = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: readOnlyTokens.refresh_token }),
  }).then((r) => r.json());
  check("a refresh token buys a new access token", !!refreshed.access_token);
  const reused = await fetch(`${BASE}/api/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: readOnlyTokens.refresh_token }),
  });
  check("and is rotated, so the old one is dead", reused.status === 400, `status ${reused.status}`);

  // ---------------------------------------------------------- 10. revoke ---
  await fetch(`${BASE}/api/oauth/revoke`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: refreshed.access_token }),
  });
  const afterRevoke = await rpc(refreshed.access_token, { jsonrpc: "2.0", id: 3, method: "ping" });
  check("a revoked token stops working at once", afterRevoke.status === 401, `status ${afterRevoke.status}`);

  // -------------------------------------------------- 11. what is refused --
  metadataDocument = { ...metadataDocument, client_id: "https://somebody.else/client.json" };
  const impostor = await fetch(
    `${BASE}/api/oauth/authorize?${new URLSearchParams({ ...authParams })}`,
    { headers: { cookie } },
  );
  check("a metadata document that claims another client_id is refused",
    impostor.status === 400, `status ${impostor.status}`);
  metadataDocument = { ...metadataDocument, client_id: CLIENT_ID };

  const wrongRedirect = await fetch(
    `${BASE}/api/oauth/authorize?${new URLSearchParams({ ...authParams, redirect_uri: "https://evil.example/steal" })}`,
    { headers: { cookie } },
  ).then((r) => r.json());
  check("a redirect the client never declared is refused", wrongRedirect.error === "invalid_request");
  check("and is not offered as a place to send somebody", wrongRedirect.redirect === null);

  const wrongResource = await fetch(
    `${BASE}/api/oauth/authorize?${new URLSearchParams({ ...authParams, resource: "https://someone-elses.example/mcp" })}`,
    { headers: { cookie } },
  ).then((r) => r.json());
  check("a token cannot be requested for somebody else's resource",
    wrongResource.error === "invalid_target", JSON.stringify(wrongResource).slice(0, 80));

  const plainPkce = await fetch(
    `${BASE}/api/oauth/authorize?${new URLSearchParams({ ...authParams, code_challenge_method: "plain" })}`,
    { headers: { cookie } },
  ).then((r) => r.json());
  check("PKCE 'plain' is refused, as OAuth 2.1 requires", plainPkce.error === "invalid_request");

  // ----------------------------------- 12. the deprecated registration path --
  const registered = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Older client", redirect_uris: [REDIRECT_URI] }),
  }).then((r) => r.json());
  check("a client can still register the deprecated way", !!registered.client_id, JSON.stringify(registered).slice(0, 80));
  check("and gets no secret, being a public client", !registered.client_secret);

  // ------------------------------------------------- 13. keys still work ---
  const [[user]] = await c.query("SELECT id FROM `user` LIMIT 1");
  check("the API key path is untouched", !!user);
} catch (error) {
  console.error(`\n FAIL  the run stopped early — ${error.message.split("\n")[0]}`);
  failures++;
} finally {
  await stop();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
