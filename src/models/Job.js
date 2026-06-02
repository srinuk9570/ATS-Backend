const db = require('../config/db');

class Job {
  static async create({ title, description, requirements, required_skills, location, salary_range, created_by }) {
    const query = `
      INSERT INTO jobs (title, description, requirements, required_skills, location, salary_range, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const result = await db.query(query, [
      title, description, requirements, required_skills, location, salary_range, created_by
    ]);
    return result.rows[0];
  }

  static async findAll(filters = {}) {
    let query = 'SELECT j.*, u.full_name as created_by_name FROM jobs j LEFT JOIN users u ON j.created_by = u.id WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (filters.status) {
      query += ` AND j.status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND (j.title ILIKE $${paramCount} OR j.description ILIKE $${paramCount})`;
      params.push(`%${filters.search}%`);
      paramCount++;
    }

    query += ' ORDER BY j.posted_date DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      params.push(filters.limit);
      paramCount++;
    }

    if (filters.offset) {
      query += ` OFFSET $${paramCount}`;
      params.push(filters.offset);
    }

    const result = await db.query(query, params);
    return result.rows;
  }

  static async findById(id) {
    const query = `
      SELECT j.*, u.full_name as created_by_name, u.email as created_by_email
      FROM jobs j 
      LEFT JOIN users u ON j.created_by = u.id 
      WHERE j.id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  static async update(id, updates) {
    const allowedUpdates = ['title', 'description', 'requirements', 'required_skills', 
                           'location', 'salary_range', 'status', 'closing_date'];
    const setClauses = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedUpdates.includes(key)) {
        setClauses.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (setClauses.length === 0) return null;

    values.push(id);
    const query = `
      UPDATE jobs 
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }

  static async delete(id) {
    const query = 'DELETE FROM jobs WHERE id = $1 RETURNING *';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  static async getStats(jobId) {
    const query = `
      SELECT 
        COUNT(*) as total_applications,
        COUNT(CASE WHEN status = 'Applied' THEN 1 END) as new_applications,
        COUNT(CASE WHEN status = 'Shortlisted' THEN 1 END) as shortlisted,
        COUNT(CASE WHEN status = 'Interviewed' THEN 1 END) as interviewed,
        COUNT(CASE WHEN status = 'Hired' THEN 1 END) as hired,
        ROUND(AVG(match_score), 2) as avg_score
      FROM applications
      WHERE job_id = $1
    `;
    const result = await db.query(query, [jobId]);
    return result.rows[0];
  }
}

module.exports = Job;