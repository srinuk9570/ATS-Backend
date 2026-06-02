const Candidate = require('../models/Candidate');
const Application = require('../models/Application');
const ResumeScorer = require('../utils/scorer');
const emailService = require('../utils/email');
const Job = require('../models/Job');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs').promises;

exports.applyForJob = async (req, res) => {
  try {
    const { name, email, phone, experience_years, current_company, current_position, cover_letter } = req.body;
    const jobId = req.params.jobId;

    // Get job details
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Process resume file
    let resumeText = '';
    let skills = [];

    if (req.file) {
      const fileBuffer = await fs.readFile(req.file.path);
      
      // Extract text based on file type
      if (req.file.mimetype === 'application/pdf') {
        const pdfData = await pdfParse(fileBuffer);
        resumeText = pdfData.text;
      } else if (req.file.mimetype.includes('word')) {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        resumeText = result.value;
      }

      // Score resume
      const scoringResult = await ResumeScorer.scoreResume(resumeText, job.required_skills);
      
      skills = scoringResult.matched_skills || [];
      var matchScore = scoringResult.score || 0;
    } else {
      var matchScore = 0;
    }

    // Create or update candidate
    const candidate = await Candidate.create({
      name,
      email,
      phone,
      resume_url: req.file ? `/uploads/${req.file.filename}` : null,
      resume_text: resumeText,
      skills,
      experience_years: parseInt(experience_years) || null,
      current_company,
      current_position
    });

    // Create application
    const application = await Application.create({
      candidate_id: candidate.id,
      job_id: jobId,
      match_score: matchScore,
      matched_skills: skills,
      cover_letter
    });

    // Send confirmation email
    await emailService.sendApplicationConfirmation(email, name, job.title);

    res.status(201).json({
      message: 'Application submitted successfully',
      application: {
        ...application,
        match_score: matchScore,
        matched_skills: skills
      }
    });
  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
};

exports.getCandidatesForJob = async (req, res) => {
  try {
    const { status, sort_by = 'match_score', order = 'desc' } = req.query;
    
    const candidates = await Application.findByJob(req.params.jobId, status);
    
    res.json({ 
      job_id: req.params.jobId,
      candidates,
      total: candidates.length 
    });
  } catch (error) {
    console.error('Get candidates error:', error);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
};

exports.updateApplicationStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const applicationId = req.params.applicationId;

    const updatedApplication = await Application.updateStatus(applicationId, status, notes);

    // Send status update email
    const candidate = await Candidate.findById(updatedApplication.candidate_id);
    if (candidate) {
      const job = await Job.findById(updatedApplication.job_id);
      await emailService.sendStatusUpdate(candidate.email, candidate.name, job.title, status);
    }

    res.json({
      message: 'Application status updated',
      application: updatedApplication
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update application status' });
  }
};

exports.getCandidateProfile = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const applications = await Candidate.getApplications(req.params.candidateId);

    res.json({
      candidate,
      applications
    });
  } catch (error) {
    console.error('Get candidate profile error:', error);
    res.status(500).json({ error: 'Failed to fetch candidate profile' });
  }
};