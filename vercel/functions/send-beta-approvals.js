import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEVEN_MINUTES_MS = 7 * 60 * 1000;
const resend = new Resend(process.env.RESEND_API_KEY);

// Load email template
function getEmailTemplate(approvalUrl) {
  try {
    const templatePath = path.join(__dirname, '../../emails/beta-approval.html');
    const html = fs.readFileSync(templatePath, 'utf-8');
    // Replace placeholder with actual URL
    return html.replace(/{{approvalUrl}}/g, approvalUrl).replace(/{{APPROVAL_URL}}/g, approvalUrl);
  } catch (error) {
    console.error('Error loading email template:', error);
    // Fallback to inline template if file not found
    return getDefaultTemplate(approvalUrl);
  }
}

function getDefaultTemplate(approvalUrl) {
  return `
    <html>
      <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1>Welcome to BrassTally Beta!</h1>
          <p>We're excited to have you join our beta program.</p>
          <p>
            <a href="${approvalUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000; color: #fff; text-decoration: none; border-radius: 6px;">
              Accept Invitation
            </a>
          </p>
          <p>If you have any questions, please don't hesitate to reach out.</p>
          <p>Best regards,<br/>The BrassTally Team</p>
        </div>
      </body>
    </html>
  `;
}

export default async function handler(req, res) {
  // Verify this is a cron request or internal call
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional: Verify the cron secret (Vercel adds this automatically)
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const now = new Date();
    const sevenMinutesAgo = new Date(now.getTime() - SEVEN_MINUTES_MS);

    // Query pending signups created exactly 7 minutes ago
    const { data: pendingSignups, error: queryError } = await supabase
      .from('beta_signups')
      .select('*')
      .eq('status', 'pending')
      .lte('created_at', sevenMinutesAgo.toISOString())
      .order('created_at', { ascending: true });

    if (queryError) {
      console.error('Query error:', queryError);
      return res.status(500).json({ error: 'Failed to query signups' });
    }

    if (!pendingSignups || pendingSignups.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No pending signups to approve',
        processed: 0
      });
    }

    console.log(`Found ${pendingSignups.length} signups to approve`);

    // Process each signup
    const results = [];
    for (const signup of pendingSignups) {
      try {
        const approvalUrl = `${process.env.APP_URL}/auth?mode=approve`;
        const emailHtml = getEmailTemplate(approvalUrl);

        // Send invitation email via Resend
        const { data: emailData, error: emailError } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'noreply@brasstally.com',
          to: signup.email,
          subject: 'You\'re Invited to BrassTally Beta',
          html: emailHtml
        });

        if (emailError) {
          console.error(`Error sending email to ${signup.email}:`, emailError);
          results.push({
            email: signup.email,
            status: 'failed',
            error: emailError.message
          });
          continue;
        }

        // Update signup status to approved
        const { error: updateError } = await supabase
          .from('beta_signups')
          .update({
            status: 'approved',
            approved_at: new Date().toISOString()
          })
          .eq('email', signup.email);

        if (updateError) {
          console.error(`Error updating status for ${signup.email}:`, updateError);
          results.push({
            email: signup.email,
            status: 'email_sent_but_db_failed',
            error: updateError.message
          });
          continue;
        }

        results.push({
          email: signup.email,
          status: 'success'
        });

      } catch (error) {
        console.error(`Unexpected error for ${signup.email}:`, error);
        results.push({
          email: signup.email,
          status: 'error',
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failureCount = results.length - successCount;

    return res.status(200).json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: failureCount,
      results
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
