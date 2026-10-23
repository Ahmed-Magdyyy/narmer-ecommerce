import nodemailer from 'nodemailer';
import { AppError } from '../../errors/app-error.js';

export function createEmailSender(config) {
  const smtp = config.smtp;
  const transport = smtp ? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465, requireTLS: smtp.port !== 465,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
  }) : null;
  return {
    assertReady() {
      if (!transport) throw new AppError(503, 'EMAIL_UNAVAILABLE');
    },
    async sendNotification({ to, subject, text }) {
      if (!transport) throw new AppError(503, 'EMAIL_UNAVAILABLE');
      await transport.sendMail({ from: smtp.from, to: { address: to }, subject, text });
    },
    async sendOtp({ to, store, purpose, code, locale }) {
      if (!transport) throw new AppError(503, 'EMAIL_UNAVAILABLE');
      const ar = locale === 'ar';
      const title = purpose === 'verify-email'
        ? (ar ? 'تأكيد البريد الإلكتروني' : 'Confirm your email')
        : (ar ? 'إعادة تعيين كلمة المرور' : 'Reset your password');
      await transport.sendMail({ from: smtp.from, to, subject: `Narmer ${store.toUpperCase()} - ${title}`,
        text: ar ? `رمز التحقق: ${code}\nصالح لمدة 10 دقائق. لا تشارك هذا الرمز مع أي شخص.`
          : `Your code is: ${code}\nIt expires in 10 minutes. Do not share this code with anyone.` });
    },
  };
}
