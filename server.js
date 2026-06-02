// server.js
const express  = require('express')
const cors     = require('cors')
const morgan   = require('morgan')
const multer   = require('multer')
const axios    = require('axios')
const pdfParse = require('pdf-parse')
const mammoth  = require('mammoth')
const dotenv   = require('dotenv')
const passport = require('passport')

dotenv.config()

const app    = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
})

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173'

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      [FRONTEND, 'http://localhost:3000'],
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(passport.initialize())

// ── Auth routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./src/routes/auth'))

// ── In-memory scan store (replace with DB queries when ready) ─────────────────
let scans   = []
let scanId  = 1

// ── Health check (single definition — no duplicate) ───────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'ATS Intelligence API',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    db:        process.env.DB_NAME || 'ats_db',
  })
})

// ── Parse resume file ─────────────────────────────────────────────────────────
app.post('/api/parse-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' })

    const buf     = req.file.buffer
    const mime    = req.file.mimetype
    const fname   = req.file.originalname?.toLowerCase() || ''
    let text      = ''

    if (mime === 'application/pdf' || fname.endsWith('.pdf')) {
      const data = await pdfParse(buf)
      text = data.text
    } else if (mime.includes('word') || fname.endsWith('.docx') || fname.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer: buf })
      text = result.value
    } else {
      text = buf.toString('utf-8')
    }

    text = text.trim()
    if (!text || text.length < 10)
      return res.status(400).json({ error: 'No readable text found. The file may be scanned/image-based.' })

    const words = text.split(/\s+/).filter(Boolean).length
    res.json({ text, stats: { characters: text.length, words } })

  } catch (err) {
    console.error('Parse error:', err.message)
    res.status(500).json({ error: 'Failed to parse file: ' + err.message })
  }
})

// ── Claude AI proxy ───────────────────────────────────────────────────────────
// Frontend calls this instead of calling Anthropic directly
// This keeps your ANTHROPIC_API_KEY secure on the server
app.post('/api/ai/claude', async (req, res) => {
  try {
    const { prompt, maxTokens = 1000, systemPrompt } = req.body
    if (!prompt) return res.status(400).json({ error: 'prompt is required.' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey.startsWith('your_')) {
      // No API key — return fallback immediately
      return res.json({ text: generateFallback(prompt), source: 'fallback' })
    }

    const messages = [{ role: 'user', content: prompt }]
    const body = {
      model:      'claude-sonnet-4-20250514',
      max_tokens: Math.min(maxTokens, 2000),
      messages,
    }
    if (systemPrompt) body.system = systemPrompt

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      body,
      {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 30000,
      }
    )

    const text = response.data.content?.map(b => b.text || '').join('') || ''
    res.json({ text, source: 'claude', model: response.data.model })

  } catch (err) {
    console.error('Claude proxy error:', err.response?.data || err.message)
    // Graceful fallback — never crash the frontend
    res.json({ text: generateFallback(req.body.prompt || ''), source: 'fallback' })
  }
})

// ── Legacy /api/ai endpoint (keep for backward compat) ───────────────────────
app.post('/api/ai', async (req, res) => {
  try {
    const { message, maxTokens } = req.body
    if (!message) return res.status(400).json({ error: 'message is required.' })

    // Try forwarding to Claude proxy
    try {
      const r = await axios.post(`http://localhost:${process.env.PORT || 5000}/api/ai/claude`, {
        prompt:    message,
        maxTokens: maxTokens || 800,
      }, { timeout: 30000 })
      return res.json({ text: r.data.text, source: r.data.source })
    } catch {
      return res.json({ text: generateFallback(message), source: 'fallback' })
    }
  } catch (err) {
    console.error('AI endpoint error:', err.message)
    res.json({ text: generateFallback(req.body?.message || ''), source: 'fallback' })
  }
})

// ── ATS scan via text (used by frontend scanner) ──────────────────────────────
app.post('/api/quick-scan', async (req, res) => {
  try {
    const { resumeText, jobDescription, jobTitle, company } = req.body
    if (!resumeText || !jobDescription)
      return res.status(400).json({ error: 'Both resumeText and jobDescription are required.' })

    // Ask Claude to score the match
    const prompt = `You are an expert ATS analyzer. Analyze this resume against the job description and return ONLY valid JSON with no extra text.

RESUME:
${resumeText.slice(0, 3000)}

JOB DESCRIPTION:
${jobDescription.slice(0, 2000)}

Return this exact JSON:
{
  "kwScore": <0-100>,
  "lenScore": <0-100>,
  "sectScore": <0-100>,
  "formatScore": <0-100>,
  "total": <0-100>,
  "found": ["matched skill 1", "matched skill 2"],
  "missing": ["missing skill 1", "missing skill 2"],
  "summary": "<one sentence insight>"
}
Rules: found = skills in both resume+JD. missing = important JD skills absent from resume. total = kwScore*0.5 + lenScore*0.2 + sectScore*0.2 + formatScore*0.1. Return ONLY JSON.`

    let analysis = null

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey && !apiKey.startsWith('your_')) {
      try {
        const response = await axios.post(
          'https://api.anthropic.com/v1/messages',
          {
            model:      'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages:   [{ role: 'user', content: prompt }],
          },
          {
            headers: {
              'x-api-key':         apiKey,
              'anthropic-version': '2023-06-01',
              'content-type':      'application/json',
            },
            timeout: 30000,
          }
        )
        const rawText = response.data.content?.map(b => b.text || '').join('') || ''
        const clean   = rawText.replace(/```json|```/g, '').trim()
        analysis = JSON.parse(clean)
      } catch (aiErr) {
        console.error('Claude scan error:', aiErr.response?.data?.error?.message || aiErr.message)
      }
    }

    // Fallback to local scoring if AI unavailable
    if (!analysis) {
      analysis = localScore(resumeText, jobDescription)
    }

    const clamp = v => Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
    const scan = {
      id:          scanId++,
      jobTitle:    jobTitle   || 'Quick Scan',
      company:     company    || 'N/A',
      fileName:    'text-input',
      total:       clamp(analysis.total),
      kwScore:     clamp(analysis.kwScore),
      lenScore:    clamp(analysis.lenScore),
      sectScore:   clamp(analysis.sectScore),
      formatScore: clamp(analysis.formatScore),
      found:       Array.isArray(analysis.found)   ? analysis.found   : [],
      missing:     Array.isArray(analysis.missing) ? analysis.missing : [],
      aiSummary:   analysis.summary || '',
      jdKws:       [...new Set([...(analysis.found || []), ...(analysis.missing || [])])],
      resumeText,
      jdText:      jobDescription,
      scannedAt:   new Date().toISOString(),
      source:      analysis.source || (apiKey && !apiKey.startsWith('your_') ? 'claude' : 'local'),
    }

    scans.unshift(scan)
    res.json({ success: true, scan })

  } catch (err) {
    console.error('Quick scan error:', err.message)
    res.status(500).json({ error: 'Failed to analyze. ' + err.message })
  }
})

// ── Upload-based scan (file) ───────────────────────────────────────────────────
app.post('/api/scan', upload.single('resume'), async (req, res) => {
  try {
    const { jobDescription, jobTitle, company } = req.body
    if (!req.file)       return res.status(400).json({ error: 'Please upload a resume file.' })
    if (!jobDescription) return res.status(400).json({ error: 'Please provide a job description.' })

    // Parse file
    let resumeText = ''
    const buf  = req.file.buffer
    const mime = req.file.mimetype
    const fname = req.file.originalname?.toLowerCase() || ''

    if (mime === 'application/pdf' || fname.endsWith('.pdf')) {
      const data = await pdfParse(buf)
      resumeText = data.text
    } else if (mime.includes('word') || fname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: buf })
      resumeText = result.value
    } else {
      resumeText = buf.toString('utf-8')
    }

    // Reuse quick-scan logic via internal call
    const scanRes = await axios.post(
      `http://localhost:${process.env.PORT || 5000}/api/quick-scan`,
      { resumeText, jobDescription, jobTitle, company },
      { timeout: 35000 }
    )

    // Overwrite fileName with actual uploaded name
    if (scanRes.data.scan) {
      scanRes.data.scan.fileName = req.file.originalname
    }

    res.json(scanRes.data)

  } catch (err) {
    console.error('Scan error:', err.message)
    res.status(500).json({ error: 'Failed to analyze resume. ' + err.message })
  }
})

// ── Scan history endpoints ────────────────────────────────────────────────────
app.get('/api/scans', (req, res) => {
  res.json({ scans, total: scans.length })
})

app.get('/api/scans/:id', (req, res) => {
  const scan = scans.find(s => s.id === parseInt(req.params.id))
  if (!scan) return res.status(404).json({ error: 'Scan not found.' })
  res.json({ scan })
})

app.delete('/api/scans/:id', (req, res) => {
  const idx = scans.findIndex(s => s.id === parseInt(req.params.id))
  if (idx === -1) return res.status(404).json({ error: 'Scan not found.' })
  scans.splice(idx, 1)
  res.json({ success: true, message: 'Scan deleted.' })
})

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` })
})

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error.' })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000
app.listen(PORT, () => {
  const key = process.env.GOOGLE_API_KEY
  const aiStatus = (!key || key.startsWith('your_')) ? '⚠️  No key — using fallback' : '✅ Claude AI ready'

  console.log(`
╔══════════════════════════════════════════════╗
║        ATS Intelligence Backend v2.0         ║
╚══════════════════════════════════════════════╝

🚀  Server:   http://localhost:${PORT}
🌐  Frontend: ${FRONTEND}
🗄️   Database: ${process.env.DB_NAME || 'ats_db'} @ ${process.env.DB_HOST || 'localhost'}
🤖  AI:       ${aiStatus}

📡  Endpoints:
    GET  /api/health
    POST /api/auth/register
    POST /api/auth/login
    GET  /api/auth/me
    GET  /api/auth/google
    GET  /api/auth/facebook
    GET  /api/auth/linkedin
    POST /api/parse-resume
    POST /api/ai/claude          ← secure AI proxy
    POST /api/quick-scan         ← AI-powered ATS scan
    POST /api/scan               ← file upload scan
    GET  /api/scans
    GET  /api/scans/:id
    DELETE /api/scans/:id
`)
})

// ── Local keyword-based fallback scorer ───────────────────────────────────────
const SKILL_DB = [
  'javascript','typescript','python','java','c++','c#','go','rust','php','ruby','swift','kotlin',
  'react','vue','angular','next.js','nuxt','svelte','html','css','tailwind','sass','bootstrap',
  'node.js','express','django','flask','fastapi','spring','laravel','asp.net',
  'sql','postgresql','mysql','mongodb','redis','elasticsearch','firebase','supabase',
  'aws','azure','gcp','docker','kubernetes','terraform','ci/cd','devops','linux','nginx',
  'machine learning','deep learning','nlp','tensorflow','pytorch','pandas','numpy','scikit-learn',
  'rest api','graphql','microservices','git','agile','scrum','jira','figma','ui/ux',
  'react native','flutter','ios','android','testing','jest','cypress','selenium',
  'communication','leadership','teamwork','problem solving',
]

function extractKeywords(text) {
  const t = (text || '').toLowerCase()
  return SKILL_DB.filter(k => t.includes(k))
}

function localScore(resumeText, jdText) {
  const rk      = extractKeywords(resumeText)
  const jk      = extractKeywords(jdText)
  const found   = jk.filter(k => rk.includes(k))
  const missing = jk.filter(k => !rk.includes(k))
  const kwScore = jk.length ? Math.round((found.length / jk.length) * 100) : 50
  const words   = (resumeText || '').split(/\s+/).filter(Boolean).length
  const lenScore  = words > 400 ? 95 : words > 250 ? 80 : words > 150 ? 60 : 40
  const sections  = ['experience','education','skills','summary','projects']
    .filter(s => (resumeText || '').toLowerCase().includes(s)).length
  const sectScore   = Math.min(100, sections * 20)
  const formatScore = /\d+%|\$\d|team of \d/i.test(resumeText || '') ? 85 : 50
  const total = Math.min(100, Math.round(kwScore * 0.5 + lenScore * 0.2 + sectScore * 0.2 + formatScore * 0.1))
  return { total, kwScore, lenScore, sectScore, formatScore, found, missing, jdKws: jk, source: 'local' }
}

// ── Fallback AI text responses ─────────────────────────────────────────────────
function generateFallback(prompt = '') {
  const p = prompt.toLowerCase()
  if (p.includes('rewrite') && p.includes('bullet'))
    return `• Led cross-functional team of 8 to deliver projects 20% ahead of schedule\n• Developed scalable solutions improving system efficiency by 40%\n• Implemented automated testing reducing production bugs by 60%\n• Collaborated with stakeholders to define and execute product roadmap`
  if (p.includes('professional summary') || p.includes('3 different') || p.includes('variant'))
    return `Results-driven developer with 5+ years building scalable applications.\n---\nInnovative engineer passionate about creating efficient user-friendly systems.\n---\nDetail-oriented developer combining technical expertise with strong communication skills.`
  if ((p.includes('bullet') || p.includes('generate')) && p.includes('bullet'))
    return `• Led development of features serving 50,000+ daily users with 99.9% uptime\n• Optimized queries reducing page load time by 65%\n• Mentored 4 junior developers improving team velocity by 30%\n• Implemented CI/CD pipeline cutting deployment time from 2 hours to 15 minutes`
  if (p.includes('keyword') || p.includes('ats expert'))
    return `MISSING KEYWORDS:\n• Docker\n• Kubernetes\n• AWS\n• CI/CD\n\nALREADY PRESENT:\n• JavaScript\n• React\n• Node.js\n• Git\n\nSUGGESTIONS:\n• Add Docker and Kubernetes to Skills\n• Mention AWS in experience bullets\n• Add "REST API" to technical skills`
  if (p.includes('mistake') || p.includes('resume coach'))
    return `RESUME HEALTH SCORE: 72/100\n\n❌ CRITICAL:\n1. Weak verbs — replace with: Led, Built, Developed\n2. No metrics — add numbers like "increased by 30%"\n3. Missing Professional Summary\n\n✅ PASSING:\n• Clean formatting\n• Contact info complete\n• Education present`
  if (p.includes('humanize') || p.includes('buzzword'))
    return 'Your resume has been rewritten to sound natural, removing overused buzzwords while staying professional and results-focused.'
  if (p.includes('generate') && (p.includes('resume') || p.includes('create')))
    return `PROFESSIONAL SUMMARY\nResults-driven developer with expertise in full-stack development.\n\nTECHNICAL SKILLS\nJavaScript, Python, React, Node.js, PostgreSQL, Docker, AWS, Git\n\nEXPERIENCE\nSenior Developer | Tech Corp | 2021–Present\n• Built features serving 50,000+ daily users\n• Improved performance by 40%\n• Mentored 4 junior developers\n\nEDUCATION\nB.Tech Computer Science | 2020 | CGPA: 8.5`
  return 'Please provide more specific details for better AI-powered results.'
}