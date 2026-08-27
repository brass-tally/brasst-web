import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resend = new Resend(process.env.RESEND_API_KEY);

function getWelcomeTemplate() {
  try {
    const templatePath = path.join(__dirname, '../../emails/brasstally-welcome-invite.html');
    return fs.readFileSync(templatePath, 'utf-8');
  } catch (error) {
    console.error('Error loading welcome template:', error);
    return getDefaultTemplate();
  }
}

function getDefaultTemplate() {
  return `
    <html>
      <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1>Welcome to BrassTally!</h1>
          <p>We're excited to have you on board.</p>
          <p>Your account is all set up. You can now sign in and start organizing your books.</p>
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

  const { email, subject = "Welcome to BrassTally!" } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const html = getWelcomeTemplate();

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@brasstally.com',
      to: email,
      subject,
      html
    });

    if (error) {
      console.error('Error sending welcome email:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
