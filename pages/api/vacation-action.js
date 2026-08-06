// ============================================================
// pages/api/vacation-action.js — One-click approve from email
// Public endpoint: secured with HMAC token from email-token.js
// ============================================================

import { DB } from '../../lib/db.js'
import { CONFIG } from '../../lib/auth.js'
import { VacationsModule } from '../../modules/vacations.js'
import { verifyActionToken, appUrl } from '../../lib/email-token.js'

export default async function handler(req, res) {
  var id       = req.query.id        // vacation request ID
  var approver = req.query.approver  // approver employee ID
  var action   = req.query.action    // 'approve'
  var token    = req.query.token

  if (!id || !approver || !action || !token) {
    return _page(res, '❌', 'Enlace inválido', 'Faltan parámetros en el enlace de aprobación.')
  }
  if (action !== 'approve') {
    return _page(res, '❌', 'Acción inválida', 'Este enlace no corresponde a una acción válida.')
  }
  if (!verifyActionToken(id + ':' + approver, action, token)) {
    return _page(res, '❌', 'Enlace inválido', 'El token de seguridad no es válido o ha expirado.')
  }

  try {
    var request = await DB.getById(CONFIG.SHEETS.VACATION_REQUESTS, id)
    if (!request) return _page(res, '❌', 'No encontrada', 'La solicitud de vacaciones no existe.')

    if (request.status !== CONFIG.STATUS.PENDING && request.status !== CONFIG.STATUS.PENDING_MANAGER) {
      var labels = { Aprobado: 'aprobada', Rechazado: 'rechazada', Cancelado: 'cancelada' }
      var label  = labels[request.status] || ('en estado ' + request.status)
      return _page(res, 'ℹ️', 'Ya procesada', 'Esta solicitud ya fue <strong>' + label + '</strong> anteriormente.')
    }

    // Build approver user context from DB
    var approverEmp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, approver)
    if (!approverEmp) return _page(res, '❌', 'Error', 'No se encontró el perfil del aprobador.')

    var role  = approverEmp.roleId ? await DB.getById(CONFIG.SHEETS.ROLES, approverEmp.roleId) : null
    var perms = []
    if (role && role.permissions) {
      try { perms = typeof role.permissions === 'string' ? JSON.parse(role.permissions) : (role.permissions || []) } catch (e) {}
    }

    var approverUser = {
      id:                  approverEmp.id,
      email:               approverEmp.email,
      firstName:           approverEmp.firstName,
      lastName:            approverEmp.lastName,
      fullName:            (approverEmp.firstName || '') + ' ' + (approverEmp.lastName || ''),
      roleId:              approverEmp.roleId,
      managerId:           approverEmp.managerId,
      teamId:              approverEmp.teamId,
      permissions:         perms,
      isAdmin:             perms.includes('admin'),
      isHR:                perms.includes('hr'),
      isManager:           perms.includes('manager'),
      canApproveVacations: true,
      ledTeams:            [],
      coledTeams:          []
    }

    await VacationsModule.approve(id, null, approverUser)

    var empRec  = await DB.getById(CONFIG.SHEETS.EMPLOYEES, request.employeeId)
    var empName = empRec ? (empRec.firstName || '') + ' ' + (empRec.lastName || '') : 'el empleado'
    return _page(
      res, '✅', '¡Solicitud aprobada!',
      'Las vacaciones de <strong>' + empName + '</strong> del <strong>' +
      request.startDate + '</strong> al <strong>' + request.endDate +
      '</strong> han sido aprobadas correctamente.'
    )
  } catch (e) {
    console.error('[vacation-action] error:', e)
    return _page(res, '❌', 'Error al procesar', e.message || 'Ocurrió un error inesperado. Por favor usa la plataforma.')
  }
}

function _page(res, icon, title, message) {
  var url = appUrl() || '/'
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.send(
    '<!DOCTYPE html><html lang="es"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' — IKAN HR</title>' +
    '<style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#F1F5F9;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh}' +
    '.card{background:#fff;border-radius:16px;padding:44px 40px;max-width:460px;' +
    'width:90%;text-align:center;box-shadow:0 4px 32px rgba(30,58,138,.10)}' +
    '.brand{color:#1E3A8A;font-weight:800;font-size:16px;letter-spacing:-.3px;margin-bottom:28px}' +
    '.brand span{color:#3B82F6}' +
    '.icon{font-size:60px;margin-bottom:16px;line-height:1}' +
    '.title{font-size:22px;font-weight:700;color:#1E293B;margin:0 0 10px}' +
    '.msg{color:#64748B;font-size:15px;line-height:1.65;margin:0 0 28px}' +
    '.btn{display:inline-block;background:#1E3A8A;color:#fff;padding:13px 28px;' +
    'border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.2px}' +
    '.divider{height:1px;background:#E2E8F0;margin:24px 0}' +
    '</style></head>' +
    '<body><div class="card">' +
    '<div class="brand">IKAN<span>HR</span></div>' +
    '<div class="icon">' + icon + '</div>' +
    '<div class="title">' + title + '</div>' +
    '<div class="msg">' + message + '</div>' +
    '<div class="divider"></div>' +
    '<a class="btn" href="' + url + '">Ir a IKAN HR →</a>' +
    '</div></body></html>'
  )
}
