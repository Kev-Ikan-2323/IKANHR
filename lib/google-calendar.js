import { google } from 'googleapis'

var DEMOS_CALENDAR_ID = 'c_80c053d8a782f0f6e51706e7dabb0c66b02032e90b7a6e0fe846e3878b92fa2f@group.calendar.google.com'

function getAuth() {
  var raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    var creds = JSON.parse(raw)
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    })
  } catch (e) {
    return null
  }
}

function evToCdmxDate(ev) {
  if (!ev || !ev.start) return null
  if (ev.start.date) return ev.start.date
  var utcMs = new Date(ev.start.dateTime).getTime()
  return new Date(utcMs - 6 * 3600 * 1000).toISOString().split('T')[0]
}

// Returns Set<string> of lowercase attendee emails for DEMOS COMERCIAL events on the given date
export async function getDemoAttendeesForDate(date) {
  var auth = getAuth()
  if (!auth) return new Set()
  try {
    var calendar = google.calendar({ version: 'v3', auth })
    var res = await calendar.events.list({
      calendarId:   DEMOS_CALENDAR_ID,
      timeMin:      date + 'T00:00:00-06:00',
      timeMax:      date + 'T23:59:59-06:00',
      singleEvents: true,
      maxResults:   100
    })
    var emails = new Set()
    ;(res.data.items || []).forEach(function(ev) {
      ;(ev.attendees || []).forEach(function(a) {
        if (a.email) emails.add(a.email.toLowerCase())
      })
    })
    return emails
  } catch (e) {
    return new Set()
  }
}

// Returns { 'YYYY-MM-DD': Set<string> } for all DEMOS COMERCIAL events in a given month
export async function getDemoAttendeesForMonth(year, month) {
  var auth = getAuth()
  if (!auth) return {}
  try {
    var mon     = String(month).padStart(2, '0')
    var lastDay = new Date(year, month, 0).getDate()
    var calendar = google.calendar({ version: 'v3', auth })
    var res = await calendar.events.list({
      calendarId:   DEMOS_CALENDAR_ID,
      timeMin:      year + '-' + mon + '-01T00:00:00-06:00',
      timeMax:      year + '-' + mon + '-' + String(lastDay).padStart(2, '0') + 'T23:59:59-06:00',
      singleEvents: true,
      maxResults:   500
    })
    var byDate = {}
    ;(res.data.items || []).forEach(function(ev) {
      var evDate = evToCdmxDate(ev)
      if (!evDate) return
      if (!byDate[evDate]) byDate[evDate] = new Set()
      ;(ev.attendees || []).forEach(function(a) {
        if (a.email) byDate[evDate].add(a.email.toLowerCase())
      })
    })
    return byDate
  } catch (e) {
    return {}
  }
}
