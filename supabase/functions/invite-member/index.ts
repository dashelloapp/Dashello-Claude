import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", message: "invite-member function is running" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("step: parsing body");
    const { email, orgId, level, orgName, invitedByName } = await req.json();

    console.log("step: validate email");
    if (!email) {
      return new Response(JSON.stringify({ error: "Missing required field: email" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: "Server configuration error: missing environment variables" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("step: creating supabase client");
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    console.log("step: checking auth header");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("step: verifying caller");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await supabase.auth.getUser(token);
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const displayName = orgName || "Dashello";
    const inviterName = invitedByName || caller.user_metadata?.full_name || caller.email || "A team member";

    console.log("step: calling inviteUserByEmail for", email);
    const invitePromise = supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://app.dashello.co",
      data: {
        org_name: displayName,
        invited_by: inviterName,
      },
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("inviteUserByEmail timed out after 25 seconds")), 25000)
    );
    const { data: invite, error: inviteError } = await Promise.race([invitePromise, timeout]) as any;

    console.log("step: invite result", inviteError ? "error" : "success");

    if (inviteError) {
      console.error("inviteUserByEmail error:", inviteError);
      if (inviteError.message?.includes("SMTP") || inviteError.message?.includes("smtp")) {
        throw new Error("Email sending is not configured. Please enable SMTP in your Supabase project's Auth settings.");
      }
      throw new Error(inviteError.message || "Failed to send invite email");
    }

    console.log("step: insert team_members record");
    if (orgId) {
      const { error: insertError } = await supabase.from("team_members").insert({
        org_id: orgId,
        email: email,
        level: level || "viewer",
        status: "invited",
        invited_by: caller.id,
        created_at: new Date().toISOString(),
      });
      if (insertError) {
        console.error("Failed to insert team_members record:", insertError.message);
      }
    }

    console.log("step: returning success");
    return new Response(JSON.stringify({ success: true, userId: invite?.user?.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("invite-member caught error:", err);
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
