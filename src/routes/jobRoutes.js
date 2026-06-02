const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const jobController = require('../controllers/jobController');
const { auth, authorize } = require('../middleware/auth');

// Public routes
router.get('/', jobController.getAllJobs);
router.get('/:id', jobController.getJob);

// Protected routes (require authentication)
router.post('/', [
  auth,
  authorize('recruiter', 'admin'),
  body('title').notEmpty().withMessage('Job title is required'),
  body('description').notEmpty().withMessage('Job description is required'),
  body('required_skills').isArray().withMessage('Required skills must be an array')
], jobController.createJob);

router.put('/:id', [
  auth,
  authorize('recruiter', 'admin')
], jobController.updateJob);

router.delete('/:id', [
  auth,
  authorize('recruiter', 'admin')
], jobController.deleteJob);

module.exports = router;