// GET /api/cron/birthdays — daily birthday greetings (Vercel Cron)
// Schedule: 0 9 * * * (9:00 UTC = 10:00 CDMX / 10:00 UK BST)

import { BirthdaysModule } from '../../../modules/birthdays.js'

export default async function handler(req, res) {
  // Vercel automatically protects cron endpoints; optionally validate CRON_SECRET
  var authHeader = req.headers['authorization']
  var cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== 'Bearer ' + cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    var result = await BirthdaysModule.dailyBirthdayGreetings()
    console.log('[CRON] Birthday greetings result:', JSON.stringify(result))
    return res.json({ ok: true, ...result })
  } catch (e) {
    console.error('[CRON] Birthday greetings error:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
