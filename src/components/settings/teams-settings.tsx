'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, UsersRound } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import type { Team, TeamKind, TeamMember } from '@/types';

import { SettingsPanelHead } from './settings-panel-head';

const KIND_LABEL: Record<TeamKind, string> = {
  sales: 'Sales',
  operations: 'Operations',
  admin: 'Admin',
  other: 'Other',
};

const KIND_HELP: Record<TeamKind, string> = {
  sales: 'Sees sales deals and the company quotation view.',
  operations: 'Delivers the work: documents, LinkedIn, interview prep.',
  admin: 'Assigns the work and sees everything.',
  other: 'Any other group.',
};

/**
 * Settings, Teams. A team is a named group (Sales, Operations, Admin).
 * A person in a team is just a name and, optionally, a WhatsApp number so
 * the bot can message them. They do not need a login. Chats are assigned to
 * a person from the chat header; this page is where those people are defined.
 */
export function TeamsSettings() {
  const { accountId, user } = useAuth();
  const canEdit = useCan('edit-settings');

  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [newTeam, setNewTeam] = useState('');
  const [newKind, setNewKind] = useState<TeamKind>('sales');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [t, m] = await Promise.all([
      supabase.from('teams').select('*').order('created_at'),
      supabase.from('team_members').select('*').order('name'),
    ]);
    setTeams((t.data as Team[] | null) ?? []);
    setMembers((m.data as TeamMember[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accountId) void load();
  }, [accountId, load]);

  async function addTeam() {
    const name = newTeam.trim();
    if (!name || !accountId) return;
    if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`A team called "${name}" already exists.`);
      return;
    }
    setBusy(true);
    const { error } = await createClient()
      .from('teams')
      .insert({ account_id: accountId, name, kind: newKind });
    setBusy(false);
    if (error) {
      toast.error('Could not add the team.');
      return;
    }
    setNewTeam('');
    await load();
  }

  async function removeTeam(team: Team) {
    const count = members.filter((m) => m.team_id === team.id).length;
    const ok = window.confirm(
      `Delete the team "${team.name}"${count ? ` and its ${count} people` : ''}? Chats assigned to them become unassigned.`,
    );
    if (!ok) return;
    const { error } = await createClient().from('teams').delete().eq('id', team.id);
    if (error) {
      toast.error('Could not delete the team.');
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading teams…
      </div>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title="Teams"
        description="Define your teams and the people in them. A person does not need a login: a name is enough, and a WhatsApp number lets the bot message them. Chats are assigned to these people from the chat header."
      />

      {canEdit && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">Add a team</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addTeam()}
              placeholder="e.g. Sales"
              aria-label="Team name"
              className="h-9 flex-1 rounded-lg border border-border bg-muted px-3 text-sm outline-none focus:border-primary/50"
            />
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as TeamKind)}
              aria-label="Team type"
              className="h-9 rounded-lg border border-border bg-muted px-2 text-sm outline-none"
            >
              {(Object.keys(KIND_LABEL) as TeamKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <Button onClick={() => void addTeam()} disabled={busy || !newTeam.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add team
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{KIND_HELP[newKind]}</p>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <UsersRound className="mx-auto mb-2 h-6 w-6" />
          No teams yet. Start with Sales, Operations and Admin.
        </div>
      ) : (
        teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            members={members.filter((m) => m.team_id === team.id)}
            canEdit={canEdit}
            accountId={accountId!}
            currentUserId={user?.id ?? null}
            onChanged={load}
            onDelete={() => void removeTeam(team)}
          />
        ))
      )}
    </section>
  );
}

function TeamCard({
  team,
  members,
  canEdit,
  accountId,
  currentUserId,
  onChanged,
  onDelete,
}: {
  team: Team;
  members: TeamMember[];
  canEdit: boolean;
  accountId: string;
  currentUserId: string | null;
  onChanged: () => Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function addMember() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    const { error } = await createClient().from('team_members').insert({
      account_id: accountId,
      team_id: team.id,
      name: n,
      phone: phone.trim() || null,
      role_label: label.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error('Could not add the person.');
      return;
    }
    setName('');
    setPhone('');
    setLabel('');
    await onChanged();
  }

  async function removeMember(m: TeamMember) {
    const { error } = await createClient().from('team_members').delete().eq('id', m.id);
    if (error) {
      toast.error('Could not remove the person.');
      return;
    }
    await onChanged();
  }

  async function linkToMe(m: TeamMember) {
    if (!currentUserId) return;
    const { error } = await createClient()
      .from('team_members')
      .update({ user_id: m.user_id ? null : currentUserId })
      .eq('id', m.id);
    if (error) {
      toast.error('Could not update the person.');
      return;
    }
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{team.name}</h3>
          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[team.kind]} · {KIND_HELP[team.kind]}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete team ${team.name}`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {members.length === 0 && (
          <li className="px-3 py-3 text-sm text-muted-foreground">No people in this team yet.</li>
        )}
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">{m.name}</span>
            {m.role_label && <span className="text-xs text-muted-foreground">{m.role_label}</span>}
            <span className="text-xs text-muted-foreground">
              {m.phone ? m.phone : 'no WhatsApp number'}
            </span>
            {m.user_id && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                has a login
              </span>
            )}
            {canEdit && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void linkToMe(m)}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {m.user_id ? 'Unlink my login' : 'This is me'}
                </button>
                <button
                  type="button"
                  onClick={() => void removeMember(m)}
                  aria-label={`Remove ${m.name}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Person name"
            className="h-9 rounded-lg border border-border bg-muted px-3 text-sm outline-none focus:border-primary/50"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="WhatsApp number (optional)"
            aria-label="Person WhatsApp number"
            className="h-9 rounded-lg border border-border bg-muted px-3 text-sm outline-none focus:border-primary/50"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Role (optional)"
            aria-label="Person role"
            className="h-9 rounded-lg border border-border bg-muted px-3 text-sm outline-none focus:border-primary/50"
          />
          <Button onClick={() => void addMember()} disabled={busy || !name.trim()} size="sm" className="h-9">
            <Plus className="mr-1 h-4 w-4" /> Add person
          </Button>
        </div>
      )}
    </div>
  );
}
