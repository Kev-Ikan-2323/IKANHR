// ============================================================
// email.js — Email via Resend (replaces GAS MailApp)
// ============================================================

import { Resend } from 'resend'
import { DB } from './db.js'

var resend = new Resend(process.env.RESEND_API_KEY)

async function _isEnabled() {
  try {
    var rows = await DB.getBy('Config', 'key', 'emailEnabled')
    if (rows.length === 0) return true   // default: enabled when not set
    return rows[0].value !== 'false'
  } catch (e) {
    return true
  }
}

export var MailService = {
  async send({ to, subject, htmlBody }) {
    try {
      var enabled = await _isEnabled()
      if (!enabled) {
        console.log('[MailService] Emails disabled, skipping:', subject)
        return
      }
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
