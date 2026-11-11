import {
  emailButton,
  emailFallbackLink,
  emailLayout,
  emailLink,
  emailParagraph,
  escapeEmailHtml,
} from "./emailLayout";
import { serverText } from "./serverText";

// The e-mails the server sends, in the instance's language. Their words live
// in i18n/locales with every other word of the app (see serverText.ts), so a
// language is translated in one place, and anything a language lacks is
// English.
const translate = (key: string, language = "en") => serverText(language)(key);

export function getEmailSubject(
  key: string,
  appName: string,
  language: string = "en",
): string {
  return `${translate(key, language)} | ${appName}`;
}

export function getEmailMessage(
  key: string,
  resetLink: string,
  language: string = "en",
): string {
  return emailLayout(
    emailParagraph(escapeEmailHtml(translate(key, language))) +
      emailButton(resetLink, translate("reset_password_cta", language)) +
      emailFallbackLink(resetLink),
  );
}

// Fill a plain-text template (with {placeholders} and blank-line-separated
// paragraphs) and turn it into email HTML in the shared style — the same shell
// the notification mail uses (see utils/emailLayout.ts).
//
// All values are HTML-escaped. A placeholder whose key ends in "URL" is the
// mail's action: on its own line it becomes a button, with the raw link kept
// underneath for clients that strip it; inline it stays a plain link.
function buildEmailHtml(
  template: string,
  vars: Record<string, string>,
  ctaLabel?: string,
): string {
  const paragraphs = template.split("\n\n").map((paragraph) => {
    // The action link always ends a paragraph, either alone or under a line of
    // lead-in text ("Sign in here:\n{loginURL}"). Split it off so the text
    // stays a paragraph and the link becomes the button.
    const lines = paragraph.split("\n");
    const urlKey = lines[lines.length - 1]
      ?.trim()
      .match(/^\{(\w*URL)\}$/)?.[1];
    let action = "";
    if (urlKey && vars[urlKey]) {
      const url = vars[urlKey];
      action = ctaLabel
        ? emailButton(url, ctaLabel) + emailFallbackLink(url)
        : emailParagraph(emailLink(url));
      lines.pop();
      paragraph = lines.join("\n");
      if (!paragraph.trim()) return action;
    }
    let html = escapeEmailHtml(paragraph);
    for (const [key, value] of Object.entries(vars)) {
      const replacement = /URL$/.test(key)
        ? emailLink(value ?? "")
        : escapeEmailHtml(value ?? "");
      html = html.split(escapeEmailHtml(`{${key}}`)).join(replacement);
    }
    return emailParagraph(html) + action;
  });
  return emailLayout(paragraphs.join(""));
}

// Welcome email for a public self-signup (no credentials — the user chose them).
export function getWelcomeSignupEmail({
  appName,
  name,
  loginURL,
  language = "en",
}: {
  appName: string;
  name: string;
  loginURL: string;
  language?: string;
}): { subject: string; html: string } {
  return {
    subject: getEmailSubject("welcome_subject", appName, language),
    html: buildEmailHtml(
      translate("welcome_signup_message", language),
      { appName, name, loginURL },
      translate("welcome_cta", language),
    ),
  };
}

// Welcome email for an admin-created account — states who created it and
// includes the login credentials so the user can sign in.
export function getWelcomeAdminEmail({
  appName,
  name,
  adminName,
  email,
  password,
  loginURL,
  language = "en",
}: {
  appName: string;
  name: string;
  adminName: string;
  email: string;
  password: string;
  loginURL: string;
  language?: string;
}): { subject: string; html: string } {
  return {
    subject: getEmailSubject("welcome_subject", appName, language),
    html: buildEmailHtml(
      translate("welcome_admin_message", language),
      { appName, name, adminName, email, password, loginURL },
      translate("welcome_cta", language),
    ),
  };
}

// Board-invitation email — sent directly when a user is invited, with a link to
// the board and their access level (read-only vs read & write).
export function getBoardInviteEmail({
  appName,
  name,
  inviterName,
  boardName,
  permission,
  boardURL,
  language = "en",
}: {
  appName: string;
  name: string;
  inviterName: string;
  boardName: string;
  permission: string;
  boardURL: string;
  language?: string;
}): { subject: string; html: string } {
  const permissionLabel = translate(
    permission === "edit"
      ? "board_invite_permission_edit"
      : "board_invite_permission_read",
    language,
  );
  return {
    subject: getEmailSubject("board_invite_subject", appName, language),
    html: buildEmailHtml(
      translate("board_invite_message", language),
      {
        appName,
        name,
        inviterName,
        boardName,
        permission: permissionLabel,
        boardURL,
      },
      translate("board_invite_cta", language),
    ),
  };
}

// The invitation sent to somebody who has no account yet: the same facts as the
// board invite above, but the link creates the account rather than opening the
// board, because there is nothing yet to open.
export function getBoardInviteSignupEmail({
  appName,
  inviterName,
  boardName,
  permission,
  signupURL,
  language = "en",
}: {
  appName: string;
  inviterName: string;
  boardName: string;
  permission: string;
  signupURL: string;
  language?: string;
}): { subject: string; html: string } {
  const permissionLabel = translate(
    permission === "edit"
      ? "board_invite_permission_edit"
      : "board_invite_permission_read",
    language,
  );
  return {
    subject: getEmailSubject("board_invite_subject", appName, language),
    html: buildEmailHtml(
      translate("board_invite_signup_message", language),
      {
        appName,
        inviterName,
        boardName,
        permission: permissionLabel,
        signupURL,
      },
      translate("board_invite_signup_cta", language),
    ),
  };
}

// Account-deletion email — tells the user their account was removed and why,
// so a silent deletion doesn't leave them wondering.
export function getAccountDeletedEmail({
  appName,
  name,
  reason,
  language = "en",
}: {
  appName: string;
  name: string;
  reason: string;
  language?: string;
}): { subject: string; html: string } {
  return {
    subject: getEmailSubject("account_deleted_subject", appName, language),
    html: buildEmailHtml(translate("account_deleted_message", language), {
      appName,
      name,
      reason,
    }),
  };
}
