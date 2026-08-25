import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the email template
function loadTemplate() {
  const templatePath = join(__dirname, '../../emails/beta-approval.html');
  return readFileSync(templatePath, 'utf-8');
}

function renderTemplate(template, data) {
  let html = template;
  html = html.replace(/\{\{\.ConfirmationURL\}\}/g, data.confirmationUrl || '#');
  html = html.replace(/\{\{\.Token\}\}/g, data.token || '');
  html = html.replace(/\{\{\.SiteURL\}\}/g, process.env.APP_URL || 'brasstally.com');
  return html;
}

export async function sendApprovalEmail({ email, confirmationUrl, token }) {
  try {
    const template = loadTemplate();
    const html = renderTemplate(template, {
      confirmationUrl,
      token
    });

    // Use Resend if available (recommended for Vercel)
    if (process.env.RESEND_API_KEY) {
      return await sendViaResend(email, html);
    }

    // Fallback: could use other services here
    console.warn('No email service configured. Skipping email send.');
    return {
      success: false,
      error: 'No email service configured'
    };

  } catch (error) {
    console.error('Email template error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function sendViaResend(email, html) {
  try {
    // Dynamic import to avoid requiring Resend if not using it
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@brasstally.com',
      to: email,
      subject: "You're approved for BrassTally Beta",
      html
    });

    if (result.error) {
      console.error('Resend error:', result.error);
      return {
        success: false,
        error: result.error.message
      };
    }

    return {
      success: true,
      messageId: result.data.id
    };

  } catch (error) {
    console.error('Resend send error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
