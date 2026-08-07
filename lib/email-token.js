// ============================================================
// email-token.js — HMAC tokens for one-click email actions
// ============================================================

import crypto from 'crypto'

function _secret() {
  return process.env.EMAIL_ACTION_SECRET || process.env.RESEND_API_KEY || 'ikan-hr-default'
}

export function generateActionToken(requestId, action) {
  var data = requestId + ':' + action
  return crypto.createHmac('sha256', _secret()).update(data).digest('base64url').slice(0, 40)
}

export function verifyActionToken(requestId, action, token) {
  var expected = generateActionToken(requestId, action)
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== token.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

export function appUrl() {
  var url = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || ''
  if (url && !url.startsWith('http')) url = 'https://' + url
  return url.replace(/\/$/, '')
}

// approverId is included in the token so the endpoint knows who is approving
export function approveUrl(requestId, approverId) {
  var token = generateActionToken(requestId + ':' + approverId, 'approve')
  return appUrl() + '/api/vacation-action?id=' + requestId + '&approver=' + approverId + '&action=approve&token=' + token
}
