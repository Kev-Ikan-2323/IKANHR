// ============================================================
// db.js — Database layer using Supabase (replaces GAS Database.js)
// Handles camelCase <-> snake_case conversion transparently.
// ============================================================

import { createClient } from '@supabase/supabase-js'

// Table name mapping: GAS sheet names -> Supabase table names
var TABLE_MAP = {
  'Employees':        'employees',
  'Roles':            'roles',
  'Teams':            'teams',
  'OrgChart':         'org_chart',
  'KPIDefinitions':   'kpi_definitions',
  'KPIPeriods':       'kpi_periods',
  'KPIReviews':       'kpi_reviews',
  'VacationBalance':  'vacation_balance',
  'VacationRequests': 'vacation_requests',
  'MexicanHolidays':  'holidays',
  'Announcements':    'announcements',
  'AuditLog':         'audit_log',
  'Config':           'config',
  'KPISchedules':     'kpi_schedules'
}

// camelCase -> snake_case
function toSnake(str) {
  return str.replace(/[A-Z]/g, function(c) { return '_' + c.toLowerCase() })
}

// snake_case -> camelCase
function toCamel(str) {
  return str.replace(/_([a-z])/g, function(_, c) { return c.toUpperCase() })
}

// Convert object keys from camelCase to snake_case
function keysToSnake(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  var out = {}
  Object.keys(obj).forEach(function(k) {
    // Skip internal keys
    if (k === '_rowIndex') return
    out[toSnake(k)] = obj[k]
  })
  return out
}

// Convert object keys from snake_case to camelCase
function keysToCamel(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  var out = {}
  Object.keys(obj).forEach(function(k) {
    out[toCamel(k)] = obj[k]
  })
  return out
}

function resolveTable(name) {
  return TABLE_MAP[name] || name
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Normalize values coming from DB:
// - null -> ''
// - Date objects normalized to YYYY-MM-DD string
// - numbers kept as numbers
function normalize(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    return value.toISOString().split('T')[0]
  }
  return value
}

function normalizeRow(row) {
  var out = keysToCamel(row)
  Object.keys(out).forEach(function(k) {
    out[k] = normalize(out[k])
  })
  return out
}

export var DB = {
  async getAll(tableName) {
    var table = resolveTable(tableName)
    var client = getAdminClient()
    var { data, error } = await client
      .from(table)
      .select('*')
    if (error) throw new Error('DB.getAll [' + table + ']: ' + error.message)
    return (data || []).map(normalizeRow)
  },

  async getById(tableName, id) {
    if (!id) return null
    var table = resolveTable(tableName)
    var client = getAdminClient()
    var { data, error } = await client
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error('DB.getById [' + table + ']: ' + error.message)
    return data ? normalizeRow(data) : null
  },

  async getBy(tableName, field, value) {
    var table = resolveTable(tableName)
    var client = getAdminClient()
    var col = toSnake(field)
    var { data, error } = await client
      .from(table)
      .select('*')
      .ilike(col, String(value))
    if (error) throw new Error('DB.getBy [' + table + ']: ' + error.message)
    return (data || []).map(normalizeRow)
  },

  async query(tableName, filters) {
    var table = resolveTable(tableName)
    var client = getAdminClient()
    var q = client.from(table).select('*')
    if (filters) {
      Object.keys(filters).forEach(function(k) {
        var val = filters[k]
        if (val === null || val === undefined) return
        var col = toSnake(k)
        // Use eq for exact match (case-insensitive for strings done via ilike is too broad)
        // Use ilike for string fields that GAS compared case-insensitively
        if (typeof val === 'string') {
          q = q.ilike(col, val)
        } else {
          q = q.eq(col, val)
        }
      })
    }
    var { data, error } = await q
    if (error) throw new Error('DB.query [' + table + ']: ' + error.message)
    return (data || []).map(normalizeRow)
  },

  async insert(tableName, record) {
    var table = resolveTable(tableName)
    var client = getAdminClient()
    var now = new Date().toISOString()

    var row = keysToSnake(record)
    if (!row.id) row.id = crypto.randomUUID()
    if (!row.created_at) row.created_at = now
    row.updated_at = now

    // Remove empty-string dates/FKs so PostgreSQL doesn't fail on DATE/FK fields
    Object.keys(row).forEach(function(k) {
      if (row[k] === '') {
        var isDateCol = k.endsWith('_at') || k.endsWith('_date') || k === 'date'
        var isNumCol  = k.endsWith('_score') || k.endsWith('_days') || k === 'year' || k === 'weight' || k === 'level'
        var isFkCol   = k.endsWith('_id') && k !== 'id'
        if (isDateCol || isNumCol || isFkCol) row[k] = null
      }
    })

    var { data, error } = await client
      .from(table)
      .insert(row)
      .select()
      .single()
    if (error) throw new Error('DB.insert [' + table + ']: ' + error.message)

    // Audit
    _auditLog(client, 'INSERT', table, data.id, record)

    return normalizeRow(data)
  },

  async update(tableName, id, changes) {
    var table = resolveTable(tableName)
    var client = getAdminClient()
    var now = new Date().toISOString()

    var row = keysToSnake(changes)
    row.updated_at = now

    // Nullify empty date/numeric/FK strings
    Object.keys(row).forEach(function(k) {
      if (row[k] === '') {
        var isDateCol = k.endsWith('_at') || k.endsWith('_date') || k === 'date'
        var isNumCol  = k.endsWith('_score') || k.endsWith('_days') || k === 'year' || k === 'weight' || k === 'level'
        var isFkCol   = k.endsWith('_id') && k !== 'id'
        if (isDateCol || isNumCol || isFkCol) row[k] = null
      }
    })

    var { data, error } = await client
      .from(table)
      .update(row)
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error('DB.update [' + table + ']: ' + error.message)

    _auditLog(client, 'UPDATE', table, id, changes)

    return normalizeRow(data)
  },

  async softDelete(tableName, id) {
    return this.update(tableName, id, { status: 'inactivo' })
  },

  generateId() {
    return crypto.randomUUID()
  }
}

async function _auditLog(client, action, tableName, recordId, data) {
  try {
    await client.from('audit_log').insert({
      action:     action,
      table_name: tableName,
      record_id:  String(recordId || ''),
      data:       data ? JSON.stringify(data).substring(0, 500) : null
    })
  } catch (e) {
    console.error('AuditLog error:', e.message)
  }
}
