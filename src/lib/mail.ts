import "server-only";
import nodemailer from "nodemailer";

type Mail = { to: string; subject: string; text: string };

let transport: nodemailer.Transporter | null | undefined;

function getTransport() {
  if (transport !== undefined) return transport;
  transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  return transport;
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Sends via SMTP when configured; otherwise logs to the server console (development). */
export async function sendMail(mail: Mail) {
  const t = getTransport();
  if (!t) {
    console.info(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
    return;
  }
  await t.sendMail({ from: process.env.MAIL_FROM ?? "CareerPoint <no-reply@careerpoint.local>", ...mail });
}
