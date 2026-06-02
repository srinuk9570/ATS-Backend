const axios = require('axios');
const config = require('../config/config');

class ResumeScorer {
  static async scoreResume(resumeText, requiredSkills) {
    try {
      // Call AI service for advanced scoring
      const response = await axios.post(`${config.aiService.url}/api/score`, {
        resume_text: resumeText,
        required_skills: requiredSkills
      });
      
      return response.data;
    } catch (error) {
      // Fallback to basic scoring if AI service is down
      console.warn('AI service unavailable, using basic scoring');
      return this.basicScore(resumeText, requiredSkills);
    }
  }

  static basicScore(resumeText, requiredSkills) {
    if (!resumeText || !requiredSkills) {
      return { score: 0, matched_skills: [], missing_skills: requiredSkills };
    }

    const resumeLower = resumeText.toLowerCase();
    const matchedSkills = [];
    const missingSkills = [];

    for (const skill of requiredSkills) {
      if (resumeLower.includes(skill.toLowerCase())) {
        matchedSkills.push(skill);
      } else {
        missingSkills.push(skill);
      }
    }

    const score = requiredSkills.length > 0 
      ? (matchedSkills.length / requiredSkills.length) * 100 
      : 0;

    return {
      score: Math.round(score * 100) / 100,
      matched_skills: matchedSkills,
      missing_skills: missingSkills
    };
  }

  static calculateKeywordDensity(resumeText, keywords) {
    const words = resumeText.toLowerCase().split(/\s+/);
    const totalWords = words.length;
    
    if (totalWords === 0) return {};

    const density = {};
    for (const keyword of keywords) {
      const count = words.filter(w => w === keyword.toLowerCase()).length;
      density[keyword] = (count / totalWords) * 100;
    }
    
    return density;
  }
}

module.exports = ResumeScorer;