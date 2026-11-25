-- CWB: teams, team members (who do NOT need a login) and follow-ups, plus team/member
-- assignment on conversations. Additive only; existing rows are untouched.

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('sales', 'operations', 'admin', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Optional WhatsApp number, so the bot can message this person.
  phone TEXT,
  -- Optional link to a login. Most staff do not need one.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON public.team_members(team_id);

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  assigned_member_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON public.follow_ups(account_id, done_at, due_at);
CREATE INDEX IF NOT EXISTS idx_follow_ups_contact ON public.follow_ups(contact_id);

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_member_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

-- Teams and members: every member can read; admin+ manages.
DROP POLICY IF EXISTS teams_select ON public.teams;
DROP POLICY IF EXISTS teams_insert ON public.teams;
DROP POLICY IF EXISTS teams_update ON public.teams;
DROP POLICY IF EXISTS teams_delete ON public.teams;
CREATE POLICY teams_select ON public.teams FOR SELECT USING (is_account_member(account_id));
CREATE POLICY teams_insert ON public.teams FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY teams_update ON public.teams FOR UPDATE USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY teams_delete ON public.teams FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS team_members_select ON public.team_members;
DROP POLICY IF EXISTS team_members_insert ON public.team_members;
DROP POLICY IF EXISTS team_members_update ON public.team_members;
DROP POLICY IF EXISTS team_members_delete ON public.team_members;
CREATE POLICY team_members_select ON public.team_members FOR SELECT USING (is_account_member(account_id));
CREATE POLICY team_members_insert ON public.team_members FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY team_members_update ON public.team_members FOR UPDATE USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY team_members_delete ON public.team_members FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Follow-ups: every member can read; agent+ creates, completes and removes them.
DROP POLICY IF EXISTS follow_ups_select ON public.follow_ups;
DROP POLICY IF EXISTS follow_ups_insert ON public.follow_ups;
DROP POLICY IF EXISTS follow_ups_update ON public.follow_ups;
DROP POLICY IF EXISTS follow_ups_delete ON public.follow_ups;
CREATE POLICY follow_ups_select ON public.follow_ups FOR SELECT USING (is_account_member(account_id));
CREATE POLICY follow_ups_insert ON public.follow_ups FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY follow_ups_update ON public.follow_ups FOR UPDATE USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY follow_ups_delete ON public.follow_ups FOR DELETE USING (is_account_member(account_id, 'agent'));
