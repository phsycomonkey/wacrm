-- CWB: per-conversation bot lock. When bot_locked is true the AI bot (n8n) owns the chat:
-- agents can read it but the composer is locked until someone takes over.
-- Plain columns with safe defaults; existing rows become unlocked.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS bot_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_locked_at timestamptz;
