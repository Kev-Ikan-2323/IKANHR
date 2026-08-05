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
    var enabled = await _isEnabled()
    if (!enabled) {
      console.log('[MailService] Emails disabled, skipping:', subject)
      return null
    }

    var from = process.env.EMAIL_FROM || 'HR Platform <noreply@hrplatform.com>'
    var result = await resend.emails.send({ from, to, subject, html: htmlBody })

    // SDK v3 returns {data, error} — never throws
    if (result.error) {
      var msg = (result.error.message || result.error.name || JSON.stringify(result.error))
      console.error('[MailService] Resend error:', msg, '| from:', from, '| to:', to)
      throw new Error('Resend: ' + msg)
    }

    console.log('[MailService] Sent ok — id:', result.data && result.data.id, '| to:', to)
    return result.data
  }
}
