import zlib from "node:zlib";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { db, migrate, resetData } from "./db";
// The test provider the browser harness in tests/saml uses: it signs real
// assertions with a real key, so the signature check is the actual one.
import { buildResponse, makeKeyPair, signAssertion } from "../../tests/saml/fake-idp.mjs";

// SAML replay protection against the real `saml_assertions_seen` table.
//
// v0.40.3 ran node-saml with its default `validateInResponseTo: "never"` and
// sent every assertion that carried an `InResponseTo` past the replay table,
// so a captured answer to one of our own sign-ins could be posted again, by
// anyone, until it expired. Now the request id is recorded and can be answered
// once, and every assertion — solicited or not — is used once.

const BASE = "http://localhost:3000";
vi.stubGlobal("useRuntimeConfig", () => ({ boardsUrl: BASE }));

const { acceptAssertion, buildSaml, samlConfigFrom, SamlRequestCache } = await import(
  "../../server/utils/saml"
);

const ISSUER = "https://fake-idp.test/metadata";
const keys = makeKeyPair();

function config(extra: Record<string, unknown> = {}) {
  return samlConfigFrom({
    boardsUrl: BASE,
    samlEnabled: "true",
    samlEntryPoint: "https://fake-idp.test/sso",
    samlIdpCert: keys.certificate,
    samlIdpIssuer: ISSUER,
    ...extra,
  });
}

/** Start a sign-in the way /api/auth/saml/start does; the id of the request sent. */
async function startSignIn(cfg: any): Promise<string> {
  const url = new URL(await buildSaml(cfg).getAuthorizeUrlAsync("/dashboard/", undefined, {}));
  const xml = zlib
    .inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64"))
    .toString("utf8");
  return xml.match(/\bID="([^"]+)"/)![1];
}

/** A signed response, base64 as the browser posts it. */
function signedResponse(cfg: any, inResponseTo: string | null) {
  const { response, assertionId } = buildResponse({
    issuer: ISSUER,
    audience: cfg.entityId,
    recipient: `${BASE}/api/auth/saml/acs`,
    inResponseTo,
  });
  const signed = signAssertion(response, assertionId, keys.privateKey);
  return { SAMLResponse: Buffer.from(signed, "utf8").toString("base64"), assertionId };
}

async function verify(cfg: any, SAMLResponse: string) {
  const { profile } = await buildSaml(cfg).validatePostResponseAsync({ SAMLResponse, RelayState: "" });
  return profile as any;
}

beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  await resetData();
});
afterAll(() => {
  keys.cleanup();
});

describe("SAML replay protection (integration, real MySQL)", () => {
  it("accepts the answer to our own request once, and refuses it posted again", async () => {
    const cfg = config();
    const requestId = await startSignIn(cfg);
    const { SAMLResponse } = signedResponse(cfg, requestId);

    const first = await verify(cfg, SAMLResponse);
    expect(first.inResponseTo).toBe(requestId);
    expect(await acceptAssertion(first, cfg)).toEqual({ ok: true });

    // The captured response, replayed: the request it answers is spent.
    await expect(verify(cfg, SAMLResponse)).rejects.toThrow(/InResponseTo/);
  });

  it("runs solicited assertions through the replay table too", async () => {
    const cfg = config();
    const requestId = await startSignIn(cfg);
    const { SAMLResponse, assertionId } = signedResponse(cfg, requestId);
    const profile = await verify(cfg, SAMLResponse);

    expect(await acceptAssertion(profile, cfg)).toEqual({ ok: true });
    // Even if the request id were somehow live again, the assertion is not.
    expect(await acceptAssertion(profile, cfg)).toEqual({ ok: false, reason: "assertion_replayed" });
    const [rows]: any = await db().execute("SELECT `id` FROM `saml_assertions_seen` WHERE `id` = ?", [assertionId]);
    expect(rows).toHaveLength(1);
  });

  it("refuses an answer to a request this instance never sent", async () => {
    const cfg = config();
    const { SAMLResponse } = signedResponse(cfg, "_never-issued-0123456789");
    await expect(verify(cfg, SAMLResponse)).rejects.toThrow(/InResponseTo/);
  });

  it("keeps request ids per provider", async () => {
    const cfg = config();
    const requestId = await startSignIn(cfg); // recorded for the default provider
    const other = new SamlRequestCache("partner");
    expect(await other.getAsync(requestId)).toBeNull();
    expect(await new SamlRequestCache("saml").getAsync(requestId)).not.toBeNull();
  });

  it("refuses provider-initiated sign-in unless allowed, and then accepts each assertion once", async () => {
    const closed = config();
    const { SAMLResponse } = signedResponse(closed, null);
    const unsolicited = await verify(closed, SAMLResponse);
    expect(await acceptAssertion(unsolicited, closed)).toEqual({ ok: false, reason: "idp_initiated_disabled" });

    const open = config({ samlAllowIdpInitiated: "true" });
    expect(await acceptAssertion(unsolicited, open)).toEqual({ ok: true });
    expect(await acceptAssertion(await verify(open, SAMLResponse), open)).toEqual({
      ok: false,
      reason: "assertion_replayed",
    });
  });

  it("pins the issuer where one is configured", async () => {
    const cfg = config({ samlIdpIssuer: "https://somebody-else.test/metadata" });
    const requestId = await startSignIn(cfg);
    const profile = await verify(cfg, signedResponse(cfg, requestId).SAMLResponse);
    expect(await acceptAssertion(profile, cfg)).toEqual({ ok: false, reason: "issuer_mismatch" });
  });
});
