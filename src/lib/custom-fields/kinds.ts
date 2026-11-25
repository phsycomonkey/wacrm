import type { CustomField, TeamKind } from '@/types';

/**
 * Custom field kinds. A field is defined once (Settings, Fields & tags) and
 * every contact then picks from what was defined, instead of typing free text.
 *
 *  - text         free text (use sparingly)
 *  - select       pick one from a list defined on the field
 *  - service      pick one of the services defined under Settings, Services
 *  - team_member  pick a person defined under Settings, Teams
 *  - date         a date picker
 *  - yes_no       Yes or No
 *
 * `select` and `service` can allow an "Other" option that reveals a text box.
 * The kind lives in `custom_fields.field_type`, the details in `field_options`.
 */
export type FieldKind = 'text' | 'select' | 'service' | 'team_member' | 'date' | 'yes_no';

export const FIELD_KINDS: { value: FieldKind; label: string; help: string }[] = [
  { value: 'select', label: 'Pick from a list', help: 'You define the choices once. People pick one.' },
  { value: 'service', label: 'Pick a service', help: 'Choices come from Settings, Services.' },
  { value: 'team_member', label: 'Pick a team member', help: 'Choices come from Settings, Teams.' },
  { value: 'date', label: 'Date', help: 'A date picker.' },
  { value: 'yes_no', label: 'Yes or no', help: 'A yes or no answer.' },
  { value: 'text', label: 'Free text', help: 'Anything typed. Use only when a list does not fit.' },
];

const KINDS = new Set<string>(FIELD_KINDS.map((k) => k.value));

export function kindOf(field: Pick<CustomField, 'field_type'>): FieldKind {
  return KINDS.has(field.field_type) ? (field.field_type as FieldKind) : 'text';
}

export function optionsOf(field: Pick<CustomField, 'field_options'>): string[] {
  const raw = field.field_options?.options;
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
}

export function allowsOther(field: Pick<CustomField, 'field_options'>): boolean {
  return field.field_options?.allow_other === true;
}

export function teamKindOf(field: Pick<CustomField, 'field_options'>): TeamKind | null {
  const v = field.field_options?.team_kind;
  return v === 'sales' || v === 'operations' || v === 'admin' || v === 'other' ? v : null;
}

export interface FieldDraft {
  kind: FieldKind;
  optionsText: string;
  allowOther: boolean;
  teamKind: TeamKind | '';
}

export function draftOf(field: CustomField): FieldDraft {
  return {
    kind: kindOf(field),
    optionsText: optionsOf(field).join('\n'),
    allowOther: allowsOther(field),
    teamKind: teamKindOf(field) ?? '',
  };
}

/** The database columns for a draft. */
export function payloadOf(draft: FieldDraft): { field_type: FieldKind; field_options: Record<string, unknown> | null } {
  switch (draft.kind) {
    case 'select':
      return {
        field_type: 'select',
        field_options: {
          options: draft.optionsText.split('\n').map((o) => o.trim()).filter(Boolean),
          allow_other: draft.allowOther,
        },
      };
    case 'service':
      return { field_type: 'service', field_options: { allow_other: draft.allowOther } };
    case 'team_member':
      return { field_type: 'team_member', field_options: draft.teamKind ? { team_kind: draft.teamKind } : null };
    default:
      return { field_type: draft.kind, field_options: null };
  }
}
