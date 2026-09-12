import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";

export default defineNuxtConfig({
  features: {
    inlineStyles: true,
  },
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  modules: ["@nuxtjs/i18n", "@nuxtjs/mcp-toolkit", "motion-v/nuxt"],
  app: {
    head: {
      charset: "utf-8",
      viewport: "width=device-width, initial-scale=1",
      // The title/titleTemplate and the html lang attribute are set at runtime
      // in app.vue from runtimeConfig (NUXT_APP_NAME / NUXT_LANGUAGE); see the
      // notes there. The values here are only static fallbacks.
      htmlAttrs: {
        lang: "en",
      },
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "description", content: "" },
        { name: "format-detection", content: "telephone=no" },
      ],
      link: [
        // Icons are generated at runtime (see server/routes/favicon.svg.get.ts
        // and server/routes/touchicon.png.get.ts) so they pick up the instance's
        // configured primary colour instead of a build-time default. A single
        // favicon in the primary colour is used for both light and dark tabs:
        // Safari doesn't switch favicons by `prefers-color-scheme` (neither an
        // in-SVG media query nor a `media` link attribute works without a JS
        // polling shim), so a theme-specific variant only broke the other theme.
        // The PNG is the fallback for browsers without SVG-favicon support and
        // for the Apple touch icon (which doesn't support SVG).
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", href: "/touchicon.png" },
        { rel: "apple-touch-icon", href: "/touchicon.png" },
      ],
    },
  },
  site: {
    url: process.env.NUXT_BOARDS_URL || "http://localhost:3000",
    name: process.env.NUXT_APP_NAME || "LokalBoards",
    trailingSlash: true,
  },
  mcp: {
    name: process.env.NUXT_APP_NAME || "LokalBoards",
    // Read from package.json rather than repeated here. This is the version an
    // MCP client sees in the handshake, and as a second copy it silently fell
    // two releases behind.
    version: pkg.version,
    enabled: process.env.NUXT_MCP || true,
  },
  runtimeConfig: {
    public: {
      privacyUrl: process.env.NUXT_PUBLIC_PRIVACY_URL || "/privacy-policy/",
      signup: process.env.NUXT_PUBLIC_SIGNUP || true,
      colorPrimary: process.env.NUXT_PUBLIC_COLOR_PRIMARY || "#0066CC",
      colorPrimaryDark: process.env.NUXT_PUBLIC_COLOR_PRIMARY_DARK || "#0F72DE",
      colorPrimaryHover:
        process.env.NUXT_PUBLIC_COLOR_PRIMARY_HOVER || "#004C99",
      colorPrimaryHoverDark:
        process.env.NUXT_PUBLIC_COLOR_PRIMARY_HOVER_DARK || "#1C84EC",
      colorWhite: process.env.NUXT_PUBLIC_COLOR_WHITE || "#ffffff",
      colorGray: process.env.NUXT_PUBLIC_COLOR_GRAY || "#4E4E52",
      colorGrayDark: process.env.NUXT_PUBLIC_COLOR_GRAY_DARK || "#AEAEB2",
      colorSlate: process.env.NUXT_PUBLIC_COLOR_SLATE || "#F5F5F7",
      colorSlateDark: process.env.NUXT_PUBLIC_COLOR_SLATE_DARK || "#2C2C2E",
      colorBlack: process.env.NUXT_PUBLIC_COLOR_BLACK || "#000000",
      colorDark: process.env.NUXT_PUBLIC_COLOR_DARK || "#1C1C1E",
      colorDarkDark: process.env.NUXT_PUBLIC_COLOR_DARK_DARK || "#1C1C1E",
    },
    appName: process.env.NUXT_APP_NAME || "LokalBoards",
    language: process.env.NUXT_LANGUAGE || "en",
    boardsUrl: process.env.NUXT_BOARDS_URL || "http://localhost:3000",
    // How many days a login session stays valid. Defaults to 1 day.
    sessionMaxAgeDays: process.env.NUXT_SESSION_MAX_AGE_DAYS || "1",
    // The first administrator, created at boot when the instance has none. See
    // server/plugins/1.bootstrap-admin.ts. Empty by default: an instance set up
    // through the sign-up form needs neither.
    adminEmail: process.env.NUXT_ADMIN_EMAIL || "",
    adminPassword: process.env.NUXT_ADMIN_PASSWORD || "",
    adminName: process.env.NUXT_ADMIN_NAME || "Administrator",
    mysqlHost: process.env.NUXT_MYSQL_HOST || "localhost",
    mysqlDatabase: process.env.NUXT_MYSQL_DATABASE || "root",
    mysqlUser: process.env.NUXT_MYSQL_USER || "root",
    mysqlPassword: process.env.NUXT_MYSQL_PASSWORD || "root1234",
    mysqlSsl: process.env.NUXT_MYSQL_SSL || "",
    mysqlSslRejectUnauthorized:
      process.env.NUXT_MYSQL_SSL_REJECT_UNAUTHORIZED || "",
    emailHost: process.env.NUXT_EMAIL_HOST || "mail.yourserver.de",
    emailPort: process.env.NUXT_EMAIL_PORT || 465,
    emailSecure: process.env.NUXT_EMAIL_SECURE || true,
    emailUser: process.env.NUXT_EMAIL_USER || "contact@yourdomain.com",
    emailPass: process.env.NUXT_EMAIL_PASS || "password1234",

    // --- Single sign-on (OpenID Connect) ---------------------------------
    // Off unless an issuer and a client are configured. See docs/sso.
    ssoEnabled: process.env.NUXT_SSO_ENABLED || false,
    ssoLabel: process.env.NUXT_SSO_LABEL || "Single sign-on",
    // The provider's issuer URL. Everything else is read from its discovery
    // document at `<issuer>/.well-known/openid-configuration`.
    ssoIssuer: process.env.NUXT_SSO_ISSUER || "",
    ssoClientId: process.env.NUXT_SSO_CLIENT_ID || "",
    ssoClientSecret: process.env.NUXT_SSO_CLIENT_SECRET || "",
    ssoScopes: process.env.NUXT_SSO_SCOPES || "openid profile email",
    // "auto" creates an account on first sign-in; "existing" only lets in
    // people who already have one here.
    ssoProvision: process.env.NUXT_SSO_PROVISION || "auto",
    // Restrict sign-in to these e-mail domains, comma separated.
    ssoAllowedDomains: process.env.NUXT_SSO_ALLOWED_DOMAINS || "",
    // Read the administrator role from a claim — a group or a role the provider
    // sends — instead of managing it here.
    ssoAdminClaim: process.env.NUXT_SSO_ADMIN_CLAIM || "",
    ssoAdminValue: process.env.NUXT_SSO_ADMIN_VALUE || "",
    // Where the identity lives in the provider's response. The defaults are the
    // OpenID Connect claim names; a plain OAuth 2.0 provider often uses its own
    // (GitHub answers with `id` and `login`, for instance). Several names can be
    // given, comma separated and tried in order, and dots step into nested
    // objects.
    ssoClaimSubject: process.env.NUXT_SSO_CLAIM_SUBJECT || "",
    ssoClaimEmail: process.env.NUXT_SSO_CLAIM_EMAIL || "",
    ssoClaimName: process.env.NUXT_SSO_CLAIM_NAME || "",
    // Only for providers that publish no discovery document, or to pin the
    // endpoints by hand. Set the first two together.
    ssoAuthorizationUrl: process.env.NUXT_SSO_AUTHORIZATION_URL || "",
    ssoTokenUrl: process.env.NUXT_SSO_TOKEN_URL || "",
    ssoUserinfoUrl: process.env.NUXT_SSO_USERINFO_URL || "",
    // E-mail domains this provider signs in, for routing somebody to the right
    // one when several are configured. Unlike the allow-list, this refuses
    // nobody by itself.
    ssoDomains: process.env.NUXT_SSO_DOMAINS || "",
    // Extra providers, by name: NUXT_SSO_PROVIDERS=entra,partner then
    // NUXT_SSO_ENTRA_ISSUER=… and so on. See docs/single-sign-on.
    ssoProviders: process.env.NUXT_SSO_PROVIDERS || "",

    // --- Single sign-on (SAML 2.0) ---------------------------------------
    // For providers that speak SAML rather than OpenID Connect. Both can be on
    // at once; each gets its own button. See docs/single-sign-on.
    samlEnabled: process.env.NUXT_SAML_ENABLED || false,
    samlLabel: process.env.NUXT_SAML_LABEL || "SAML single sign-on",
    // Where to send people to sign in (the provider's SSO URL), and the
    // certificate its assertions are signed with. Several certificates may be
    // given, comma separated, which is how a rollover is survived.
    samlEntryPoint: process.env.NUXT_SAML_ENTRY_POINT || "",
    samlIdpCert: process.env.NUXT_SAML_IDP_CERT || "",
    // The provider's entity id, checked against the assertion's issuer.
    samlIdpIssuer: process.env.NUXT_SAML_IDP_ISSUER || "",
    // Our own entity id. Defaults to NUXT_BOARDS_URL.
    samlEntityId: process.env.NUXT_SAML_ENTITY_ID || "",
    samlIdentifierFormat: process.env.NUXT_SAML_IDENTIFIER_FORMAT || "",
    samlSignatureAlgorithm: process.env.NUXT_SAML_SIGNATURE_ALGORITHM || "",
    samlClockSkewSeconds: process.env.NUXT_SAML_CLOCK_SKEW_SECONDS || "60",
    samlDisableRequestedAuthnContext:
      process.env.NUXT_SAML_DISABLE_REQUESTED_AUTHN_CONTEXT || "",
    // Require the response document to be signed as well as the assertion.
    // Off by default: most providers sign the assertion alone.
    samlWantResponseSigned: process.env.NUXT_SAML_WANT_RESPONSE_SIGNED || "",
    // Where the identity lives in the assertion. SAML attribute names are
    // rarely friendly, so these matter more than their OpenID Connect
    // counterparts; the defaults cover the common spellings.
    samlAttributeSubject: process.env.NUXT_SAML_ATTRIBUTE_SUBJECT || "",
    samlAttributeEmail: process.env.NUXT_SAML_ATTRIBUTE_EMAIL || "",
    samlAttributeName: process.env.NUXT_SAML_ATTRIBUTE_NAME || "",
    samlAdminAttribute: process.env.NUXT_SAML_ADMIN_ATTRIBUTE || "",
    samlAdminValue: process.env.NUXT_SAML_ADMIN_VALUE || "",
    // Fall back to the OpenID Connect policy when not set separately.
    samlProvision: process.env.NUXT_SAML_PROVISION || "",
    samlAllowedDomains: process.env.NUXT_SAML_ALLOWED_DOMAINS || "",
    samlDomains: process.env.NUXT_SAML_DOMAINS || "",
    samlProviders: process.env.NUXT_SAML_PROVIDERS || "",
    // Decrypting assertions, for providers that require encryption. The private
    // key stays here; the certificate goes in our metadata for the provider to
    // encrypt with.
    samlDecryptionKey: process.env.NUXT_SAML_DECRYPTION_KEY || "",
    samlDecryptionCert: process.env.NUXT_SAML_DECRYPTION_CERT || "",
    // Accept assertions that arrive without our having asked — somebody
    // clicking the application's tile in their provider's portal.
    samlAllowIdpInitiated: process.env.NUXT_SAML_ALLOW_IDP_INITIATED || "",
  },
  css: ["~/assets/css/main.css"],
  i18n: {
    // Bundle every locale and pick the active one at runtime from
    // NUXT_LANGUAGE (see app/plugins/i18n-locale.ts). The config is evaluated
    // at build time when the env variable isn't available, so we can't select
    // the language here. "no_prefix" keeps URLs unprefixed (as before, since
    // the single default locale was never prefixed).
    strategy: "no_prefix",
    defaultLocale: "en",
    detectBrowserLanguage: false,
    locales: [
      { code: "en", file: "en.json" },
      { code: "de", file: "de.json" },
      { code: "fr", file: "fr.json" },
      { code: "es", file: "es.json" },
      { code: "it", file: "it.json" },
      { code: "nl", file: "nl.json" },
      { code: "pl", file: "pl.json" },
      { code: "uk", file: "uk.json" },
      { code: "pt", file: "pt.json" },
      { code: "cs", file: "cs.json" },
    ],
  },
  nitro: {
    // Pre-compress static assets (JS/CSS/etc.) at build time. The node server
    // serves the .br/.gz variant when the client's Accept-Encoding allows,
    // which is a big win for the large client bundle. Uses Node's built-in
    // zlib, so no extra dependency.
    compressPublicAssets: {
      gzip: true,
      brotli: true,
    },
    experimental: {
      tasks: true,
      websocket: true,
      asyncContext: true,
    },
    scheduledTasks: {
      // Email unread notifications every hour
      "0 * * * *": ["notification"],
      // Fire card due-date reminders every 5 minutes
      "*/5 * * * *": ["due-reminders"],
      // Empty the archive of anything past its retention, once a night
      "30 3 * * *": ["archive-retention"],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  ssr: true,
  telemetry: false,
});
