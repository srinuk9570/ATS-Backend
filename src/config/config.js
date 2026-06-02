module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_secret_key',
    expiresIn: process.env.JWT_EXPIRE || '30d',
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB
    allowedTypes: ['application/pdf', 'application/msword', 
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    uploadPath: process.env.UPLOAD_PATH || './uploads'
  },
  email: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.FROM_EMAIL
  },
  aiService: {
    url: process.env.AI_SERVICE_URL || 'http://localhost:5001'
  }
};