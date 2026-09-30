// GET /api/cron/attendance-reminder
// Sends reminder emails for pending remote check-ins.
// Called at 4 PM and 7 PM CDMX by Vercel Cron.
// Also auto-closes stale pending records at midnight.

import { RemoteCheckinModule } from '../../../modules/remote-checkin.js'

// Actions:
//   reminder      → 4pm and 7pm CDMX: remind managers of pending remote check-ins
//   autoclose     → midnight CDMX: auto-deny still-pending requests
//   absent-alert  → 9:10am CDMX: notify managers of absent employees
//   remote-reminder → 9:05am CDMX: remind isRemote employees to check in

export default async function handler(req, res) {
  var authHeader = req.headers['authorization']
  var cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  var action = req.query.action || 'reminder'

  try {
    var result
    if (action === 'autoclose') {
      result = await RemoteCheckinModule.autoClose()
    } else if (action === 'absent-alert') {
      result = await RemoteCheckinModule.absentAlert()
    } else if (action === 'remote-reminder') {
      result = await RemoteCheckinModule.remoteReminder()
    } else {
      result = await RemoteCheckinModule.sendReminders()
    }
    console.log('[CRON] attendance-reminder action=' + action, result)
    return res.json({ ok: true, action: action, ...result })
  } catch (e) {
    console.error('[CRON] attendance-reminder error:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
