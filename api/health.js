export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const checks = {
    supabaseUrl: !!process.env.SUPABASE_URL,
    supabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    appUrl: !!process.env.APP_URL,
    resendKey: !!process.env.RESEND_API_KEY,
    resendEmail: !!process.env.RESEND_FROM_EMAIL,
  };

  const allConfigured = Object.values(checks).every(v => v);

  return res.status(allConfigured ? 200 : 400).json({
    status: allConfigured ? 'ready' : 'incomplete',
    checks,
    message: allConfigured
      ? 'All environment variables configured'
      : 'Missing environment variables. See checks above.'
  });
}
