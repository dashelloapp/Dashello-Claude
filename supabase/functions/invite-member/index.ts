import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const { email, orgId, level, invitedByName } = await req.json();

    if (!email || !orgId || !level) {
      return new Response(JSON.stringify({ error: "Missing required fields: email, orgId, level" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const validLevels = ["owner", "admin", "editor", "viewer"];
    if (!validLevels.includes(level)) {
      return new Response(JSON.stringify({ error: "Invalid level. Must be one of: " + validLevels.join(", ") }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await supabase.auth.getUser(token);
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const { data: membership } = await supabase
      .from("org_members")
      .select("level")
      .eq("org_id", orgId)
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!membership || (membership.level !== "owner" && membership.level !== "admin")) {
      return new Response(JSON.stringify({ error: "Only owners and admins can invite members" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    // Invite the user via Supabase Auth
    const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://app.dashello.co",
      data: { invited_by: invitedByName ?? caller.user_metadata?.full_name ?? "A team member" },
    });

    if (inviteError) {
      // If user already exists, we can still add them to the org
      const { data: existingUser } = await supabase.auth.admin.listUsers();
      const found = existingUser?.users?.find(u => u.email === email);
      if (found) {
        const { error: insertError } = await supabase
          .from("org_members")
          .insert({ org_id: orgId, user_id: found.id, level, status: "active" });
        if (insertError) throw insertError;
        return new Response(JSON.stringify({ success: true, alreadyUser: true, userId: found.id }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      throw inviteError;
    }

    // New user invited — insert membership as pending
    if (invite?.user?.id) {
      const { error: insertError } = await supabase
        .from("org_members")
        .insert({ org_id: orgId, user_id: invite.user.id, level, status: "invited" });
      if (insertError) throw insertError;
    }

    return new Response(JSON.stringify({ success: true, userId: invite?.user?.id }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
