const nodemailer = require('nodemailer');
const config = require('../config/config');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      auth: {
        user: config.email.user,
        pass: config.email.pass
      }
    });
  }

  async sendApplicationConfirmation(candidateEmail, candidateName, jobTitle) {
    const mailOptions = {
      from: `"ATS System" <${config.email.from}>`,
      to: candidateEmail,
      subject: `Application Received - ${jobTitle}`,
      html: `
        <h2>Dear ${candidateName},</h2>
        <p>Thank you for applying for the position of <strong>${jobTitle}</strong>.</p>
        <p>We have received your application and our team will review it shortly.</p>
        <p>You will be notified about the status of your application via email.</p>
        <br>
        <p>Best regards,</p>
        <p>HR Team</p>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }

  async sendStatusUpdate(candidateEmail, candidateName, jobTitle, newStatus) {
    const mailOptions = {
      from: `"ATS System" <${config.email.from}>`,
      to: candidateEmail,
      subject: `Application Status Update - ${jobTitle}`,
      html: `
        <h2>Dear ${candidateName},</h2>
        <p>Your application for <strong>${jobTitle}</strong> has been updated.</p>
        <p>Current Status: <strong>${newStatus}</strong></p>
        <br>
        <p>Best regards,</p>
        <p>HR Team</p>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();