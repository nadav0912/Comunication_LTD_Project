'use strict';

// Mail transport (SPEC.md §2, §9.5). One tiny interface — sendResetEmail(to, token) — so a transport
// swap (e.g. to Ethereal if Gmail is unavailable, risk R2) is a two-line change, and so tests can
// stub this one function without touching SMTP. The transporter is created lazily so importing this
// module never opens a connection.

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendResetEmail(to, token) {
  const ttl = Number(process.env.RESET_TOKEN_TTL_MINUTES) || 15;
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: 'Comunication_LTD password reset',
    text:
      `A password reset was requested for your Comunication_LTD account.\n\n` +
      `Your reset token is:\n\n${token}\n\n` +
      `Enter it on the reset page within ${ttl} minutes. ` +
      `If you did not request this, you can ignore this email.`,
  });
}

module.exports = { sendResetEmail };
