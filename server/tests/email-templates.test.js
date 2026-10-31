import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { renderOtpEmail, renderNotificationEmail, logoCid } from '../src/shared/infrastructure/email/templates.js';
import { createEmailSender } from '../src/shared/infrastructure/email/email.js';

const input = { name:'Mona Saleh', reference:'NRM-20261030-74M9Y3', at:'2026-10-30T10:05:00Z', total:17000,
  link:`https://shop.example.test/orders/${'1'.repeat(24)}#token=${'x'.repeat(43)}` };
const cases = [
  ['b2c','order.placed','pending'],
  ...['accepted','shipped','delivered','canceled','returned'].map(status=>['b2c','order.status',status]),
  ['b2b','lead.submitted','submitted'],['b2b','lead.contacted','contacted'],
];

test('all ten email types have English/Arabic HTML, text fallbacks and Narmer branding without store labels', () => {
  for(const locale of ['en','ar']) {
    const subjects = new Set();
    const messages = ['verify-email','reset-password'].map(purpose=>renderOtpEmail({purpose,code:'012345',locale}));
    for(const [store,event,status] of cases) {
      const message=renderNotificationEmail({...input,store,event,status,locale});
      assert.ok(message.text.includes(input.reference)&&message.html.includes(input.reference));
      assert.ok(message.text.includes(input.at.replace('Z','.000Z')));
      assert.ok(message.html.includes(input.link));
      if(store==='b2b')assert.ok(!message.text.includes(locale==='ar'?'الإجمالي':'Total'));
      messages.push(message);
    }
    for(const message of messages) {
      assert.ok(message.subject.startsWith('Narmer - '));
      assert.ok(!/\bB2[BC]\b/i.test(message.subject+message.text+message.html));
      assert.match(message.html,new RegExp(`lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"`));
      assert.ok(message.html.includes(`src="cid:${logoCid}"`));
      assert.match(message.html,/alt="Narmer"/);
      assert.ok(message.html.includes('max-width:600px'));
      assert.ok(!/<script|<form|<iframe|https?:\/\/[^\s"<>]+\.(?:woff|css)/i.test(message.html));
      assert.ok(message.text.length>50);subjects.add(message.subject);
    }
    assert.equal(subjects.size,10);
    assert.ok(messages[0].html.includes('012345')&&messages[0].text.includes('012345'));
    assert.ok(!messages[1].html.includes('href='));
  }
});

test('customer data and links are escaped, unsafe links are rejected, and missing links do not produce a button', () => {
  const message=renderNotificationEmail({...input,store:'b2c',event:'order.placed',status:'pending',
    name:'<img src=x onerror="attack()"> & \'name\'',reference:'<script>bad()</script>',link:input.link+'&value="quoted"'});
  assert.ok(!message.html.includes('<script>bad()'));
  assert.ok(!message.html.includes('<img src=x'));
  assert.ok(message.html.includes('&lt;img src=x onerror=&quot;attack()&quot;&gt; &amp; &#39;name&#39;'));
  assert.ok(message.html.includes('&amp;value=&quot;quoted&quot;'));
  for(const link of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.test/']) {
    assert.throws(()=>renderNotificationEmail({...input,store:'b2c',event:'order.placed',status:'pending',link}),/Invalid notification link/);
  }
  const missing=renderNotificationEmail({...input,store:'b2c',event:'order.status',status:'returned',link:null});
  assert.ok(!missing.html.includes('href='));
  assert.ok(missing.text.includes('refund offline')&&missing.html.includes('does not confirm'));
  assert.ok(missing.text.includes('saved link')&&!missing.text.includes('null'));
  assert.throws(()=>renderNotificationEmail({...input,store:'b2b',event:'order.status',status:'shipped'}),/Unsupported/);
});

test('HTML and inline PNG are assembled into real MIME without connecting to SMTP', async t => {
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const messages=[];
  t.mock.method(nodemailer,'createTransport',()=>({async sendMail(message){messages.push(await transport.sendMail(message));}}));
  const config={smtp:{host:'smtp.example.test',port:587,user:'test',password:'synthetic',from:'Narmer B2C <sender@example.test>'}};
  const email=createEmailSender(config);
  await email.sendOtp({to:'buyer@example.test',store:'b2c',purpose:'verify-email',code:'012345',locale:'en'});
  await email.sendNotification({to:'buyer@example.test',...renderNotificationEmail({...input,store:'b2c',event:'order.status',status:'shipped'})});
  for(const {message} of messages) {
    assert.ok(message.length<100000);
    const mime=message.toString('utf8');
    assert.match(mime,/Content-Type: multipart\/alternative/);
    assert.match(mime,/Content-Type: text\/plain/);assert.match(mime,/Content-Type: text\/html/);
    assert.match(mime,/Content-ID: <narmer-logo>/);assert.match(mime,/Content-Type: image\/png/);
    assert.match(mime,/Content-Disposition: inline/);
    assert.ok(!/Narmer B2[BC]/i.test(mime));
    assert.match(mime,/From: Narmer <sender@example.test>/);
  }
  config.smtp.from='sender@example.test';
  await createEmailSender(config).sendOtp({to:'buyer@example.test',purpose:'reset-password',code:'654321',locale:'en'});
  assert.match(messages.at(-1).message.toString('utf8'),/From: Narmer <sender@example.test>/);
  const metadata=await sharp(fileURLToPath(new URL('../src/shared/infrastructure/email/assets/narmer-logo.png',import.meta.url))).metadata();
  assert.equal(metadata.format,'png');assert.equal(metadata.hasAlpha,true);
});
