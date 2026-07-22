// ============================================================
// modules/kpis.js — KPI module (port of GAS KPIs.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG, isManagerOf } from '../lib/auth.js'
import { MailService } from '../lib/email.js'

export var KPIModule = {

  // ── DEFINITIONS ──────────────────────────────────────────────

  async listDefinitions(params, user) {
    params = params || {}
    var all = await DB.getAll(CONFIG.SHEETS.KPI_DEFINITIONS)

    if (params.roleId)     all = all.filter(function(k) { return k.roleId === params.roleId })
    if (params.periodType) all = all.filter(function(k) { return k.periodType === params.periodType })
    if (params.category)   all = all.filter(function(k) { return k.category === params.category })
    if (params.isActive !== undefined) {
      var active = String(params.isActive) === 'true'
      all = all.filter(function(k) { return String(k.isActive) === String(active) })
    }

    return Promise.all(all.map(_enrichDefinition))
  },

  async createDefinition(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    await _validateDefinition(data)
    data.isActive = data.isActive !== false
    return DB.insert(CONFIG.SHEETS.KPI_DEFINITIONS, data)
  },

  async updateDefinition(id, changes, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    return DB.update(CONFIG.SHEETS.KPI_DEFINITIONS, id, changes)
  },

  async deleteDefinition(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var reviews = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, { kpiDefinitionId: id })
    var active = reviews.filter(function(r) { return r.status !== CONFIG.STATUS.COMPLETED })
    if (active.length > 0) throw new Error('No se puede eliminar un KPI con evaluaciones en curso.')
    return DB.update(CONFIG.SHEETS.KPI_DEFINITIONS, id, { isActive: false })
  },

  // ── PERIODS ──────────────────────────────────────────────────

  async listPeriods(params, user) {
    params = params || {}
    var all = await DB.getAll(CONFIG.SHEETS.KPI_PERIODS)

    if (params.status)     all = all.filter(function(p) { return p.status === params.status })
    if (params.periodType) all = all.filter(function(p) { return p.periodType === params.periodType })
    if (params.roleId)     all = all.filter(function(p) { return !p.roleId || p.roleId === params.roleId })

    return all.map(_enrichPeriod)
  },

  async createPeriod(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    _validatePeriod(data)
    data.status = data.status || CONFIG.STATUS.PENDING
    var period = await DB.insert(CONFIG.SHEETS.KPI_PERIODS, data)
    await _generateReviewDrafts(period)
    return period
  },

  async openPeriod(periodId, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, periodId)
    if (!period) throw new Error('Período no encontrado.')
    if (period.status === CONFIG.STATUS.COMPLETED) throw new Error('No se puede reabrir un período cerrado.')

    var updated = await DB.update(CONFIG.SHEETS.KPI_PERIODS, periodId, { status: 'activo' })
    await _notifyPeriodOpen(period)
    return updated
  },

  async extendPeriod(periodId, data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, periodId)
    if (!period) throw new Error('Período no encontrado.')
    if (period.status === CONFIG.STATUS.COMPLETED) throw new Error('No se puede prorrogar un período ya cerrado.')

    var updates = {}
    if (data.endDate) {
      if (new Date(data.endDate) <= new Date(period.endDate)) {
        throw new Error('La nueva fecha de fin debe ser posterior a la actual (' + period.endDate + ').')
      }
      updates.endDate = data.endDate
    }
    if (data.selfAssessmentDeadline) updates.selfAssessmentDeadline = data.selfAssessmentDeadline
    if (data.managerReviewDeadline)  updates.managerReviewDeadline  = data.managerReviewDeadline
    if (!Object.keys(updates).length) throw new Error('Debes cambiar al menos una fecha.')

    return DB.update(CONFIG.SHEETS.KPI_PERIODS, periodId, updates)
  },

  async closePeriod(periodId, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, periodId)
    if (!period) throw new Error('Período no encontrado.')

    var pendingReviews = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, { periodId: periodId })
    await Promise.all(pendingReviews.map(async function(r) {
      if (r.status !== CONFIG.STATUS.COMPLETED) {
        await DB.update(CONFIG.SHEETS.KPI_REVIEWS, r.id, {
          status:     CONFIG.STATUS.COMPLETED,
          finalScore: r.managerScore || r.selfScore || 0
        })
      }
    }))

    return DB.update(CONFIG.SHEETS.KPI_PERIODS, periodId, { status: CONFIG.STATUS.COMPLETED })
  },

  // ── SELF ASSESSMENT ──────────────────────────────────────────

  async selfAssessmentSubmit(data, user) {
    if (data.employeeId && data.employeeId !== user.id && !user.isAdmin && !user.isHR) {
      throw new Error('Solo puedes autocalificarte a ti mismo.')
    }
    var employeeId = data.employeeId || user.id

    _validateReviewData(data)

    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, data.periodId)
    if (!period) throw new Error('Período no encontrado.')
    if (period.status !== 'activo') throw new Error('El período no está abierto para autocalificación.')

    if (period.selfAssessmentDeadline) {
      var deadline = new Date(period.selfAssessmentDeadline)
      deadline.setHours(23, 59, 59)
      if (new Date() > deadline) {
        throw new Error('El plazo para la autocalificación ya venció (' + period.selfAssessmentDeadline + ').')
      }
    }

    var existing = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, {
      periodId:        data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      employeeId:      employeeId
    })

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    var managerId = emp ? emp.managerId : ''

    var reviewData = {
      periodId:        data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      employeeId:      employeeId,
      managerId:       managerId,
      selfScore:       data.selfScore,
      selfComments:    data.selfComments || '',
      selfSubmittedAt: new Date().toISOString(),
      status:          CONFIG.STATUS.IN_REVIEW
    }

    var review
    if (existing.length > 0) {
      review = await DB.update(CONFIG.SHEETS.KPI_REVIEWS, existing[0].id, reviewData)
    } else {
      review = await DB.insert(CONFIG.SHEETS.KPI_REVIEWS, reviewData)
    }

    if (managerId) await _notifyManagerForReview(managerId, employeeId, data.periodId)

    return review
  },

  async saveSelfDraft(data, user) {
    var employeeId = data.employeeId || user.id
    if (employeeId !== user.id && !user.isAdmin) throw new Error('Acceso denegado.')

    var existing = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, {
      periodId:        data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      employeeId:      employeeId
    })

    var draftData = {
      periodId:        data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      employeeId:      employeeId,
      selfScore:       data.selfScore,
      selfComments:    data.selfComments || '',
      status:          CONFIG.STATUS.DRAFT
    }

    if (existing.length > 0) {
      return DB.update(CONFIG.SHEETS.KPI_REVIEWS, existing[0].id, draftData)
    }
    return DB.insert(CONFIG.SHEETS.KPI_REVIEWS, draftData)
  },

  // ── MANAGER REVIEW ───────────────────────────────────────────

  async managerReview(data, user) {
    var review = await DB.getById(CONFIG.SHEETS.KPI_REVIEWS, data.reviewId)
    if (!review) throw new Error('Evaluación no encontrada.')

    var managerOk = await isManagerOf(user, review.employeeId)
    if (!user.isAdmin && !user.isHR && !managerOk) {
      throw new Error('Solo el manager puede revisar esta evaluación.')
    }

    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, review.periodId)
    if (period && period.managerReviewDeadline) {
      var deadline = new Date(period.managerReviewDeadline)
      deadline.setHours(23, 59, 59)
      if (new Date() > deadline) throw new Error('El plazo para la revisión del manager ya venció.')
    }

    var updates = {
      managerId:          user.id,
      managerScore:       data.managerScore,
      managerComments:    data.managerComments || '',
      managerReviewedAt:  new Date().toISOString(),
      finalScore:         data.finalScore !== undefined ? data.finalScore : data.managerScore,
      status:             data.approved ? CONFIG.STATUS.COMPLETED : CONFIG.STATUS.IN_REVIEW
    }

    var updated = await DB.update(CONFIG.SHEETS.KPI_REVIEWS, data.reviewId, updates)

    if (data.approved) {
      await _notifyEmployeeReviewComplete(review.employeeId, review.periodId)
    }

    return updated
  },

  // ── LIST REVIEWS ─────────────────────────────────────────────

  async listReviews(params, user) {
    params = params || {}
    var all = await DB.getAll(CONFIG.SHEETS.KPI_REVIEWS)

    if (!user.isAdmin && !user.isHR) {
      var checks = await Promise.all(all.map(async function(r) {
        if (r.employeeId === user.id) return true
        return isManagerOf(user, r.employeeId)
      }))
      all = all.filter(function(_, i) { return checks[i] })
    }

    if (params.periodId)   all = all.filter(function(r) { return r.periodId === params.periodId })
    if (params.employeeId) all = all.filter(function(r) { return r.employeeId === params.employeeId })
    if (params.managerId)  all = all.filter(function(r) { return r.managerId === params.managerId })
    if (params.status)     all = all.filter(function(r) { return r.status === params.status })
    if (params.kpiId)      all = all.filter(function(r) { return r.kpiDefinitionId === params.kpiId })

    return Promise.all(all.map(_enrichReview))
  },

  async myPendingSelfAssessments(user) {
    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, user.id)
    if (!emp) return []

    var periods = await DB.query(CONFIG.SHEETS.KPI_PERIODS, { status: 'activo' })
    var applicable = periods.filter(function(p) {
      return !p.roleId || p.roleId === emp.roleId
    })

    var kpis = await DB.query(CONFIG.SHEETS.KPI_DEFINITIONS, { roleId: emp.roleId, isActive: true })

    var pending = []
    for (var i = 0; i < applicable.length; i++) {
      var period = applicable[i]
      for (var j = 0; j < kpis.length; j++) {
        var kpi = kpis[j]
        if (kpi.periodType !== period.periodType) continue
        var existing = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, {
          periodId:        period.id,
          kpiDefinitionId: kpi.id,
          employeeId:      user.id
        })
        var submitted = existing.some(function(r) {
          return r.status !== CONFIG.STATUS.DRAFT && r.selfSubmittedAt
        })
        if (!submitted) {
          pending.push({
            period: _enrichPeriod(period),
            kpi:    await _enrichDefinition(kpi),
            draft:  existing.length > 0 ? existing[0] : null
          })
        }
      }
    }
    return pending
  },

  async myPendingManagerReviews(user) {
    if (!user.isManager && !user.isAdmin && !user.isHR) return []

    var pending = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, { status: CONFIG.STATUS.IN_REVIEW })

    if (!user.isAdmin && !user.isHR) {
      var checks = await Promise.all(pending.map(function(r) {
        return isManagerOf(user, r.employeeId)
      }))
      pending = pending.filter(function(_, i) { return checks[i] })
    }

    return Promise.all(pending.map(_enrichReview))
  },

  // ── DASHBOARDS ───────────────────────────────────────────────

  async getDashboard(employeeId, user) {
    var managerOk = await isManagerOf(user, employeeId)
    if (employeeId !== user.id && !user.isAdmin && !user.isHR && !managerOk) {
      throw new Error('Acceso denegado a este dashboard.')
    }

    var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    if (!emp) throw new Error('Empleado no encontrado.')

    var kpis    = await DB.query(CONFIG.SHEETS.KPI_DEFINITIONS, { roleId: emp.roleId })
    var periods = await DB.getAll(CONFIG.SHEETS.KPI_PERIODS)
    var reviews = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, { employeeId: employeeId })

    var byPeriod = {}
    reviews.forEach(function(r) {
      if (!byPeriod[r.periodId]) byPeriod[r.periodId] = []
      byPeriod[r.periodId].push(r)
    })

    var periodResults = []
    for (var i = 0; i < periods.length; i++) {
      var period = periods[i]
      if (!byPeriod[period.id] || !byPeriod[period.id].length) continue
      var periodReviews = byPeriod[period.id]
      var completed = periodReviews.filter(function(r) { return r.status === CONFIG.STATUS.COMPLETED })
      var totalWeight = 0, weightedSum = 0

      completed.forEach(function(r) {
        var kpi = kpis.find(function(k) { return k.id === r.kpiDefinitionId })
        var weight = kpi ? (parseFloat(kpi.weight) || 0) : 0
        totalWeight += weight
        weightedSum += (parseFloat(r.finalScore) || 0) * weight
      })

      var overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : null

      var enrichedReviews = await Promise.all(periodReviews.map(_enrichReview))
      periodResults.push({
        period:         _enrichPeriod(period),
        reviews:        enrichedReviews,
        completedCount: completed.length,
        totalCount:     periodReviews.length,
        overallScore:   overallScore,
        scoreLabel:     _scoreLabel(overallScore),
        completionPct:  periodReviews.length > 0
          ? Math.round((completed.length / periodReviews.length) * 100)
          : 0
      })
    }

    var completedPeriods = periodResults.filter(function(pr) {
      return pr.period.status === CONFIG.STATUS.COMPLETED && pr.overallScore !== null
    }).slice(-6)

    var avgScore = completedPeriods.length > 0
      ? Math.round(completedPeriods.reduce(function(s, pr) { return s + pr.overallScore }, 0) / completedPeriods.length * 10) / 10
      : null

    var activePeriods = periods.filter(function(p) { return p.status === 'activo' })

    var pendingItems = await this.myPendingSelfAssessments(user)

    var enrichedKpis = await Promise.all(kpis.map(_enrichDefinition))

    return {
      employee:      { id: emp.id, fullName: (emp.firstName || '') + ' ' + (emp.lastName || ''), jobTitle: emp.jobTitle },
      kpisForRole:   enrichedKpis,
      periodResults: periodResults,
      activePeriods: activePeriods.map(_enrichPeriod),
      avgScore:      avgScore,
      avgScoreLabel: _scoreLabel(avgScore),
      pendingSelf:   pendingItems.length,
      pendingItems:  pendingItems,
      trend:         _calcTrend(completedPeriods)
    }
  },

  async getReport(params, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    params = params || {}

    var reviews   = await DB.getAll(CONFIG.SHEETS.KPI_REVIEWS)
    var periods   = await DB.getAll(CONFIG.SHEETS.KPI_PERIODS)
    var kpis      = await DB.getAll(CONFIG.SHEETS.KPI_DEFINITIONS)
    var employees = await DB.getAll(CONFIG.SHEETS.EMPLOYEES)

    if (params.periodId) reviews = reviews.filter(function(r) { return r.periodId === params.periodId })
    if (params.status)   reviews = reviews.filter(function(r) { return r.status === params.status })
    if (params.roleId) {
      var empIds = employees.filter(function(e) { return e.roleId === params.roleId }).map(function(e) { return e.id })
      reviews = reviews.filter(function(r) { return empIds.indexOf(r.employeeId) > -1 })
    }

    var enriched = reviews.map(function(r) {
      var kpi    = kpis.find(function(k) { return k.id === r.kpiDefinitionId }) || {}
      var emp    = employees.find(function(e) { return e.id === r.employeeId })  || {}
      var period = periods.find(function(p) { return p.id === r.periodId })      || {}
      return {
        id:             r.id,
        periodId:       r.periodId,
        periodName:     period.name || '',
        periodType:     period.periodType || '',
        kpiId:          r.kpiDefinitionId,
        kpiName:        kpi.name || '',
        kpiWeight:      kpi.weight || 0,
        kpiCategory:    kpi.category || '',
        employeeId:     r.employeeId,
        employeeName:   (emp.firstName || '') + ' ' + (emp.lastName || ''),
        department:     emp.department || '',
        jobTitle:       emp.jobTitle || '',
        selfScore:      r.selfScore,
        managerScore:   r.managerScore,
        finalScore:     r.finalScore,
        status:         r.status,
        scoreLabel:     _scoreLabel(r.finalScore || r.managerScore || r.selfScore),
        selfSubmittedAt: r.selfSubmittedAt || '',
        reviewedAt:     r.managerReviewedAt || ''
      }
    })

    var byPeriod = {}
    enriched.forEach(function(r) {
      if (!byPeriod[r.periodId]) byPeriod[r.periodId] = { name: r.periodName, type: r.periodType, reviews: [], completed: 0, total: 0 }
      byPeriod[r.periodId].total++
      if (r.status === CONFIG.STATUS.COMPLETED) byPeriod[r.periodId].completed++
      byPeriod[r.periodId].reviews.push(r)
    })

    var periodSummaries = Object.keys(byPeriod).map(function(pid) {
      var pg = byPeriod[pid]
      var scores = pg.reviews
        .filter(function(r) { return r.finalScore !== '' && r.finalScore !== null && r.finalScore !== undefined })
        .map(function(r) { return parseFloat(r.finalScore) || 0 })
      var avg = scores.length
        ? Math.round(scores.reduce(function(a, b) { return a + b }, 0) / scores.length * 10) / 10
        : null
      return {
        periodId:      pid,
        periodName:    pg.name,
        periodType:    pg.type,
        total:         pg.total,
        completed:     pg.completed,
        completionPct: Math.round(pg.completed / pg.total * 100),
        avgScore:      avg,
        scoreLabel:    _scoreLabel(avg)
      }
    })

    return {
      reviews:          enriched,
      periodSummaries:  periodSummaries,
      periods:          periods.map(_enrichPeriod),
      total:            enriched.length
    }
  },

  async getTeamDashboard(teamId, user) {
    var team = await DB.getById(CONFIG.SHEETS.TEAMS, teamId)
    if (!team) throw new Error('Equipo no encontrado.')

    if (!user.isAdmin && !user.isHR && team.leaderId !== user.id && team.coLeaderId !== user.id) {
      throw new Error('Solo el líder o co-líder puede ver el dashboard del equipo.')
    }

    var members = await DB.query(CONFIG.SHEETS.EMPLOYEES, { teamId: teamId, status: 'activo' })
    var activePeriods = await DB.query(CONFIG.SHEETS.KPI_PERIODS, { status: 'activo' })

    var memberStats = await Promise.all(members.map(async function(emp) {
      var reviews   = await DB.query(CONFIG.SHEETS.KPI_REVIEWS, { employeeId: emp.id })
      var completed = reviews.filter(function(r) { return r.status === CONFIG.STATUS.COMPLETED })
      var pending   = reviews.filter(function(r) { return r.status === CONFIG.STATUS.IN_REVIEW })

      var lastScore = null
      if (completed.length > 0) {
        var scores = completed.map(function(r) { return parseFloat(r.finalScore) || 0 })
        lastScore = Math.round(scores.reduce(function(a, b) { return a + b }, 0) / scores.length * 10) / 10
      }

      return {
        id:               emp.id,
        fullName:         (emp.firstName || '') + ' ' + (emp.lastName || ''),
        jobTitle:         emp.jobTitle,
        photoUrl:         emp.photoUrl,
        lastScore:        lastScore,
        scoreLabel:       _scoreLabel(lastScore),
        pendingReviews:   pending.length,
        completedReviews: completed.length,
        needsAttention:   pending.length > 0
      }
    }))

    var teamAvg = memberStats.filter(function(m) { return m.lastScore !== null })
    var teamScore = teamAvg.length > 0
      ? Math.round(teamAvg.reduce(function(s, m) { return s + m.lastScore }, 0) / teamAvg.length * 10) / 10
      : null

    return {
      team:           { id: team.id, name: team.name, department: team.department },
      memberStats:    memberStats,
      teamScore:      teamScore,
      teamScoreLabel: _scoreLabel(teamScore),
      activePeriods:  activePeriods.map(_enrichPeriod),
      pendingTotal:   memberStats.reduce(function(s, m) { return s + m.pendingReviews }, 0),
      memberCount:    members.length
    }
  }
}

// ── Private helpers ───────────────────────────────────────────

async function _validateDefinition(data) {
  if (!data.name)       throw new Error('El nombre del KPI es requerido.')
  if (!data.roleId)     throw new Error('El rol es requerido.')
  if (!data.type)       throw new Error('El tipo de KPI es requerido.')
  if (!data.periodType) throw new Error('El tipo de período es requerido.')
  if (data.weight === undefined || data.weight === '') throw new Error('El peso es requerido.')

  var validTypes   = Object.values(CONFIG.KPI_TYPES)
  var validPeriods = Object.values(CONFIG.KPI_PERIODS)
  if (validTypes.indexOf(data.type) === -1)      throw new Error('Tipo inválido: ' + data.type)
  if (validPeriods.indexOf(data.periodType) === -1) throw new Error('Período inválido: ' + data.periodType)

  var existing = await DB.query(CONFIG.SHEETS.KPI_DEFINITIONS, { roleId: data.roleId, isActive: true })
  var totalWeight = existing
    .filter(function(k) { return k.id !== data.id })
    .reduce(function(sum, k) { return sum + (parseFloat(k.weight) || 0) }, 0)
  if (totalWeight + parseFloat(data.weight) > 100) {
    throw new Error('La suma de pesos para este rol supera el 100%. Peso disponible: ' + (100 - totalWeight) + '%')
  }
}

function _validatePeriod(data) {
  if (!data.name)       throw new Error('El nombre del período es requerido.')
  if (!data.periodType) throw new Error('El tipo de período es requerido.')
  if (!data.startDate)  throw new Error('La fecha de inicio es requerida.')
  if (!data.endDate)    throw new Error('La fecha de fin es requerida.')
  if (new Date(data.startDate) >= new Date(data.endDate)) {
    throw new Error('La fecha de fin debe ser posterior a la de inicio.')
  }
}

function _validateReviewData(data) {
  if (!data.periodId)        throw new Error('El período es requerido.')
  if (!data.kpiDefinitionId) throw new Error('El KPI es requerido.')
  if (data.selfScore === undefined || data.selfScore === '') {
    throw new Error('La calificación es requerida.')
  }
}

async function _enrichDefinition(kpi) {
  var role = kpi.roleId ? await DB.getById(CONFIG.SHEETS.ROLES, kpi.roleId) : null
  kpi.roleName = role ? role.name : ''
  return kpi
}

function _enrichPeriod(period) {
  var today     = new Date()
  var startDate = new Date(period.startDate)
  var endDate   = new Date(period.endDate)

  period.daysRemaining = period.status === 'activo'
    ? Math.max(0, Math.ceil((endDate - today) / 86400000))
    : 0
  period.progress = period.status !== CONFIG.STATUS.PENDING
    ? Math.min(100, Math.max(0, Math.round(((today - startDate) / (endDate - startDate)) * 100)))
    : 0
  return period
}

async function _enrichReview(review) {
  var kpi = await DB.getById(CONFIG.SHEETS.KPI_DEFINITIONS, review.kpiDefinitionId)
  var emp = await DB.getById(CONFIG.SHEETS.EMPLOYEES, review.employeeId)
  var mgr = review.managerId ? await DB.getById(CONFIG.SHEETS.EMPLOYEES, review.managerId) : null

  review.kpiName      = kpi ? kpi.name   : ''
  review.kpiWeight    = kpi ? kpi.weight : 0
  review.kpiType      = kpi ? kpi.type   : ''
  review.kpiTarget    = kpi ? kpi.target : ''
  review.employeeName = emp ? (emp.firstName || '') + ' ' + (emp.lastName || '') : ''
  review.managerName  = mgr ? (mgr.firstName || '') + ' ' + (mgr.lastName || '') : ''
  review.scoreLabel   = _scoreLabel(review.finalScore || review.managerScore || review.selfScore)

  if (review.selfScore !== '' && review.managerScore !== '') {
    review.scoreDiff = parseFloat(review.managerScore || 0) - parseFloat(review.selfScore || 0)
  }
  return review
}

function _scoreLabel(score) {
  if (score === null || score === undefined || score === '') return 'Sin calificar'
  var s = parseFloat(score)
  if (isNaN(s)) return 'Sin calificar'
  if (s >= 90) return 'Excepcional'
  if (s >= 70) return 'Cumple'
  if (s >= 50) return 'En desarrollo'
  return 'Requiere mejora'
}

function _calcTrend(periodResults) {
  if (periodResults.length < 2) return 'neutral'
  var last = periodResults[periodResults.length - 1].overallScore
  var prev = periodResults[periodResults.length - 2].overallScore
  if (last > prev) return 'up'
  if (last < prev) return 'down'
  return 'neutral'
}

async function _generateReviewDrafts(period) {
  var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
  if (period.roleId) {
    employees = employees.filter(function(e) { return e.roleId === period.roleId })
  }

  var allKpis = await DB.getAll(CONFIG.SHEETS.KPI_DEFINITIONS)
  var kpis = allKpis.filter(function(k) {
    return String(k.isActive) === 'true' && k.periodType === period.periodType
  })

  for (var i = 0; i < employees.length; i++) {
    var emp = employees[i]
    var empKpis = kpis.filter(function(k) { return !k.roleId || k.roleId === emp.roleId })
    for (var j = 0; j < empKpis.length; j++) {
      var kpi = empKpis[j]
      await DB.insert(CONFIG.SHEETS.KPI_REVIEWS, {
        periodId:        period.id,
        kpiDefinitionId: kpi.id,
        employeeId:      emp.id,
        managerId:       emp.managerId || '',
        selfScore:       '',
        selfComments:    '',
        managerScore:    '',
        managerComments: '',
        finalScore:      '',
        status:          CONFIG.STATUS.DRAFT
      })
    }
  }
}

async function _notifyManagerForReview(managerId, employeeId, periodId) {
  try {
    var mgr    = await DB.getById(CONFIG.SHEETS.EMPLOYEES, managerId)
    var emp    = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, periodId)
    if (!mgr || !emp || !period) return

    await MailService.send({
      to:       mgr.email,
      subject:  '[HR Platform] Autocalificación lista para revisar - ' + emp.firstName + ' ' + emp.lastName,
      htmlBody: '<p>Hola ' + mgr.firstName + ',</p>' +
                '<p><strong>' + emp.firstName + ' ' + emp.lastName + '</strong> ha completado su autocalificación para el período <strong>' + period.name + '</strong>.</p>' +
                '<p>Por favor revisa y aprueba la evaluación en la plataforma HR.</p>'
    })
  } catch (e) {
    console.error('Error enviando notificación:', e.message)
  }
}

async function _notifyEmployeeReviewComplete(employeeId, periodId) {
  try {
    var emp    = await DB.getById(CONFIG.SHEETS.EMPLOYEES, employeeId)
    var period = await DB.getById(CONFIG.SHEETS.KPI_PERIODS, periodId)
    if (!emp || !period) return

    await MailService.send({
      to:       emp.email,
      subject:  '[HR Platform] Tu evaluación de KPIs fue aprobada - ' + period.name,
      htmlBody: '<p>Hola ' + emp.firstName + ',</p>' +
                '<p>Tu evaluación de KPIs para el período <strong>' + period.name + '</strong> ha sido revisada y aprobada por tu manager.</p>' +
                '<p>Puedes ver tus resultados en tu dashboard de HR Platform.</p>'
    })
  } catch (e) {
    console.error('Error enviando notificación:', e.message)
  }
}

async function _notifyPeriodOpen(period) {
  try {
    var employees = await DB.query(CONFIG.SHEETS.EMPLOYEES, { status: 'activo' })
    if (period.roleId) {
      employees = employees.filter(function(e) { return e.roleId === period.roleId })
    }
    for (var i = 0; i < employees.length; i++) {
      var emp = employees[i]
      await MailService.send({
        to:       emp.email,
        subject:  '[HR Platform] Nuevo período de evaluación: ' + period.name,
        htmlBody: '<p>Hola ' + emp.firstName + ',</p>' +
                  '<p>Se ha abierto el período de evaluación <strong>' + period.name + '</strong>.</p>' +
                  '<p>Fecha límite autocalificación: <strong>' + (period.selfAssessmentDeadline || period.endDate) + '</strong></p>' +
                  '<p>Ingresa a HR Platform para completar tu autocalificación.</p>'
      })
    }
  } catch (e) {
    console.error('Error enviando notificaciones masivas:', e.message)
  }
}
