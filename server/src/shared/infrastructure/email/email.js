import nodemailer from 'nodemailer';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../errors/app-error.js';
import { logoCid, renderOtpEmail } from './templates.js';

const logo = { filename: 'narmer-logo.png', path: fileURLToPath(new URL('./assets/narmer-logo.png', import.meta.url)),
  cid: logoCid, contentType: 'image/png', contentDisposition: 'inline' };

export function createEmailSender(config) {
  const smtp = config.smtp;
  const from = smtp ? { name: 'Narmer', address: /<([^<>]+)>\s*$/.exec(smtp.from)?.[1] ?? smtp.from } : null;
  const transport = smtp ? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465, requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
  }) : null;
  return {
    assertReady() {
      if (!transport) throw new AppError(503, 'EMAIL_UNAVAILABLE');
    },
    async sendNotification({ to, subject, text, html }) {
      if (!transport) throw new AppError(503, 'EMAIL_UNAVAILABLE');
      await transport.sendMail({ from, to: { address: to }, subject, text,
        ...(html ? { html, attachments: [{ ...logo }] } : {}) });
    },
    async sendOtp({ to, purpose, code, locale }) {
      if (!transport) throw new AppError(503, 'EMAIL_UNAVAILABLE');
      await transport.sendMail({ from, to: { address: to }, ...renderOtpEmail({ purpose, code, locale }), attachments: [{ ...logo }] });
    },
  };
}
