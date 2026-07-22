// ============================================================
// email.js — Email via Resend (replaces GAS MailApp)
// ============================================================

import { Resend } from 'resend'

var resend = new Resend(process.env.RESEND_API_KEY)

export var MailService = {
  async send({ to, subject, htmlBody }) {
    try {
      await resend.emails.send({
        from:    process.env.EMAIL_FROM || 'HR Platform <noreply@hrplatform.com>',
        to:      to,
        subject: subject,
        html:    htmlBody
      })
    } catch (e) {
      console.error('Email error:', e.message)
    }
  }
}
