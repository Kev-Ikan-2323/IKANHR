// ============================================================
// modules/birthdays.js — Birthday calendar (port of GAS Birthdays.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'
import { MailService } from '../lib/email.js'
import { buildEmail } from '../lib/email-template.js'

export var BirthdaysModule = {

  async getUpcoming(days, user) {
    days = parseInt(days) || 30
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var today = new Date(); today.setHours(0, 0, 0, 0)

    var results = []
    employees.forEach(function(emp) {
      if (!emp.birthDate) return
      var info = _getBirthdayInfo(emp, today)
      if (!info) return
      if (info.daysUntil >= 0 && info.daysUntil <= days) {
        results.push(info)
      }
    })

    results.sort(function(a, b) { return a.daysUntil - b.daysUntil })
    return results
  },

  async getByMonth(month, user) {
    month = parseInt(month) || new Date().getMonth() + 1
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var today = new Date(); today.setHours(0, 0, 0, 0)

    var results = employees
      .filter(function(emp) {
        if (!emp.birthDate) return false
        var bMonth = parseInt((emp.birthDate || '').split('-')[1])
        return bMonth === month
      })
      .map(function(emp) { return _getBirthdayInfo(emp, today) })
      .filter(Boolean)
      .sort(function(a, b) { return a.dayOfMonth - b.dayOfMonth })

    return results
  },

  async getToday(user) {
    var today   = new Date()
    var todayMM = String(today.getMonth() + 1).padStart(2, '0')
    var todayDD = String(today.getDate()).padStart(2, '0')

    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    return employees
      .filter(function(emp) {
        if (!emp.birthDate) return false
        var parts = emp.birthDate.split('-')
        return parts[1] === todayMM && parts[2] === todayDD
      })
      .map(function(emp) { return _getBirthdayInfo(emp, today) })
      .filter(Boolean)
  },

  async getAnnualCalendar(user) {
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var today = new Date(); today.setHours(0, 0, 0, 0)

    var months = {}
    for (var i = 1; i <= 12; i++) months[i] = []

    employees.forEach(function(emp) {
      if (!emp.birthDate) return
      var info = _getBirthdayInfo(emp, today)
      if (!info) return
      months[info.month].push(info)
    })

    Object.keys(months).forEach(function(m) {
      months[m].sort(function(a, b) { return a.dayOfMonth - b.dayOfMonth })
    })

    return {
      calendar:   months,
      monthNames: ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
      totalActive: employees.filter(function(e) { return e.birthDate }).length
    }
  },

  async sendBirthdayGreeting(employeeId, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    if (!emp) throw new Error('Empleado no encontrado.')

    try {
      await MailService.send({
        to:      emp.email,
        subject: '🎂 ¡Feliz cumpleaños, ' + emp.firstName + '!',
        htmlBody: buildEmail({
          icon:  '🎂',
          title: '¡Feliz cumpleaños, ' + emp.firstName + '!',
          bodyHTML:
            '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + emp.firstName + '</strong>,</p>' +
            '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Todo el equipo de IKAN te desea un día increíble lleno de alegría y muchos motivos para celebrar. 🎉</p>' +
            '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">¡Gracias por ser parte de nuestro equipo!</p>'
        })
      })
      return { ok: true, sentTo: emp.email }
    } catch (e) {
      throw new Error('Error enviando felicitación: ' + e.message)
    }
  },

  async dailyBirthdayGreetings() {
    // Run without a user context (called by cron)
    var today   = new Date()
    var todayMM = String(today.getMonth() + 1).padStart(2, '0')
    var todayDD = String(today.getDate()).padStart(2, '0')

    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    var celebrants = employees.filter(function(emp) {
      if (!emp.birthDate) return false
      var parts = emp.birthDate.split('-')
      return parts[1] === todayMM && parts[2] === todayDD
    })

    var others = employees.filter(function(e) {
      return e.email && celebrants.every(function(c) { return c.id !== e.id })
    })

    var sent = []
    for (var i = 0; i < celebrants.length; i++) {
      var emp = celebrants[i]
      var empFullName = (emp.firstName || '') + ' ' + (emp.lastName || '')

      // Greeting to the birthday person
      if (emp.email) {
        try {
          await MailService.send({
            to:      emp.email,
            subject: '🎂 ¡Feliz cumpleaños, ' + emp.firstName + '!',
            htmlBody: buildEmail({
              icon:  '🎂',
              title: '¡Feliz cumpleaños, ' + emp.firstName + '!',
              bodyHTML:
                '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + emp.firstName + '</strong>,</p>' +
                '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Todo el equipo de IKAN te desea un día increíble lleno de alegría y muchos motivos para celebrar. 🎉</p>' +
                '<p style="margin:0;color:#475569;font-size:15px;line-height:1.6">¡Gracias por ser parte de nuestro equipo!</p>'
            })
          })
          sent.push(empFullName)
        } catch (e) {
          console.error('Error greeting ' + emp.firstName + ':', e.message)
        }
      }

      // Notification to all other active employees
      for (var j = 0; j < others.length; j++) {
        var other = others[j]
        try {
          await MailService.send({
            to:      other.email,
            subject: '🎉 Hoy es el cumpleaños de ' + empFullName,
            htmlBody: buildEmail({
              icon:  '🎉',
              title: '¡Cumpleaños en el equipo!',
              bodyHTML:
                '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hola <strong style="color:#1E293B">' + (other.firstName || '') + '</strong>,</p>' +
                '<p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6">Hoy es el cumpleaños de <strong style="color:#1E293B">' + empFullName + '</strong>. ¡Únete a felicitarle!</p>'
            })
          })
        } catch (e) {
          console.error('Error notifying ' + other.firstName + ' about birthday of ' + emp.firstName + ':', e.message)
        }
      }
    }
    console.log('Birthday greetings sent:', sent.join(', '))
    return { count: sent.length, names: sent }
  }
}

function _getBirthdayInfo(emp, today) {
  if (!emp.birthDate) return null
  var parts = emp.birthDate.split('-')
  if (parts.length < 3) return null

  var year      = today.getFullYear()
  var month     = parseInt(parts[1])
  var day       = parseInt(parts[2])
  var birthYear = parseInt(parts[0])

  var thisYearBirthday = new Date(year, month - 1, day)
  thisYearBirthday.setHours(0, 0, 0, 0)

  var nextBirthday = new Date(thisYearBirthday)
  if (nextBirthday < today) nextBirthday.setFullYear(year + 1)

  var daysUntil  = Math.ceil((nextBirthday - today) / 86400000)
  var turningAge = nextBirthday.getFullYear() - birthYear
  var isToday    = daysUntil === 0

  return {
    id:           emp.id,
    fullName:     (emp.firstName || '') + ' ' + (emp.lastName || ''),
    firstName:    emp.firstName,
    email:        emp.email,
    department:   emp.department,
    jobTitle:     emp.jobTitle,
    photoUrl:     emp.photoUrl,
    teamId:       emp.teamId,
    birthDate:    emp.birthDate,
    month:        month,
    dayOfMonth:   day,
    daysUntil:    daysUntil,
    turningAge:   turningAge,
    isToday:      isToday,
    isTomorrow:   daysUntil === 1,
    isThisWeek:   daysUntil <= 7,
    nextBirthday: nextBirthday.toISOString().split('T')[0]
  }
}
