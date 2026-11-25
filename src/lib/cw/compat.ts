// ============================================================
// Chatwoot-shaped API on top of WACRM, for the CWB n8n bot.
//
// The bot (V7) was built against Chatwoot: numeric conversation ids, labels, priority, private
// notes, custom attributes, assign-to-team. V8 is the same workflow pointed here. Everything
// below translates those calls into WACRM tables. Authenticated with the same Bearer API key as
// /api/v1. Paths: /api/cw/api/v1/accounts/{n}/...
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import type { ApiScope } from '@/lib/api-keys/scopes';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Db = SupabaseClient;

const J = (body: unknown, status = 200) => NextResponse.json(body, { status });
const bad = (msg: string, status = 400) => J({ error: msg }, status);
const epoch = (iso?: string | null) =>
  iso ? Math.floor(new Date(iso).getTime() / 1000) : 0;
const isNum = (s: string) => /^\d+$/.test(s);
const hashId = (uuid: string) => parseInt(uuid.replace(/-/g, '').slice(0, 8), 16);

const STATUS_OUT: Record<string, string> = {
  open: 'open',
  pending: 'pending',
  closed: 'resolved',
};
const STATUS_IN: Record<string, string> = {
  open: 'open',
  pending: 'pending',
  snoozed: 'pending',
  resolved: 'closed',
  closed: 'closed',
};

// ---------- lookups ----------

async function findConversation(db: Db, acct: string, id: string) {
  const col = isNum(id) ? 'cw_id' : 'id';
  const { data } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', acct)
    .eq(col, id)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

async function findContact(db: Db, acct: string, id: string) {
  const col = isNum(id) ? 'cw_id' : 'id';
  const { data } = await db
    .from('contacts')
    .select('*')
    .eq('account_id', acct)
    .eq(col, id)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

// ---------- serializers ----------

function contactOut(c: Row) {
  return {
    id: Number(c.cw_id),
    uuid: c.id,
    name: c.name ?? '',
    email: c.email ?? null,
    phone_number: c.phone ?? null,
    custom_attributes: c.cw_attrs ?? {},
    additional_attributes: {},
    created_at: epoch(c.created_at),
  };
}

async function conversationsOut(db: Db, rows: Row[]) {
  if (!rows.length) return [];
  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const memberIds = [
    ...new Set(rows.map((r) => r.assigned_member_id).filter(Boolean)),
  ];
  const teamIds = [
    ...new Set(rows.map((r) => r.assigned_team_id).filter(Boolean)),
  ];
  const [{ data: cs }, { data: ms }, { data: ts }] = await Promise.all([
    db.from('contacts').select('*').in('id', contactIds),
    memberIds.length
      ? db.from('team_members').select('*').in('id', memberIds)
      : Promise.resolve({ data: [] as Row[] }),
    teamIds.length
      ? db.from('teams').select('*').in('id', teamIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const cmap = new Map((cs ?? []).map((c: Row) => [c.id, c]));
  const mmap = new Map((ms ?? []).map((m: Row) => [m.id, m]));
  const tmap = new Map((ts ?? []).map((t: Row) => [t.id, t]));
  return rows.map((r) => {
    const c = cmap.get(r.contact_id);
    const m = r.assigned_member_id ? mmap.get(r.assigned_member_id) : null;
    const t = r.assigned_team_id ? tmap.get(r.assigned_team_id) : null;
    let assignee: Row | null = null;
    let assignee_type: string | null = null;
    if (r.bot_locked) {
      assignee = { id: 0, name: 'CWB assistant', type: 'agent_bot' };
      assignee_type = 'AgentBot';
    } else if (m) {
      assignee = { id: Number(m.cw_id), name: m.name, type: 'agent' };
      assignee_type = 'User';
    }
    return {
      id: Number(r.cw_id),
      uuid: r.id,
      inbox_id: 1,
      status: STATUS_OUT[r.status] ?? 'open',
      priority: r.cw_priority ?? null,
      labels: r.cw_labels ?? [],
      custom_attributes: r.cw_attrs ?? {},
      additional_attributes: {},
      unread_count: r.unread_count ?? 0,
      timestamp: epoch(r.last_message_at ?? r.created_at),
      created_at: epoch(r.created_at),
      contact_last_seen_at: epoch(r.last_inbound_at),
      agent_last_seen_at: epoch(r.last_reply_at),
      meta: {
        sender: c ? contactOut(c) : null,
        assignee,
        assignee_type,
        team: t ? { id: Number(t.cw_id), name: t.name } : null,
        channel: 'Channel::Whatsapp',
      },
    };
  });
}

function messageOut(m: Row) {
  const inbound = m.sender_type === 'customer';
  const bot = !!(m.ai_generated || (m.cw_attrs && m.cw_attrs.bot_reply));
  return {
    id: Number(m.cw_id),
    uuid: m.id,
    content: m.content_text ?? '',
    message_type: inbound ? 0 : 1,
    private: false,
    content_type: m.content_type,
    content_attributes: m.cw_attrs ?? {},
    created_at: epoch(m.created_at),
    status: m.status,
    sender: inbound
      ? { type: 'contact', id: 0, name: '' }
      : bot
        ? { type: 'agent_bot', id: 0, name: 'CWB assistant' }
        : {
            type: 'user',
            id: m.sender_id ? hashId(m.sender_id) : 0,
            name: 'Agent',
          },
    attachments: m.media_url
      ? [
          {
            file_type: m.content_type === 'document' ? 'file' : m.content_type,
            data_url: m.media_url,
            extension: null,
          },
        ]
      : [],
  };
}

function noteOut(n: Row) {
  return {
    id: Number(n.cw_id),
    uuid: n.id,
    content: n.content,
    message_type: 1,
    private: true,
    content_type: 'text',
    content_attributes: n.attrs ?? {},
    created_at: epoch(n.created_at),
    sender: { type: 'user', id: 0, name: n.author || 'Bot' },
    attachments: [],
  };
}

// ---------- handlers ----------

async function messagesFor(db: Db, conv: Row) {
  const [{ data: ms }, { data: ns }] = await Promise.all([
    db
      .from('messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('conversation_notes')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const all = [
    ...(ms ?? []).map((m: Row) => messageOut(m)),
    ...(ns ?? []).map((n: Row) => noteOut(n)),
  ];
  all.sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  return all;
}

async function postMessage(db: Db, acct: string, conv: Row, body: Row) {
  const content = String(body.content ?? '');
  const attrs =
    body.content_attributes && typeof body.content_attributes === 'object'
      ? (body.content_attributes as Row)
      : {};
  if (body.private === true || body.private === 'true') {
    const { data, error } = await db
      .from('conversation_notes')
      .insert({
        account_id: acct,
        conversation_id: conv.id,
        content,
        author: String(body.author || 'Bot'),
        attrs,
      })
      .select('*')
      .single();
    if (error) return bad(error.message, 500);
    return J(noteOut(data as Row), 200);
  }
  const mediaUrl = typeof body.media_url === 'string' ? body.media_url : '';
  const isDoc = /\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i.test(mediaUrl);
  try {
    const res = await sendMessageToConversation(db, acct, {
      conversationId: conv.id,
      messageType: mediaUrl ? (isDoc ? 'document' : 'image') : 'text',
      contentText: content || null,
      mediaUrl: mediaUrl || null,
    } as never);
    const botReply = attrs.bot_reply === true || attrs.bot_reply === 'true';
    await db
      .from('messages')
      .update({ cw_attrs: attrs, ai_generated: botReply })
      .eq('id', res.messageId);
    const { data: row } = await db
      .from('messages')
      .select('*')
      .eq('id', res.messageId)
      .single();
    return J(messageOut(row as Row), 200);
  } catch (e) {
    if (e instanceof SendMessageError) {
      return bad(e.message, (e as unknown as { status?: number }).status ?? 400);
    }
    return bad(e instanceof Error ? e.message : 'send failed', 500);
  }
}

async function setLabels(db: Db, conv: Row, labels: unknown) {
  const list = Array.isArray(labels)
    ? [...new Set(labels.map((l) => String(l).trim()).filter(Boolean))]
    : [];
  await db.from('conversations').update({ cw_labels: list }).eq('id', conv.id);
  return J({ payload: list });
}

async function assign(db: Db, acct: string, conv: Row, body: Row) {
  const patch: Row = {};
  if ('team_id' in body) {
    const tid = Number(body.team_id);
    if (!tid) patch.assigned_team_id = null;
    else {
      let { data: t } = await db
        .from('teams')
        .select('id')
        .eq('account_id', acct)
        .eq('cw_id', tid)
        .maybeSingle();
      if (!t && tid <= 9) {
        // The bot's settings use small team codes: 2 = sales team, anything else = support
        // (operations, admin or other). Resolve them to the first team of that kind.
        const kinds = tid === 2 ? ['sales'] : ['operations', 'admin', 'other'];
        const { data: byKind } = await db
          .from('teams')
          .select('id, kind')
          .eq('account_id', acct)
          .in('kind', kinds)
          .order('created_at', { ascending: true });
        t = (byKind ?? [])[0] ?? null;
      }
      if (!t) return bad('team not found', 404);
      patch.assigned_team_id = (t as Row).id;
    }
  }
  if ('assignee_id' in body) {
    const mid = Number(body.assignee_id);
    if (!mid) patch.assigned_member_id = null;
    else {
      const { data: m } = await db
        .from('team_members')
        .select('id, team_id')
        .eq('account_id', acct)
        .eq('cw_id', mid)
        .maybeSingle();
      if (!m) return bad('agent not found', 404);
      patch.assigned_member_id = (m as Row).id;
      patch.bot_locked = false;
      if (!('team_id' in body)) patch.assigned_team_id = (m as Row).team_id;
    }
  }
  if (Object.keys(patch).length) {
    await db.from('conversations').update(patch).eq('id', conv.id);
  }
  const { data: fresh } = await db
    .from('conversations')
    .select('*')
    .eq('id', conv.id)
    .single();
  const [out] = await conversationsOut(db, [fresh as Row]);
  return J(out.meta.assignee ?? { id: null });
}

async function mergeAttrs(
  db: Db,
  table: 'conversations' | 'contacts',
  row: Row,
  incoming: unknown
) {
  const merged = {
    ...(row.cw_attrs ?? {}),
    ...(incoming && typeof incoming === 'object' ? (incoming as Row) : {}),
  };
  await db.from(table).update({ cw_attrs: merged }).eq('id', row.id);
  return merged;
}

export async function handleCw(
  request: Request,
  segments: string[]
): Promise<Response> {
  try {
    const method = request.method.toUpperCase();
    // expect: api / v1 / accounts / {n} / ...rest
    const rest = segments.slice(4);
    const head = rest[0] ?? '';
    const scope: ApiScope =
      head === 'conversations' && rest[2] === 'messages' && method !== 'GET'
        ? 'messages:send'
        : method === 'GET'
          ? 'conversations:read'
          : 'conversations:write';
    const ctx = await requireApiKey(request, scope);
    const db = ctx.supabase;
    const acct = ctx.accountId;
    const url = new URL(request.url);
    let body: Row = {};
    if (method !== 'GET') {
      body = ((await request.json().catch(() => ({}))) as Row) ?? {};
    }

    // ---- agents / teams ----
    if (head === 'agents' && method === 'GET') {
      const { data } = await db
        .from('team_members')
        .select('*')
        .eq('account_id', acct);
      return J(
        (data ?? []).map((m: Row) => ({
          id: Number(m.cw_id),
          name: m.name,
          email: null,
          role: 'agent',
          availability_status: 'offline',
          confirmed: true,
        }))
      );
    }
    if (head === 'teams' && method === 'GET') {
      const { data } = await db.from('teams').select('*').eq('account_id', acct);
      return J(
        (data ?? []).map((t: Row) => ({ id: Number(t.cw_id), name: t.name }))
      );
    }

    // ---- contacts ----
    if (head === 'contacts') {
      if (rest[1] === 'search' && method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim();
        const digits = q.replace(/[^0-9]/g, '');
        let query = db
          .from('contacts')
          .select('*')
          .eq('account_id', acct)
          .limit(15);
        if (digits.length >= 6) query = query.ilike('phone', `%${digits}%`);
        else if (q) query = query.ilike('name', `%${q}%`);
        const { data } = await query;
        return J({
          payload: (data ?? []).map((c: Row) => contactOut(c)),
          meta: { count: (data ?? []).length },
        });
      }
      const contact = rest[1] ? await findContact(db, acct, rest[1]) : null;
      if (!contact) return bad('contact not found', 404);
      if (rest.length === 2 && method === 'GET')
        return J({ payload: contactOut(contact) });
      if (rest.length === 2 && (method === 'PUT' || method === 'PATCH')) {
        const upd: Row = {};
        if (typeof body.name === 'string' && body.name) upd.name = body.name;
        if (Object.keys(upd).length)
          await db.from('contacts').update(upd).eq('id', contact.id);
        if (body.custom_attributes)
          await mergeAttrs(db, 'contacts', contact, body.custom_attributes);
        const fresh = await findContact(db, acct, String(contact.id));
        return J({ payload: contactOut(fresh as Row) });
      }
      if (rest[2] === 'conversations' && method === 'GET') {
        const { data } = await db
          .from('conversations')
          .select('*')
          .eq('account_id', acct)
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false });
        return J({ payload: await conversationsOut(db, (data ?? []) as Row[]) });
      }
      if (rest[2] === 'notes' && method === 'POST') {
        const userId = await resolveAuditUserId(db, acct);
        const { data, error } = await db
          .from('contact_notes')
          .insert({
            contact_id: contact.id,
            user_id: userId,
            note_text: String(body.content ?? ''),
          })
          .select('*')
          .single();
        if (error) return bad(error.message, 500);
        return J({
          id: hashId((data as Row).id),
          content: String(body.content ?? ''),
        });
      }
      return bad('unsupported contacts call', 404);
    }

    // ---- conversations ----
    if (head === 'conversations') {
      if (rest[1] === 'filter' && method === 'POST') {
        const rules = Array.isArray(body.payload) ? (body.payload as Row[]) : [];
        let query = db
          .from('conversations')
          .select('*')
          .eq('account_id', acct)
          .limit(100);
        for (const r of rules) {
          if (
            r.attribute_key === 'labels' &&
            Array.isArray(r.values) &&
            r.values.length
          ) {
            query = query.overlaps('cw_labels', r.values.map(String));
          }
          if (
            r.attribute_key === 'status' &&
            Array.isArray(r.values) &&
            r.values.length
          ) {
            const st = r.values
              .map((v: string) => STATUS_IN[String(v)])
              .filter(Boolean);
            if (st.length) query = query.in('status', st);
          }
        }
        const { data } = await query;
        const payload = await conversationsOut(db, (data ?? []) as Row[]);
        return J({ payload, meta: { count: payload.length } });
      }
      const conv = rest[1] ? await findConversation(db, acct, rest[1]) : null;
      if (!conv) return bad('conversation not found', 404);
      const sub = rest[2] ?? '';

      if (!sub && method === 'GET') {
        const [out] = await conversationsOut(db, [conv]);
        return J(out);
      }
      if (sub === 'messages' && method === 'GET') {
        return J({ payload: await messagesFor(db, conv), meta: {} });
      }
      if (sub === 'messages' && method === 'POST')
        return postMessage(db, acct, conv, body);
      if (sub === 'toggle_status' && method === 'POST') {
        const st = STATUS_IN[String(body.status ?? 'open')] ?? 'open';
        await db
          .from('conversations')
          .update({
            status: st,
            closed_at: st === 'closed' ? new Date().toISOString() : null,
          })
          .eq('id', conv.id);
        return J({
          payload: { success: true, current_status: STATUS_OUT[st] },
        });
      }
      if (sub === 'toggle_priority' && method === 'POST') {
        const p = body.priority ? String(body.priority) : null;
        await db.from('conversations').update({ cw_priority: p }).eq('id', conv.id);
        return J({ payload: { success: true } });
      }
      if (sub === 'labels' && method === 'GET')
        return J({ payload: conv.cw_labels ?? [] });
      if (sub === 'labels' && method === 'POST')
        return setLabels(db, conv, body.labels);
      if (sub === 'assignments' && method === 'POST')
        return assign(db, acct, conv, body);
      if (sub === 'custom_attributes' && method === 'POST') {
        const merged = await mergeAttrs(
          db,
          'conversations',
          conv,
          body.custom_attributes
        );
        return J({ custom_attributes: merged });
      }
      return bad('unsupported conversations call', 404);
    }

    return bad('unsupported call', 404);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
