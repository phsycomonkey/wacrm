'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { allowsOther, kindOf, optionsOf, teamKindOf } from '@/lib/custom-fields/kinds';
import { cn } from '@/lib/utils';
import type { CustomField, Service, Team, TeamMember } from '@/types';

export interface FieldCatalogs {
  services: Service[];
  teams: Team[];
  members: TeamMember[];
}

/** Loads the lists the typed fields pick from, once per mount. */
export function useFieldCatalogs(): FieldCatalogs {
  const [data, setData] = useState<FieldCatalogs>({ services: [], teams: [], members: [] });
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    Promise.all([
      supabase.from('services').select('*').eq('active', true).order('name'),
      supabase.from('teams').select('*').order('created_at'),
      supabase.from('team_members').select('*').order('name'),
    ]).then(([s, t, m]) => {
      if (!alive) return;
      setData({
        services: (s.data as Service[] | null) ?? [],
        teams: (t.data as Team[] | null) ?? [],
        members: (m.data as TeamMember[] | null) ?? [],
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

const BASE =
  'w-full rounded-lg border border-transparent bg-muted px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary/50 disabled:opacity-70';

const OTHER = '__other__';

/**
 * One input for one custom field, chosen by the field's kind. Lists come from
 * what was already defined, so people select instead of typing. `onCommit`
 * fires with the final value when a choice is made or a text box is left, so
 * the caller can save at once.
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  onCommit,
  catalogs,
  disabled,
  className,
}: {
  field: CustomField;
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  catalogs: FieldCatalogs;
  disabled?: boolean;
  className?: string;
}) {
  const kind = kindOf(field);
  const cls = cn(BASE, className);
  const commit = (v: string) => {
    onChange(v);
    onCommit?.(v);
  };

  if (kind === 'date') {
    return (
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => commit(e.target.value)}
        className={cls}
        aria-label={field.field_name}
      />
    );
  }

  if (kind === 'yes_no') {
    return (
      <select value={value} disabled={disabled} onChange={(e) => commit(e.target.value)} className={cls} aria-label={field.field_name}>
        <option value="">Not set</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }

  if (kind === 'team_member') {
    const wanted = teamKindOf(field);
    const teams = catalogs.teams.filter((t) => !wanted || t.kind === wanted);
    const known = catalogs.members.some((m) => m.id === value);
    return (
      <select value={value} disabled={disabled} onChange={(e) => commit(e.target.value)} className={cls} aria-label={field.field_name}>
        <option value="">Not set</option>
        {teams.map((t) => {
          const people = catalogs.members.filter((m) => m.team_id === t.id);
          if (people.length === 0) return null;
          return (
            <optgroup key={t.id} label={t.name}>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          );
        })}
        {value && !known && <option value={value}>(removed person)</option>}
      </select>
    );
  }

  // select and service share the same shape: a list, optionally with Other.
  const items =
    kind === 'service'
      ? catalogs.services.map((s) => ({
          value: s.name,
          label: s.price != null ? `${s.name} (${s.currency} ${Number(s.price).toLocaleString()})` : s.name,
        }))
      : optionsOf(field).map((o) => ({ value: o, label: o }));
  const other = allowsOther(field);

  if (kind === 'text') {
    return (
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className={cls}
        aria-label={field.field_name}
      />
    );
  }

  return <ListWithOther field={field} value={value} items={items} other={other} disabled={disabled} cls={cls} onChange={onChange} commit={commit} onCommit={onCommit} />;
}

function ListWithOther({
  field,
  value,
  items,
  other,
  disabled,
  cls,
  onChange,
  commit,
  onCommit,
}: {
  field: CustomField;
  value: string;
  items: { value: string; label: string }[];
  other: boolean;
  disabled?: boolean;
  cls: string;
  onChange: (v: string) => void;
  commit: (v: string) => void;
  onCommit?: (v: string) => void;
}) {
  const [otherMode, setOtherMode] = useState(false);
  const inList = items.some((i) => i.value === value);
  const showOther = other && (otherMode || (value !== '' && !inList));
  return (
    <div className="space-y-1">
      <select
        value={showOther ? OTHER : value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) {
            setOtherMode(true);
            onChange('');
          } else {
            setOtherMode(false);
            commit(v);
          }
        }}
        className={cls}
        aria-label={field.field_name}
      >
        <option value="">Not set</option>
        {items.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
        {other && <option value={OTHER}>Other…</option>}
      </select>
      {showOther && (
        <input
          value={value}
          disabled={disabled}
          placeholder="Type the other value"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={cls}
          aria-label={`${field.field_name}, other`}
        />
      )}
    </div>
  );
}
