import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resend = new Resend(process.env.RESEND_API_KEY);

function getForgotPasswordTemplate() {
  try {
    const templatePath = path.join(__dirname, '../../emails/forgot-password.html');
    return fs.readFileSync(templatePath, 'utf-8');
  } catch (error) {
    console.error('Error loading forgot password template:', error);
    return getDefaultTemplate();
  }
}

function getDefaultTemplate() {
  return `
    <html>
      <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1>Reset your BrassTally password</h1>
          <p>We received a request to reset the password for your BrassTally account.</p>
          <p><a href="{{resetUrl}}">Click here to reset your password</a></p>
          <p style="color: #666; font-size: 12px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
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

  const { email, resetUrl, subject = "Reset your BrassTally password" } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!resetUrl) {
    return res.status(400).json({ error: 'Reset URL is required' });
  }

  try {
    let html = getForgotPasswordTemplate();
    html = html.replace(/{{resetUrl}}/g, resetUrl);

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@brasstally.com',
      to: email,
      subject,
      html
    });

    if (error) {
      console.error('Error sending forgot password email:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
