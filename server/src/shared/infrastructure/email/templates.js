export const logoCid = 'narmer-logo';

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const copy = {
  en: {
    greeting: name => `Hello ${name},`, reference: 'Reference', status: 'Recorded status', time: 'Update time', total: 'Total',
    view: 'View your order', viewRequest: 'View your request', private: 'This link is private. Do not share it.',
    unavailable: 'A tracking link is unavailable in this email. Use your saved link if it has not expired, or contact our staff.',
    refund: 'Our staff handles any refund offline. This email does not confirm that a refund has been issued.',
    footer: 'An automated message from Narmer.', latest: 'This email records an update. Open your order or request to see its latest status.',
    code: 'Your verification code', expires: 'Valid for 10 minutes. Do not share this code with anyone.',
    ignore: 'If you did not request this code, you can ignore this email.',
    verify: ['Confirm your email', 'Welcome to Narmer. Use the code below to confirm your email address.'],
    reset: ['Reset your password', 'Use the code below to continue resetting your Narmer password.'],
    pending: ['Order received', 'Thank you for choosing Narmer. We have received your order and it is awaiting review.', 'Pending'],
    accepted: ['Your order is accepted', 'Your order has been accepted. You can view its latest status using the button below.', 'Accepted'],
    shipped: ['Your order is on its way', 'Your order has been marked as shipped. View your order for its latest status.', 'Shipped'],
    delivered: ['Your order is delivered', 'Your order has been marked as delivered. Thank you for choosing Narmer.', 'Delivered'],
    canceled: ['Your order is canceled', 'Your order has been canceled. You can still view the order details below.', 'Canceled'],
    returned: ['Your order is returned', 'Your order has been marked as returned. You can view the recorded details below.', 'Returned'],
    submitted: ['Request received', 'Thank you for your interest in Narmer. We have received your request.', 'Submitted'],
    contacted: ['An update on your request', 'Our team has marked your request as contacted. View your request for its latest status.', 'Contacted'],
  },
  ar: {
    greeting: name => `مرحباً ${name}،`, reference: 'رقم الطلب', status: 'الحالة المسجلة', time: 'وقت التحديث', total: 'الإجمالي',
    view: 'عرض الطلب', viewRequest: 'عرض طلب الخدمة', private: 'هذا الرابط خاص. لا تشاركه مع الآخرين.',
    unavailable: 'رابط التتبع غير متاح في هذا البريد. استخدم الرابط المحفوظ إذا لم تنته صلاحيته، أو تواصل مع فريقنا.',
    refund: 'يتولى فريقنا معالجة أي استرداد مالي خارج النظام. لا يؤكد هذا البريد تنفيذ استرداد مالي.',
    footer: 'رسالة آلية من نارمر.', latest: 'يسجل هذا البريد تحديثاً على طلبك. افتح الطلب للاطلاع على أحدث حالة.',
    code: 'رمز التحقق الخاص بك', expires: 'صالح لمدة 10 دقائق. لا تشارك هذا الرمز مع أي شخص.',
    ignore: 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.',
    verify: ['تأكيد البريد الإلكتروني', 'أهلاً بك في نارمر. استخدم الرمز التالي لتأكيد عنوان بريدك الإلكتروني.'],
    reset: ['إعادة تعيين كلمة المرور', 'استخدم الرمز التالي لمتابعة إعادة تعيين كلمة مرور حسابك في نارمر.'],
    pending: ['استلمنا طلبك', 'شكراً لاختيارك نارمر. استلمنا طلبك وهو الآن قيد المراجعة.', 'قيد المراجعة'],
    accepted: ['تم قبول طلبك', 'تم قبول طلبك. يمكنك الاطلاع على أحدث حالة من خلال الزر أدناه.', 'مقبول'],
    shipped: ['طلبك في الطريق إليك', 'تم تسجيل طلبك بحالة تم الشحن. افتح الطلب للاطلاع على أحدث حالة.', 'تم الشحن'],
    delivered: ['تم تسليم طلبك', 'تم تسجيل طلبك بحالة تم التسليم. شكراً لاختيارك نارمر.', 'تم التسليم'],
    canceled: ['تم إلغاء طلبك', 'تم إلغاء طلبك. يمكنك الاطلاع على تفاصيل الطلب أدناه.', 'ملغي'],
    returned: ['تم إرجاع طلبك', 'تم تسجيل طلبك بحالة مرتجع. يمكنك الاطلاع على التفاصيل أدناه.', 'مرتجع'],
    submitted: ['استلمنا طلب الخدمة', 'شكراً لاهتمامك بنارمر. استلمنا طلبك بنجاح.', 'تم إرسال الطلب'],
    contacted: ['تحديث على طلب الخدمة', 'سجل فريقنا طلبك بحالة تم التواصل. افتح الطلب للاطلاع على أحدث حالة.', 'تم التواصل'],
  },
};

function layout({ locale, title, intro, content, note }) {
  const ar = locale === 'ar', text = copy[ar ? 'ar' : 'en'];
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f6;color:#143743;font-family:Arial,Tahoma,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;color:#f1f5f6;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(intro)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f6;"><tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #dce6e9;border-top:5px solid #003e52;border-radius:12px;">
<tr><td align="center" style="padding:26px 24px 20px;border-bottom:1px solid #e8eef0;"><img src="cid:${logoCid}" width="128" height="128" alt="Narmer" style="display:block;border:0;width:128px;height:128px;color:#003e52;font-size:20px;"></td></tr>
<tr><td dir="${ar ? 'rtl' : 'ltr'}" align="${ar ? 'right' : 'left'}" style="padding:32px 24px;">
<h1 style="margin:0 0 16px;color:#003e52;font-size:28px;line-height:1.4;font-weight:700;">${escape(title)}</h1>
<p style="margin:0 0 24px;color:#49616b;font-size:16px;line-height:1.8;">${escape(intro)}</p>
${content}
${note ? `<p style="margin:24px 0 0;color:#61747c;font-size:13px;line-height:1.8;">${escape(note)}</p>` : ''}
</td></tr>
<tr><td align="center" style="padding:20px 24px;background-color:#f8fafb;border-top:1px solid #e8eef0;"><p style="margin:0;color:#61747c;font-size:12px;line-height:1.8;">${escape(text.footer)}</p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

export function renderOtpEmail({ purpose, code, locale = 'en' }) {
  const text = copy[locale === 'ar' ? 'ar' : 'en'];
  const [title, intro] = text[purpose === 'verify-email' ? 'verify' : 'reset'];
  return {
    subject: `Narmer - ${title}`,
    text: [title, intro, `${text.code}: ${code}`, text.expires, text.ignore, text.footer].join('\n\n'),
    html: layout({ locale, title, intro, note: text.ignore,
      content: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f7f8;border:1px solid #d9e7eb;border-radius:8px;"><tr><td align="center" style="padding:24px 12px;">
<p style="margin:0 0 12px;color:#49616b;font-size:14px;">${escape(text.code)}</p>
<div dir="ltr" style="color:#003e52;font-family:Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:8px;line-height:1.4;">${escape(code)}</div>
<p style="margin:16px 0 0;color:#61747c;font-size:13px;line-height:1.8;">${escape(text.expires)}</p>
</td></tr></table>` }),
  };
}

export function renderNotificationEmail({ store, event, status, locale = 'en', name, reference, at, total, link }) {
  const ar = locale === 'ar', text = copy[ar ? 'ar' : 'en'], order = store === 'b2c';
  const supported = order ? (event === 'order.placed' ? status === 'pending' : event === 'order.status' && ['accepted', 'shipped', 'delivered', 'canceled', 'returned'].includes(status))
    : store === 'b2b' && ((event === 'lead.submitted' && status === 'submitted') || (event === 'lead.contacted' && status === 'contacted'));
  if (!supported) throw new Error('Unsupported notification template.');
  if (link) {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid notification link.');
  }
  const [title, intro, label] = text[status];
  const timestamp = new Date(at).toISOString();
  const displayTime = new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
  const rows = [[text.reference, reference], [text.status, label], [`${text.time} (${ar ? 'القاهرة' : 'Cairo'})`, displayTime]];
  if (order) rows.push([text.total, new Intl.NumberFormat(ar ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(total / 100)]);
  const refund = order && ['canceled', 'returned'].includes(status) ? text.refund : null;
  const button = order ? text.view : text.viewRequest;
  const plain = [text.greeting(name), intro, `${text.reference}: ${reference}`, `${text.status}: ${label}`, `${text.time}: ${timestamp}`];
  if (order) plain.push(`${text.total}: ${rows.at(-1)[1]}`);
  if (refund) plain.push(refund);
  plain.push(link ? `${button}: ${link}` : text.unavailable);
  if (link) plain.push(text.private);
  plain.push(text.latest, text.footer);
  const details = rows.map(([key, value], index) => `<tr><td style="padding:14px 16px;${index ? 'border-top:1px solid #e0e9ec;' : ''}color:#61747c;font-size:14px;vertical-align:top;">${escape(key)}</td><td style="padding:14px 16px;${index ? 'border-top:1px solid #e0e9ec;' : ''}color:#003e52;font-size:14px;font-weight:700;overflow-wrap:anywhere;word-break:break-word;">${escape(value)}</td></tr>`).join('');
  const action = link ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;"><tr><td align="center" bgcolor="#003e52" style="border-radius:6px;"><a href="${escape(link)}" style="display:inline-block;padding:16px 28px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1.3;">${escape(button)}</a></td></tr></table>
<p style="margin:14px 0 0;color:#61747c;font-size:12px;line-height:1.8;">${escape(text.private)}</p>`
    : `<p style="margin:24px 0 0;color:#61747c;font-size:14px;line-height:1.8;">${escape(text.unavailable)}</p>`;
  return {
    subject: `Narmer - ${title}`,
    text: plain.join('\n\n'),
    html: layout({ locale, title, intro, note: text.latest,
      content: `<p style="margin:0 0 18px;color:#143743;font-size:16px;line-height:1.8;">${escape(text.greeting(name))}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafb;border:1px solid #e0e9ec;border-radius:8px;">${details}</table>
${refund ? `<p style="margin:20px 0 0;padding:16px;background-color:#fbf7ed;color:#76613c;font-size:14px;line-height:1.8;border-radius:6px;">${escape(refund)}</p>` : ''}
${action}` }),
  };
}
