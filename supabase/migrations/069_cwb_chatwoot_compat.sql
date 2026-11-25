-- CWB: numeric ids and bot state so the n8n bot (built for numeric ids, labels, priority,
-- private notes and custom attributes) can run against WACRM unchanged.
-- Additive only. One shared sequence gives every row a stable numeric twin of its uuid.

CREATE SEQUENCE IF NOT EXISTS public.cw_seq;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS cw_id BIGINT DEFAULT nextval('public.cw_seq'),
  ADD COLUMN IF NOT EXISTS cw_labels TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cw_priority TEXT,
  ADD COLUMN IF NOT EXISTS cw_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS cw_id BIGINT DEFAULT nextval('public.cw_seq'),
  ADD COLUMN IF NOT EXISTS cw_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS cw_id BIGINT DEFAULT nextval('public.cw_seq'),
  ADD COLUMN IF NOT EXISTS cw_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS cw_id BIGINT DEFAULT nextval('public.cw_seq');
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS cw_id BIGINT DEFAULT nextval('public.cw_seq');

CREATE UNIQUE INDEX IF NOT EXISTS conversations_cw_id_key ON public.conversations(cw_id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_cw_id_key ON public.messages(cw_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_cw_id_key ON public.contacts(cw_id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_cw_id_key ON public.teams(cw_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_cw_id_key ON public.team_members(cw_id);

-- Private notes on a conversation (hand-off notes, /tell notes). Visible to staff only.
CREATE TABLE IF NOT EXISTS public.conversation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cw_id BIGINT NOT NULL DEFAULT nextval('public.cw_seq'),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Bot',
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_notes_cw_id_key ON public.conversation_notes(cw_id);
CREATE INDEX IF NOT EXISTS conversation_notes_conv ON public.conversation_notes(conversation_id, created_at);
ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_notes_select ON public.conversation_notes;
DROP POLICY IF EXISTS conversation_notes_insert ON public.conversation_notes;
CREATE POLICY conversation_notes_select ON public.conversation_notes FOR SELECT USING (is_account_member(account_id));
CREATE POLICY conversation_notes_insert ON public.conversation_notes FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
