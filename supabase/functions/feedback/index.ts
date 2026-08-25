import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const { category, message, url, timestamp, user_id } = body;

    // Validate required fields
    if (!category || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 },
      );
    }

    // Insert feedback into database
    const { error: insertError } = await supabaseAdmin
      .from("beta_feedback")
      .insert([
        {
          category,
          message,
          url,
          timestamp,
          user_id,
          status: "new",
        },
      ]);

    if (insertError) throw insertError;

    // Optionally send notification email to team
    // (implement if you have an email service set up)

    return new Response(
      JSON.stringify({
        success: true,
        message: "Feedback received, thank you!",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error processing feedback:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process feedback",
      }),
      { status: 500 },
    );
  }
};
