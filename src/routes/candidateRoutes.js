const express = require('express');
const router = express.Router();
const candidateController = require('../controllers/candidateController');
const { auth, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Public route - Apply for job
router.post('/apply/:jobId', upload.single('resume'), candidateController.applyForJob);

// Protected routes
router.get('/job/:jobId', [
  auth,
  authorize('recruiter', 'admin')
], candidateController.getCandidatesForJob);

router.put('/application/:applicationId/status', [
  auth,
  authorize('recruiter', 'admin')
], candidateController.updateApplicationStatus);

router.get('/:candidateId', [
  auth,
  authorize('recruiter', 'admin')
], candidateController.getCandidateProfile);

module.exports = router;