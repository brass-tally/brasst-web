import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resend = new Resend(process.env.RESEND_API_KEY);

function getChangeEmailTemplate() {
  try {
    const templatePath = path.join(__dirname, '../../emails/change-email.html');
    return fs.readFileSync(templatePath, 'utf-8');
  } catch (error) {
    console.error('Error loading change email template:', error);
    return getDefaultTemplate();
  }
}

function getDefaultTemplate() {
  return `
    <html>
      <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1>Confirm your new email address</h1>
          <p>We received a request to change the email address associated with your BrassTally account.</p>
          <p><strong>New email address:</strong><br/>{{newEmail}}</p>
          <p><a href="{{confirmUrl}}">Click here to confirm this change</a></p>
          <p style="color: #666; font-size: 12px;">This link expires in 24 hours. Until you confirm, we'll continue using your current email address.</p>
          <p>If you didn't request this change, ignore this email and your email address will stay the same.</p>
          <p>If you have any questions, reply to this email or visit <a href="https://brasstally.com">brasstally.com</a>.</p>
          <p>Best regards,<br/>The BrassTally Team</p>
        </div>
      </body>
    </html>
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, newEmail, confirmUrl, subject = "Confirm your new email address" } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!newEmail) {
    return res.status(400).json({ error: 'New email is required' });
  }

  if (!confirmUrl) {
    return res.status(400).json({ error: 'Confirmation URL is required' });
  }

  try {
    let html = getChangeEmailTemplate();
    html = html.replace(/{{newEmail}}/g, newEmail);
    html = html.replace(/{{confirmUrl}}/g, confirmUrl);

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@brasstally.com',
      to: email,
      subject,
      html
    });

    if (error) {
      console.error('Error sending change email confirmation:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
