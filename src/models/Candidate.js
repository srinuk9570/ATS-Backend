const db = require('../config/db');

class Candidate {
  static async create({ name, email, phone, resume_url, resume_text, skills, experience_years, current_company, current_position }) {
    const query = `
      INSERT INTO candidates (name, email, phone, resume_url, resume_text, skills, experience_years, current_company, current_position)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        resume_url = EXCLUDED.resume_url,
        resume_text = EXCLUDED.resume_text,
        skills = EXCLUDED.skills,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await db.query(query, [
      name, email, phone, resume_url, resume_text, skills, 
      experience_years, current_company, current_position
    ]);
    return result.rows[0];
  }

  static async findById(id) {
    const query = 'SELECT * FROM candidates WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  static async findByEmail(email) {
    const query = 'SELECT * FROM candidates WHERE email = $1';
    const result = await db.query(query, [email]);
    return result.rows[0];
  }

  static async getApplications(candidateId) {
    const query = `
      SELECT a.*, j.title as job_title, j.company as job_company
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE a.candidate_id = $1
      ORDER BY a.applied_date DESC
    `;
    const result = await db.query(query, [candidateId]);
    return result.rows;
  }
}

module.exports = Candidate;