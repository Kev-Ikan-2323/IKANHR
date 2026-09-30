// GET /api/cron/payroll-report — Send quincena attendance CSV to accounting
// Schedule: 0 18 * * * (18:00 UTC = 12:00 PM CDMX / UTC-6)
// Runs daily; handler skips automatically on non-send days.

import { PayrollReportModule } from '../../../modules/payroll-report.js'

export default async function handler(req, res) {
  var authHeader = req.headers['authorization']
  var cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    var result = await PayrollReportModule.generateAndSend()
    console.log('[CRON] Payroll report:', JSON.stringify(result))
    return res.json({ ok: true, ...result })
  } catch (e) {
    console.error('[CRON] Payroll report error:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
