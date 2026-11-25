'use client';

import { FIELD_KINDS, type FieldDraft, type FieldKind } from '@/lib/custom-fields/kinds';
import type { TeamKind } from '@/types';

const INPUT =
  'w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50';

/** Edits what kind of field this is and, for a list, what the choices are. */
export function FieldTypeEditor({
  draft,
  onChange,
}: {
  draft: FieldDraft;
  onChange: (next: FieldDraft) => void;
}) {
  const help = FIELD_KINDS.find((k) => k.value === draft.kind)?.help;
  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">
        What people fill in
        <select
          className={`${INPUT} mt-1`}
          value={draft.kind}
          onChange={(e) => onChange({ ...draft, kind: e.target.value as FieldKind })}
        >
          {FIELD_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}

      {draft.kind === 'select' && (
        <label className="block text-xs text-muted-foreground">
          Choices, one per line
          <textarea
            className={`${INPUT} mt-1 min-h-24`}
            value={draft.optionsText}
            onChange={(e) => onChange({ ...draft, optionsText: e.target.value })}
            placeholder={'Unpaid\nPart paid\nPaid'}
          />
        </label>
      )}

      {(draft.kind === 'select' || draft.kind === 'service') && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={draft.allowOther}
            onChange={(e) => onChange({ ...draft, allowOther: e.target.checked })}
          />
          Allow an &ldquo;Other&rdquo; choice that lets people type their own value
        </label>
      )}

      {draft.kind === 'team_member' && (
        <label className="block text-xs text-muted-foreground">
          Only people from
          <select
            className={`${INPUT} mt-1`}
            value={draft.teamKind}
            onChange={(e) => onChange({ ...draft, teamKind: e.target.value as TeamKind | '' })}
          >
            <option value="">Every team</option>
            <option value="sales">Sales teams</option>
            <option value="operations">Operations teams</option>
            <option value="admin">Admin teams</option>
            <option value="other">Other teams</option>
          </select>
        </label>
      )}
    </div>
  );
}
