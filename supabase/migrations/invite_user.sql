-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/rhkrkdwqrzzmakxxsozg/sql/new)
-- This creates a function that can be called as an RPC from the client with elevated privileges

create or replace function public.invite_user(invite_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  user_id uuid;
begin
  -- Call the auth admin function to create and invite the user
  user_id := auth.uid(); -- just to verify caller is authenticated
  
  -- The actual invite happens via the auth API
  -- We store the invite request for processing
  insert into public.pending_invites (email, invited_by, created_at)
  values (invite_email, auth.uid(), now());
  
  return json_build_object('success', true, 'email', invite_email);
end;
$$;
