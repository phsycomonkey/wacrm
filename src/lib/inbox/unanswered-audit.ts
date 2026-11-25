import { supabaseAdmin } from '@/lib/automations/admin-client'

/** Minutes a client's last message may sit without a reply before staff are alerted. */
export const UNANSWERED_AFTER_MINUTES = 10

interface Candidate {
  id: string
  account_id: string
  contact_id: string
  assigned_agent_id: string | null
  last_message_at: string
  contact: { name: string | null; phone: string | null } | null
}

/**
 * Audit for chats left hanging. Looks at open conversations whose latest
 * message is from the client, older than UNANSWERED_AFTER_MINUTES, still
 * inside the 24-hour reply window, and not alerted for yet. For each it
 * notifies the assigned agent, or every owner and admin when nobody owns the
 * chat, then stamps the conversation so the alert is sent once per message.
 * Meant to run on the existing one-minute cron; it is cheap when idle.
 */
export async function alertUnansweredConversations(): Promise<{ alerted: number }> {
  const admin = supabaseAdmin()
  const now = Date.now()
  const olderThan = new Date(now - UNANSWERED_AFTER_MINUTES * 60_000).toISOString()
  const newerThan = new Date(now - 24 * 3_600_000).toISOString()

  const { data, error } = await admin
    .from('conversations')
    .select('id, account_id, contact_id, assigned_agent_id, last_message_at, unanswered_alerted_at, contact:contacts(name, phone)')
    .neq('status', 'closed')
    .lt('last_message_at', olderThan)
    .gt('last_message_at', newerThan)
    .order('last_message_at', { ascending: true })
    .limit(50)
  if (error || !data) return { alerted: 0 }

  let alerted = 0
  for (const row of data as unknown as (Candidate & { unanswered_alerted_at: string | null })[]) {
    if (row.unanswered_alerted_at && row.unanswered_alerted_at >= row.last_message_at) continue

    const { data: last } = await admin
      .from('messages')
      .select('direction')
      .eq('conversation_id', row.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!last || last.direction !== 'inbound') continue

    let recipients: string[] = row.assigned_agent_id ? [row.assigned_agent_id] : []
    if (recipients.length === 0) {
      const { data: admins } = await admin
        .from('profiles')
        .select('user_id')
        .eq('account_id', row.account_id)
        .in('account_role', ['owner', 'admin'])
      recipients = (admins ?? []).map((a: { user_id: string }) => a.user_id)
    }

    const who = row.contact?.name || row.contact?.phone || 'A client'
    const minutes = Math.max(1, Math.round((now - new Date(row.last_message_at).getTime()) / 60_000))
    if (recipients.length > 0) {
      await admin.from('notifications').insert(
        recipients.map((user_id) => ({
          account_id: row.account_id,
          user_id,
          type: 'conversation_unanswered',
          conversation_id: row.id,
          contact_id: row.contact_id,
          title: `No reply yet: ${who}`,
          body: `Waiting ${minutes} minutes. Reply before the 24-hour window closes.`,
        })),
      )
    }
    await admin
      .from('conversations')
      .update({ unanswered_alerted_at: new Date().toISOString() })
      .eq('id', row.id)
    alerted++
  }
  return { alerted }
}
