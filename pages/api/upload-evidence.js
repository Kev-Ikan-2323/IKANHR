// POST /api/upload-evidence
// Multipart file upload → Supabase Storage bucket "evidencias"
// Returns { url } pointing to the public file URL.

import { createClient } from '@supabase/supabase-js'
import { getCurrentUser } from '../../lib/auth.js'

export const config = { api: { bodyParser: false } }

const BUCKET = 'evidencias'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function ensureBucket(client) {
  var { data: buckets } = await client.storage.listBuckets()
  var exists = (buckets || []).some(function(b) { return b.name === BUCKET })
  if (!exists) {
    await client.storage.createBucket(BUCKET, { public: true })
  }
}

async function readBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = []
    req.on('data', function(c) { chunks.push(c) })
    req.on('end', function() { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

// Parse a multipart/form-data body — minimal implementation for single-file uploads.
// Returns { fields: {key: value}, file: { name, type, data: Buffer } }
function parseMultipart(body, boundary) {
  var delim     = Buffer.from('--' + boundary)
  var delimEnd  = Buffer.from('--' + boundary + '--')
  var result    = { fields: {}, file: null }
  var start     = 0

  while (start < body.length) {
    var delimPos = body.indexOf(delim, start)
    if (delimPos === -1) break
    var partStart = delimPos + delim.length + 2  // skip \r\n
    var nextDelim = body.indexOf(delim, partStart)
    if (nextDelim === -1) break

    var headerEnd = body.indexOf('\r\n\r\n', partStart)
    if (headerEnd === -1 || headerEnd > nextDelim) { start = nextDelim; continue }

    var headers   = body.slice(partStart, headerEnd).toString()
    var partData  = body.slice(headerEnd + 4, nextDelim - 2) // strip trailing \r\n

    var dispMatch = headers.match(/Content-Disposition:[^\n]*name="([^"]+)"/)
    var nameMatch = headers.match(/filename="([^"]+)"/)
    var typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/)

    if (dispMatch) {
      var fieldName = dispMatch[1]
      if (nameMatch) {
        result.file = {
          name: nameMatch[1],
          type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data: partData
        }
      } else {
        result.fields[fieldName] = partData.toString()
      }
    }
    start = nextDelim
  }
  return result
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  var user = await getCurrentUser(req, res)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  var ct = req.headers['content-type'] || ''
  var boundaryMatch = ct.match(/boundary=(.+)/)
  if (!boundaryMatch) return res.status(400).json({ error: 'Falta boundary en Content-Type' })

  var body    = await readBody(req)
  var parsed  = parseMultipart(body, boundaryMatch[1])
  var file    = parsed.file

  if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' })
  if (file.data.length > 20 * 1024 * 1024) return res.status(400).json({ error: 'El archivo excede el límite de 20 MB' })

  var client = getAdminClient()
  await ensureBucket(client)

  var ext      = file.name.split('.').pop()
  var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  var path     = user.id + '/' + Date.now() + '_' + safeName

  var { error: uploadErr } = await client.storage
    .from(BUCKET)
    .upload(path, file.data, { contentType: file.type, upsert: false })

  if (uploadErr) return res.status(500).json({ error: 'Error al subir: ' + uploadErr.message })

  var { data: urlData } = client.storage.from(BUCKET).getPublicUrl(path)
  return res.status(200).json({ url: urlData.publicUrl, name: file.name })
}
