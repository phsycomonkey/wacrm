-- CWB: alert staff when a client's message goes unanswered.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS unanswered_alerted_at TIMESTAMPTZ;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'conversation_unanswered'));
