import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  // Handle CORS preflight and health check
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", message: "invite-member function is running" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { email, orgId, level, invitedByName } = await req.json();

    if (!email || !orgId || !level) {
      return new Response(JSON.stringify({ error: "Missing required fields: email, orgId, level" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const validLevels = ["owner", "admin", "editor", "viewer"];
    if (!validLevels.includes(level)) {
      return new Response(JSON.stringify({ error: "Invalid level. Must be one of: " + validLevels.join(", ") }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: "Server configuration error: missing environment variables" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    // Verify the caller has permission (owner or admin in the org)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await supabase.auth.getUser(token);
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized: " + (callerError?.message || "Invalid token") }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: membership } = await supabase
      .from("org_members")
      .select("level")
      .eq("org_id", orgId)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!membership || (membership.level !== "owner" && membership.level !== "admin")) {
      return new Response(JSON.stringify({ error: "Only owners and admins can invite members" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // First try to find if user already exists
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const existingUser = users?.find(u => u.email === email);

    if (existingUser) {
      // User already exists — just add them to the org
      const { error: insertError } = await supabase
        .from("org_members")
        .upsert({ org_id: orgId, user_id: existingUser.id, level, status: "active" }, { onConflict: "org_id,user_id" });
      if (insertError) throw insertError;
      return new Response(JSON.stringify({ success: true, alreadyUser: true, userId: existingUser.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // New user — send invite
    const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://app.dashello.co",
      data: { invited_by: invitedByName ?? caller.user_metadata?.full_name ?? "A team member" },
    });

    if (inviteError) {
      // If invite fails but user exists in auth (edge case), still try to add
      const { data: { users: retryUsers } } = await supabase.auth.admin.listUsers();
      const retryUser = retryUsers?.find(u => u.email === email);
      if (retryUser) {
        const { error: insertError } = await supabase
          .from("org_members")
          .upsert({ org_id: orgId, user_id: retryUser.id, level, status: "active" }, { onConflict: "org_id,user_id" });
        if (insertError) throw insertError;
        return new Response(JSON.stringify({ success: true, alreadyUser: true, userId: retryUser.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw inviteError;
    }

    // New user invited — insert membership as invited
    if (invite?.user?.id) {
      const { error: insertError } = await supabase
        .from("org_members")
        .insert({ org_id: orgId, user_id: invite.user.id, level, status: "invited" });
      if (insertError) throw insertError;
    }

    return new Response(JSON.stringify({ success: true, userId: invite?.user?.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
