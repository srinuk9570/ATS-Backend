// src/config/db.js
const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '9570',
  database: process.env.DB_NAME     || 'ats_db',
  // Connection pool settings
  max:             10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ PostgreSQL connection error:', err.message)
    console.error('   Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in .env')
  } else {
    console.log('✅ PostgreSQL connected to', process.env.DB_NAME || 'ats_db')
    release()
  }
})

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message)
})

module.exports = pool