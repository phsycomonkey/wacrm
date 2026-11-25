'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import type { Service } from '@/types';

import { SettingsPanelHead } from './settings-panel-head';

const INPUT =
  'h-9 rounded-lg border border-border bg-muted px-3 text-sm outline-none focus:border-primary/50 disabled:opacity-70';

/**
 * Settings, Services. Define each thing you sell once, with its price. The
 * Service field on a contact, and anywhere else a service is chosen, lists
 * exactly what is defined here, so nobody types a service name by hand.
 */
export function ServicesSettings() {
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');
  const [services, setServices] = useState<Service[] | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient().from('services').select('*').order('name');
    setServices((data as Service[] | null) ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accountId) void load();
  }, [accountId, load]);

  async function add() {
    const n = name.trim();
    if (!n || !accountId) return;
    if (services?.some((s) => s.name.toLowerCase() === n.toLowerCase())) {
      toast.error(`"${n}" already exists.`);
      return;
    }
    const p = price.trim() === '' ? null : Number(price);
    if (p !== null && (Number.isNaN(p) || p < 0)) {
      toast.error('Price must be a number.');
      return;
    }
    setBusy(true);
    const { error } = await createClient()
      .from('services')
      .insert({ account_id: accountId, name: n, price: p, currency });
    setBusy(false);
    if (error) {
      toast.error('Could not add the service.');
      return;
    }
    setName('');
    setPrice('');
    await load();
  }

  async function toggle(s: Service) {
    setServices((cur) => cur?.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)) ?? null);
    const { error } = await createClient().from('services').update({ active: !s.active }).eq('id', s.id);
    if (error) {
      toast.error('Could not change the service.');
      await load();
    }
  }

  async function remove(s: Service) {
    if (!window.confirm(`Delete "${s.name}"? Contacts that already have it keep the name as text.`)) return;
    const { error } = await createClient().from('services').delete().eq('id', s.id);
    if (error) {
      toast.error('Could not delete the service.');
      return;
    }
    await load();
  }

  if (services === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading services…
      </div>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title="Services"
        description="Define each service you sell, with its price, once. Wherever a service is chosen, the list comes from here. Hide a service you no longer sell instead of deleting it."
      />
      {canEdit && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">Add a service</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_6rem_auto]">
            <input
              className={INPUT}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              placeholder="e.g. Silver package"
              aria-label="Service name"
            />
            <input
              className={INPUT}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="Price"
              aria-label="Service price"
            />
            <select className={INPUT} value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
              <option value="KES">KES</option>
              <option value="USD">USD</option>
            </select>
            <Button onClick={() => void add()} disabled={busy || !name.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </div>
      )}
      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No services yet. Add your packages, such as Silver, Gold, Platinum, CV revamp and LinkedIn revamp.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className={s.active ? 'font-medium text-foreground' : 'font-medium text-muted-foreground line-through'}>
                {s.name}
              </span>
              <span className="text-muted-foreground">
                {s.price != null ? `${s.currency} ${Number(s.price).toLocaleString()}` : 'No price'}
              </span>
              {!s.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Hidden</span>}
              {canEdit && (
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void toggle(s)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {s.active ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(s)}
                    aria-label={`Delete ${s.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
