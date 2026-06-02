// src/routes/auth.js
const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const passport = require('passport')
const db       = require('../config/db')

const JWT_SECRET = process.env.JWT_SECRET || 'srinu_secret_key_ats_2026'
const FRONTEND   = process.env.FRONTEND_URL || 'https://ats-frontend-liard.vercel.app'

// ── JWT helper ────────────────────────────────────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.full_name },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  )
}

// ── OAuth: upsert user ────────────────────────────────────────────────────────
async function findOrCreateOAuthUser(email, fullName, provider) {
  let result = await db.query('SELECT * FROM users WHERE email = $1', [email])
  if (result.rows.length > 0) return result.rows[0]

  result = await db.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'user') RETURNING *`,
    [email, 'OAUTH_' + provider.toUpperCase(), fullName]
  )
  return result.rows[0]
}

// ── OAuth response helpers ─────────────────────────────────────────────────────
function oauthSuccess(res, user) {
  const token    = makeToken(user)
  const userData = JSON.stringify({
    id:    user.id,
    name:  user.full_name,
    email: user.email,
    role:  user.role,
  })
  res.send(`<!DOCTYPE html><html><body><script>
    if (window.opener) {
      window.opener.postMessage(
        { type: 'oauth_success', token: ${JSON.stringify(token)}, user: ${userData} },
        ${JSON.stringify(FRONTEND)}
      );
    }
    window.close();
  </script></body></html>`)
}

function oauthFail(res, msg) {
  res.send(`<!DOCTYPE html><html><body><script>
    if (window.opener) {
      window.opener.postMessage(
        { type: 'oauth_error', error: ${JSON.stringify(msg)} },
        ${JSON.stringify(FRONTEND)}
      );
    }
    window.close();
  </script></body></html>`)
}

// ── Passport: Google ──────────────────────────────────────────────────────────
const GoogleStrategy = require('passport-google-oauth20').Strategy

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET &&
    !process.env.GOOGLE_CLIENT_ID.startsWith('your_')) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: 'https://ats-backend-s69p.onrender.com/api/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email    = profile.emails?.[0]?.value
      const fullName = profile.displayName || 'Google User'
      if (!email) return done(new Error('No email from Google'))
      const user = await findOrCreateOAuthUser(email, fullName, 'google')
      done(null, user)
    } catch (err) { done(err) }
  }))
  console.log('✅ Google OAuth configured')
} else {
  console.log('⚠️  Google OAuth: credentials missing — route will return friendly error')
}

// ── Passport: Facebook ────────────────────────────────────────────────────────
const FacebookStrategy = require('passport-facebook').Strategy

if (process.env.FACEBOOK_APP_ID && !process.env.FACEBOOK_APP_ID.startsWith('your_')) {
  passport.use(new FacebookStrategy({
    clientID:      process.env.FACEBOOK_APP_ID,
    clientSecret:  process.env.FACEBOOK_APP_SECRET,
    callbackURL: 'https://ats-backend-s69p.onrender.com/api/auth/facebook/callback',
    profileFields: ['id', 'emails', 'name'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email    = profile.emails?.[0]?.value || `fb_${profile.id}@placeholder.com`
      const fullName = `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() || 'Facebook User'
      const user = await findOrCreateOAuthUser(email, fullName, 'facebook')
      done(null, user)
    } catch (err) { done(err) }
  }))
  console.log('✅ Facebook OAuth configured')
}

// ── Passport: LinkedIn ────────────────────────────────────────────────────────
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy

if (process.env.LINKEDIN_CLIENT_ID && !process.env.LINKEDIN_CLIENT_ID.startsWith('your_')) {
  passport.use(new LinkedInStrategy({
    clientID:     process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: 'https://ats-backend-s69p.onrender.com/api/auth/linkedin/callback',
    scope:        ['r_emailaddress', 'r_liteprofile'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email    = profile.emails?.[0]?.value
      const fullName = profile.displayName || 'LinkedIn User'
      if (!email) return done(new Error('No email from LinkedIn'))
      const user = await findOrCreateOAuthUser(email, fullName, 'linkedin')
      done(null, user)
    } catch (err) { done(err) }
  }))
  console.log('✅ LinkedIn OAuth configured')
}

// ── Google routes ─────────────────────────────────────────────────────────────
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.startsWith('your_'))
    return oauthFail(res, 'Google OAuth not configured on this server')
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next)
})
router.get('/google/callback',
  (req, res, next) => passport.authenticate('google', {
    session: false,
    failWithError: true,
  })(req, res, next),
  (req, res) => oauthSuccess(res, req.user),
  (err, req, res, next) => oauthFail(res, 'Google login failed')
)

// ── Facebook routes ───────────────────────────────────────────────────────────
router.get('/facebook', (req, res, next) => {
  if (!process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID.startsWith('your_'))
    return oauthFail(res, 'Facebook OAuth not configured on this server')
  passport.authenticate('facebook', { scope: ['email'], session: false })(req, res, next)
})
router.get('/facebook/callback',
  (req, res, next) => passport.authenticate('facebook', { session: false, failWithError: true })(req, res, next),
  (req, res) => oauthSuccess(res, req.user),
  (err, req, res, next) => oauthFail(res, 'Facebook login failed')
)

// ── LinkedIn routes ───────────────────────────────────────────────────────────
router.get('/linkedin', (req, res, next) => {
  if (!process.env.LINKEDIN_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID.startsWith('your_'))
    return oauthFail(res, 'LinkedIn OAuth not configured on this server')
  passport.authenticate('linkedin', { session: false })(req, res, next)
})
router.get('/linkedin/callback',
  (req, res, next) => passport.authenticate('linkedin', { session: false, failWithError: true })(req, res, next),
  (req, res) => oauthSuccess(res, req.user),
  (err, req, res, next) => oauthFail(res, 'LinkedIn login failed')
)

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' })
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' })

    const exists = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (exists.rows.length > 0)
      return res.status(400).json({ error: 'This email is already registered.' })

    const hash   = await bcrypt.hash(password, 10)
    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, full_name, role`,
      [email.toLowerCase(), hash, name.trim()]
    )
    const user  = result.rows[0]
    const token = makeToken(user)

    res.status(201).json({
      token,
      user: { id: user.id, name: user.full_name, email: user.email, role: user.role }
    })
  } catch (err) {
    console.error('Register error:', err.message)
    if (err.code === '23505') // unique_violation
      return res.status(400).json({ error: 'This email is already registered.' })
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email?.trim() || !password)
      return res.status(400).json({ error: 'Email and password are required.' })

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])
    const user   = result.rows[0]

    if (!user)
      return res.status(401).json({ error: 'Invalid email or password.' })

    if (user.password_hash?.startsWith('OAUTH_')) {
      const provider = user.password_hash.replace('OAUTH_', '').toLowerCase()
      return res.status(400).json({
        error: `This account was created with ${provider} login. Please use the "${provider.charAt(0).toUpperCase() + provider.slice(1)}" button instead.`
      })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password.' })

    const token = makeToken(user)
    res.json({
      token,
      user: { id: user.id, name: user.full_name, email: user.email, role: user.role }
    })
  } catch (err) {
    console.error('Login error:', err.message)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

// ── GET /api/auth/me (protected) ──────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) return res.status(401).json({ error: 'No token provided.' })

    const decoded = jwt.verify(token, JWT_SECRET)
    const result  = await db.query(
      'SELECT id, email, full_name, role, created_at FROM users WHERE id = $1',
      [decoded.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'User not found.' })

    const u = result.rows[0]
    res.json({ id: u.id, name: u.full_name, email: u.email, role: u.role, createdAt: u.created_at })
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' })
  }
})

module.exports = router