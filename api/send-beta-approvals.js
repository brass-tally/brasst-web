import { createClient } from '@supabase/supabase-js';
import { sendApprovalEmail } from './lib/email.js';

const SEVEN_MINUTES_MS = 7 * 60 * 1000;

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
        // Generate an invite token/link
        const { data, error: inviteError } = await supabase.auth.admin.generateLink({
          type: 'signup',
          email: signup.email,
          options: {
            redirectTo: `${process.env.APP_URL}/auth?mode=approve`
          }
        });

        if (inviteError) {
          console.error(`Error generating invite for ${signup.email}:`, inviteError);
          results.push({
            email: signup.email,
            status: 'failed',
            error: inviteError.message
          });
          continue;
        }

        // Send approval email with the invite link
        const emailResult = await sendApprovalEmail({
          email: signup.email,
          confirmationUrl: data.properties.action_link,
          token: data.properties.hashed_token
        });

        if (!emailResult.success) {
          console.error(`Failed to send email to ${signup.email}:`, emailResult.error);
          results.push({
            email: signup.email,
            status: 'failed',
            error: emailResult.error
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
