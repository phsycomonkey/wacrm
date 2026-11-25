// ============================================================
// GET /api/v1/conversations/{id} — read one conversation
// (scope: conversations:read). Account-scoped: a foreign id → 404.
// PATCH /api/v1/conversations/{id} — lock or unlock the chat for the AI bot
// (scope: conversations:write). Body: { "bot_locked": boolean }.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isUuid } from '@/lib/api/v1/pagination';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { Conversation } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Conversation not found', 404);

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] read error:', error);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;
    if (!isUuid(id)) return fail('not_found', 'Conversation not found', 404);

    const body = (await request.json().catch(() => null)) as {
      bot_locked?: unknown;
    } | null;
    if (!body || typeof body.bot_locked !== 'boolean') {
      return fail('bad_request', 'Body must be { "bot_locked": true | false }', 400);
    }

    const { data, error } = await ctx.supabase
      .from('conversations')
      .update({
        bot_locked: body.bot_locked,
        bot_locked_at: body.bot_locked ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(CONVERSATION_SELECT)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] update error:', error);
      return fail('internal', 'Failed to update conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
