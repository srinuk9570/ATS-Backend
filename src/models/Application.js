const db = require('../config/db');

class Application {
  static async create({ candidate_id, job_id, match_score, matched_skills, cover_letter }) {
    const query = `
      INSERT INTO applications (candidate_id, job_id, match_score, matched_skills, cover_letter)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (candidate_id, job_id) DO UPDATE SET
        match_score = EXCLUDED.match_score,
        matched_skills = EXCLUDED.matched_skills,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await db.query(query, [
      candidate_id, job_id, match_score, matched_skills, cover_letter
    ]);
    return result.rows[0];
  }

  static async findByJob(jobId, status = null) {
    let query = `
      SELECT a.*, c.name as candidate_name, c.email as candidate_email, 
             c.resume_url, c.skills as candidate_skills, c.experience_years
      FROM applications a
      JOIN candidates c ON a.candidate_id = c.id
      WHERE a.job_id = $1
    `;
    const params = [jobId];

    if (status) {
      query += ' AND a.status = $2';
      params.push(status);
    }

    query += ' ORDER BY a.match_score DESC';
    
    const result = await db.query(query, params);
    return result.rows;
  }

  static async updateStatus(applicationId, status, notes = null) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Update application status
      const updateQuery = `
        UPDATE applications 
        SET status = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;
      const appResult = await client.query(updateQuery, [status, applicationId]);
      
      // Add to pipeline stages
      const pipelineQuery = `
        INSERT INTO pipeline_stages (application_id, stage, notes)
        VALUES ($1, $2, $3)
      `;
      await client.query(pipelineQuery, [applicationId, status, notes]);
      
      await client.query('COMMIT');
      return appResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'Applied' THEN 1 END) as applied,
        COUNT(CASE WHEN status = 'Shortlisted' THEN 1 END) as shortlisted,
        COUNT(CASE WHEN status = 'Interviewed' THEN 1 END) as interviewed,
        COUNT(CASE WHEN status = 'Offered' THEN 1 END) as offered,
        COUNT(CASE WHEN status = 'Hired' THEN 1 END) as hired,
        COUNT(CASE WHEN status = 'Rejected' THEN 1 END) as rejected
      FROM applications
    `;
    const result = await db.query(query);
    return result.rows[0];
  }
}

module.exports = Application;