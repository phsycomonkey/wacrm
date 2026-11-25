-- CWB: who can see which chats, and a record of who did what.
--
-- 1. accounts.restrict_agent_chats (default false, so nothing changes until an admin turns it on).
--    When on, agents see only chats assigned to them (and the messages and contacts that go with
--    them). Owners, admins and viewers still see everything. Enforced in row-level security, so it
--    holds for the app, realtime and any direct query. The service role (n8n, webhooks) is unaffected.
-- 2. activity_log, written by database triggers, so every change is recorded with the signed-in
--    person who made it whatever screen they used. Readable by admins and owners only.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS restrict_agent_chats BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.can_view_conversation(p_account_id UUID, p_assigned_agent UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = p_account_id
      AND (
        p.account_role IN ('owner', 'admin', 'viewer')
        OR a.restrict_agent_chats = FALSE
        OR p_assigned_agent = auth.uid()
      )
  );
$$;

-- Runs as the function owner so it can see every conversation, not just the caller's.
CREATE OR REPLACE FUNCTION public.can_view_contact(p_account_id UUID, p_contact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = p_account_id
      AND (
        p.account_role IN ('owner', 'admin', 'viewer')
        OR a.restrict_agent_chats = FALSE
        OR EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.contact_id = p_contact_id AND c.assigned_agent_id = auth.uid()
        )
        OR NOT EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = p_contact_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_conversation(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_contact(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_conversation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_contact(UUID, UUID) TO authenticated;

-- Conversations: the SELECT policy is the gate.
DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (can_view_conversation(account_id, assigned_agent_id));

-- Messages: messages_modify was FOR ALL, which also granted SELECT to every agent and would
-- bypass the gate. Split it into per-command policies.
DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_modify ON public.messages;
DROP POLICY IF EXISTS messages_insert ON public.messages;
DROP POLICY IF EXISTS messages_update ON public.messages;
DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_view_conversation(c.account_id, c.assigned_agent_id)
  )
);
CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY messages_update ON public.messages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY messages_delete ON public.messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);

-- Contacts: restricted agents see contacts tied to their own chats, plus contacts with no chat yet.
DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT
  USING (can_view_contact(account_id, id));

-- ------------------------------------------------------------
-- Activity log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- NULL means the system did it (a webhook, the bot, an automation).
  actor_user_id UUID,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  contact_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_account_time ON public.activity_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_contact ON public.activity_log(contact_id, created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_log_select ON public.activity_log;
CREATE POLICY activity_log_select ON public.activity_log FOR SELECT
  USING (is_account_member(account_id, 'admin'));
-- No insert, update or delete policy: only the triggers below write, and nobody can edit the record.

-- Never lets a logging problem block real work.
CREATE OR REPLACE FUNCTION public._log_activity(
  p_account_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_contact_id UUID,
  p_detail JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_name TEXT;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT full_name INTO v_name FROM profiles WHERE user_id = v_actor;
  END IF;
  INSERT INTO activity_log (account_id, actor_user_id, actor_name, action, entity_type, entity_id, contact_id, detail)
  VALUES (p_account_id, v_actor, v_name, p_action, p_entity_type, p_entity_id, p_contact_id, COALESCE(p_detail, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._log_activity(UUID, TEXT, TEXT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- Conversations: assignment, team, status and the AI bot lock.
CREATE OR REPLACE FUNCTION public.trg_log_conversation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    PERFORM _log_activity(NEW.account_id, 'assigned_login', 'conversation', NEW.id, NEW.contact_id,
      jsonb_build_object('from', OLD.assigned_agent_id, 'to', NEW.assigned_agent_id));
  END IF;
  IF NEW.assigned_member_id IS DISTINCT FROM OLD.assigned_member_id OR NEW.assigned_team_id IS DISTINCT FROM OLD.assigned_team_id THEN
    PERFORM _log_activity(NEW.account_id, 'assigned_person', 'conversation', NEW.id, NEW.contact_id,
      jsonb_build_object('member_from', OLD.assigned_member_id, 'member_to', NEW.assigned_member_id,
                         'team_to', NEW.assigned_team_id));
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM _log_activity(NEW.account_id, 'status_changed', 'conversation', NEW.id, NEW.contact_id,
      jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  IF NEW.bot_locked IS DISTINCT FROM OLD.bot_locked THEN
    PERFORM _log_activity(NEW.account_id, CASE WHEN NEW.bot_locked THEN 'ai_on' ELSE 'ai_off' END,
      'conversation', NEW.id, NEW.contact_id, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_conversation_changes ON public.conversations;
CREATE TRIGGER log_conversation_changes AFTER UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_conversation();

-- Tags added to or removed from a contact.
CREATE OR REPLACE FUNCTION public.trg_log_contact_tag() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contact UUID;
  v_tag UUID;
  v_account UUID;
  v_tag_name TEXT;
BEGIN
  -- NEW does not exist in a DELETE trigger, so read the right record for each operation.
  IF TG_OP = 'DELETE' THEN
    v_contact := OLD.contact_id;
    v_tag := OLD.tag_id;
  ELSE
    v_contact := NEW.contact_id;
    v_tag := NEW.tag_id;
  END IF;
  SELECT account_id INTO v_account FROM contacts WHERE id = v_contact;
  SELECT name INTO v_tag_name FROM tags WHERE id = v_tag;
  IF v_account IS NOT NULL THEN
    PERFORM _log_activity(v_account, CASE WHEN TG_OP = 'INSERT' THEN 'tag_added' ELSE 'tag_removed' END,
      'contact', v_contact, v_contact, jsonb_build_object('tag', v_tag_name));
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_contact_tag_changes ON public.contact_tags;
CREATE TRIGGER log_contact_tag_changes AFTER INSERT OR DELETE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_contact_tag();

-- Notes.
CREATE OR REPLACE FUNCTION public.trg_log_contact_note() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _log_activity(NEW.account_id, 'note_added', 'contact', NEW.contact_id, NEW.contact_id,
    jsonb_build_object('text', left(NEW.note_text, 160)));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_contact_note_added ON public.contact_notes;
CREATE TRIGGER log_contact_note_added AFTER INSERT ON public.contact_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_contact_note();

-- Follow-ups: created and completed.
CREATE OR REPLACE FUNCTION public.trg_log_follow_up() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM _log_activity(NEW.account_id, 'followup_added', 'follow_up', NEW.id, NEW.contact_id,
      jsonb_build_object('due_at', NEW.due_at, 'note', left(COALESCE(NEW.note, ''), 160)));
  ELSIF NEW.done_at IS NOT NULL AND OLD.done_at IS NULL THEN
    PERFORM _log_activity(NEW.account_id, 'followup_done', 'follow_up', NEW.id, NEW.contact_id, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_follow_up_changes ON public.follow_ups;
CREATE TRIGGER log_follow_up_changes AFTER INSERT OR UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_follow_up();

-- Deals: created and moved between stages or closed.
CREATE OR REPLACE FUNCTION public.trg_log_deal() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM _log_activity(NEW.account_id, 'deal_created', 'deal', NEW.id, NEW.contact_id,
      jsonb_build_object('title', NEW.title, 'value', NEW.value));
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM _log_activity(NEW.account_id, 'deal_moved', 'deal', NEW.id, NEW.contact_id,
      jsonb_build_object('title', NEW.title, 'status', NEW.status,
        'stage', (SELECT name FROM pipeline_stages WHERE id = NEW.stage_id)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_deal_changes ON public.deals;
CREATE TRIGGER log_deal_changes AFTER INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_deal();

-- Contact details edited (field names only, not the values).
CREATE OR REPLACE FUNCTION public.trg_log_contact_edit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN v_fields := v_fields || 'name'; END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN v_fields := v_fields || 'phone'; END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN v_fields := v_fields || 'email'; END IF;
  IF NEW.company IS DISTINCT FROM OLD.company THEN v_fields := v_fields || 'company'; END IF;
  IF array_length(v_fields, 1) IS NOT NULL THEN
    PERFORM _log_activity(NEW.account_id, 'contact_edited', 'contact', NEW.id, NEW.id,
      jsonb_build_object('fields', to_jsonb(v_fields)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_contact_edits ON public.contacts;
CREATE TRIGGER log_contact_edits AFTER UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_contact_edit();
