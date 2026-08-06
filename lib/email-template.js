// ============================================================
// email-template.js — Shared HTML email builder
// ============================================================

// buildEmail(opts) → full HTML string
// opts: { icon, title, bodyHTML, details: [{label, value, highlight}], actions: [{label, url, primary}], footerNote }
export function buildEmail(opts) {
  var icon       = opts.icon       || ''
  var title      = opts.title      || ''
  var bodyHTML   = opts.bodyHTML   || ''
  var details    = opts.details    || []
  var actions    = opts.actions    || []
  var footerNote = opts.footerNote || ''

  var detailRows = details.map(function(d, i) {
    var isLast = i === details.length - 1
    var borderStyle = isLast ? '' : 'border-bottom:1px solid #DBEAFE;'
    return (
      '<tr>' +
      '<td style="padding:8px 0;' + borderStyle + 'color:#64748B;font-size:13px;font-family:Arial,sans-serif">' + d.label + '</td>' +
      '<td style="padding:8px 0;' + borderStyle + 'color:' + (d.highlight || '#1E293B') + ';font-size:13px;font-weight:700;text-align:right;font-family:Arial,sans-serif">' + d.value + '</td>' +
      '</tr>'
    )
  }).join('')

  var detailsBlock = details.length > 0 ? (
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">' +
    '<tr><td style="background:#EFF6FF;border-left:4px solid #3B82F6;border-radius:0 6px 6px 0;padding:4px 16px">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' + detailRows + '</table>' +
    '</td></tr></table>'
  ) : ''

  var actionsBlock = actions.length > 0 ? (
    '<table cellpadding="0" cellspacing="0" style="margin:20px 0 4px"><tr>' +
    actions.map(function(a) {
      var isPrimary = a.primary !== false
      var bg     = isPrimary ? '#1D4ED8' : 'transparent'
      var border  = isPrimary ? 'none' : '2px solid #CBD5E1'
      var color   = isPrimary ? '#FFFFFF' : '#475569'
      return (
        '<td style="padding-right:10px">' +
        '<a href="' + a.url + '" style="display:inline-block;background:' + bg + ';border:' + border +
        ';color:' + color + ';padding:13px 24px;border-radius:8px;text-decoration:none;' +
        'font-size:14px;font-weight:700;font-family:Arial,sans-serif">' + a.label + '</a>' +
        '</td>'
      )
    }).join('') +
    '</tr></table>'
  ) : ''

  var platformUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  var platformBtn = platformUrl ? (
    '<table cellpadding="0" cellspacing="0" style="margin:16px auto 0"><tr><td>' +
    '<a href="' + platformUrl + '" style="display:inline-block;background:#EFF6FF;color:#1D4ED8;' +
    'padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;' +
    'font-family:Arial,sans-serif;border:1px solid #BFDBFE">Abrir IKAN HR →</a>' +
    '</td></tr></table>'
  ) : ''

  return (
    '<!DOCTYPE html>' +
    '<html lang="es"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
    '</head>' +
    '<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">' +

    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9">' +
    '<tr><td align="center" style="padding:40px 16px">' +

    '<table cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">' +

    // ── Header ────────────────────────────────────────────────
    '<tr><td style="background:#1E3A8A;border-radius:12px 12px 0 0;padding:22px 28px">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td>' +
    '<span style="color:#FFFFFF;font-weight:800;font-size:20px;letter-spacing:-.5px;font-family:Arial,sans-serif">IKAN</span>' +
    '<span style="color:#93C5FD;font-weight:800;font-size:20px;font-family:Arial,sans-serif">HR</span>' +
    '<div style="color:#60A5FA;font-size:10px;letter-spacing:1.5px;margin-top:3px;font-family:Arial,sans-serif">PLATAFORMA DE RECURSOS HUMANOS</div>' +
    '</td>' +
    '</tr></table>' +
    '</td></tr>' +

    // ── Icon strip (if icon provided) ─────────────────────────
    (icon ?
      '<tr><td style="background:linear-gradient(135deg,#1D4ED8 0%,#2563EB 100%);padding:20px 28px">' +
      '<span style="font-size:44px;line-height:1;display:block">' + icon + '</span>' +
      '</td></tr>'
    : '') +

    // ── Body ──────────────────────────────────────────────────
    '<tr><td style="background:#FFFFFF;padding:32px 28px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0">' +
    '<h2 style="margin:0 0 20px;color:#1E293B;font-size:20px;font-weight:700;line-height:1.3;font-family:Arial,sans-serif">' + title + '</h2>' +
    bodyHTML +
    detailsBlock +
    actionsBlock +
    '</td></tr>' +

    // ── Footer ────────────────────────────────────────────────
    '<tr><td style="background:#F8FAFC;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:18px 28px;text-align:center">' +
    platformBtn +
    '<p style="margin:' + (platformBtn ? '12px' : '0') + ' 0 0;color:#94A3B8;font-size:11px;line-height:1.7;font-family:Arial,sans-serif">' +
    (footerNote ? footerNote + '<br>' : '') +
    'IKAN HR Platform &nbsp;·&nbsp; Correo automático, no responder' +
    '</p>' +
    '</td></tr>' +

    '</table>' + // inner table
    '</td></tr></table>' + // outer table
    '</body></html>'
  )
}

// Shared paragraph style for body text
export var P = 'style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6;font-family:Arial,sans-serif"'
export var STRONG = 'style="color:#1E293B"'
