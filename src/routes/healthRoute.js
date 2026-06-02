// src/routes/healthRoute.js  — add to server.js
// app.use('/api/health', require('./src/routes/healthRoute'));

const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ATS Backend',
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 5000,
  });
});

module.exports = router;