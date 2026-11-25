-- CWB: give the contact fields real types so people pick instead of type, and seed the services
-- from the prices already in the approved templates. Idempotent: it only touches the fields named
-- below and never overwrites a service that already exists.

UPDATE public.custom_fields SET field_type = 'team_member', field_options = '{"team_kind": "sales"}'::jsonb
  WHERE field_name = 'Assigned Sales Rep' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'team_member', field_options = '{"team_kind": "operations"}'::jsonb
  WHERE field_name = 'Ops Owner' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'date', field_options = NULL
  WHERE field_name = 'Consultation Date' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'yes_no', field_options = NULL
  WHERE field_name = 'CV Received' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'select', field_options = '{"options": ["KES", "USD"], "allow_other": false}'::jsonb
  WHERE field_name = 'Currency' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'select', field_options = '{"options": ["Unpaid", "Part paid", "Paid"], "allow_other": false}'::jsonb
  WHERE field_name = 'Payment Status' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'select',
    field_options = '{"options": ["WhatsApp message", "Website form", "Referral", "LinkedIn", "Instagram", "Facebook"], "allow_other": true}'::jsonb
  WHERE field_name = 'Lead Source' AND field_type = 'text';
UPDATE public.custom_fields SET field_type = 'service', field_options = '{"allow_other": true}'::jsonb
  WHERE field_name = 'Service Package' AND field_type = 'text';

-- Handoff notes belong in the contact's Notes (the Handoff label), not in a field.
DELETE FROM public.custom_fields WHERE field_name = 'Handoff Note';

INSERT INTO public.services (account_id, name, price, currency)
SELECT a.id, v.name, v.price, v.currency
FROM public.accounts a
CROSS JOIN (VALUES
  ('Silver package (KES)', 10500, 'KES'),
  ('Gold package (KES)', 18000, 'KES'),
  ('Platinum package (KES)', 28000, 'KES'),
  ('Silver package (USD)', 100, 'USD'),
  ('Gold package (USD)', 200, 'USD'),
  ('Platinum package (USD)', 280, 'USD'),
  ('CV revamp (KES)', 3000, 'KES'),
  ('CV revamp (USD)', 30, 'USD'),
  ('LinkedIn revamp (KES)', 3000, 'KES')
) AS v(name, price, currency)
ON CONFLICT (account_id, name) DO NOTHING;
