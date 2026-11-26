import nodemailer from "nodemailer";
import { logger } from "../../server/utils/logger";

const runtimeConfig = useRuntimeConfig();

const emailHost = runtimeConfig.emailHost;
const emailPort = runtimeConfig.emailPort;
const emailSecure = runtimeConfig.emailSecure;
const emailUser = runtimeConfig.emailUser;
const emailPass = runtimeConfig.emailPass;

const transporter = nodemailer.createTransport({
  host: emailHost,
  port: parseInt(emailPort, 10),
  secure: emailSecure, // true for 465, false for other ports
  auth: {
    user: emailUser,
    pass: emailPass,
  },
});

// `attachments` is optional and passed straight to nodemailer. The notification
// mail uses it for inline (cid:) avatars, because avatars uploaded through the
// profile are stored as data: URIs and most mail clients refuse to render those.
// Without NUXT_EMAIL_HOST there is nowhere to send to: nothing is sent, and the
// log says why once rather than with every invitation and every hourly digest.
let warnedUnconfigured = false;

export const sendEmail = async ({ to, subject, text, attachments = [] }) => {
  if (!emailHost) {
    if (!warnedUnconfigured) {
      logger.warn("No e-mail is sent: NUXT_EMAIL_HOST is not set.");
      warnedUnconfigured = true;
    }
    return null;
  }
  const mailOptions = {
    from: emailUser,
    to,
    subject,
    html: text,
    ...(attachments.length > 0 ? { attachments } : {}),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info("Email sent", { messageId: info.messageId });
    return info;
  } catch (error) {
    logger.error("Error sending email", error);
    throw error;
  }
};
