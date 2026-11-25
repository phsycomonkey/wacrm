"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SettingsPanelHead } from "./settings-panel-head";

interface Row {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  contact_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

function sentence(r: Row, names: Record<string, string>): string {
  const d = r.detail ?? {};
  const who = (id: unknown) => (typeof id === "string" ? names[id] ?? "someone" : "nobody");
  switch (r.action) {
    case "assigned_login":
      return d.to ? `assigned the chat to ${who(d.to)}` : "removed the assignee";
    case "assigned_person":
      return d.member_to ? "assigned the chat to a team member" : "cleared the team member";
    case "status_changed":
      return `changed the chat from ${String(d.from)} to ${String(d.to)}`;
    case "ai_on":
      return "handed the chat to the AI bot";
    case "ai_off":
      return "took the chat back from the AI bot";
    case "tag_added":
      return `added the tag ${String(d.tag ?? "")}`;
    case "tag_removed":
      return `removed the tag ${String(d.tag ?? "")}`;
    case "note_added":
      return `added a note: "${String(d.text ?? "")}"`;
    case "followup_added":
      return `scheduled a follow-up${d.note ? `: ${String(d.note)}` : ""}`;
    case "followup_done":
      return "completed a follow-up";
    case "deal_created":
      return `created the deal ${String(d.title ?? "")}`;
    case "deal_moved":
      return `moved the deal ${String(d.title ?? "")} to ${String(d.stage ?? d.status ?? "")}`;
    case "contact_edited":
      return `edited ${Array.isArray(d.fields) ? (d.fields as string[]).join(", ") : "details"}`;
    default:
      return r.action.replace(/_/g, " ");
  }
}

/** Settings, Activity. A read-only record of who did what, written by the database itself. */
export function ActivityPanel() {
  const { canEditSettings, profileLoading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!canEditSettings) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("activity_log")
        .select("id, actor_user_id, actor_name, action, entity_type, contact_id, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      const list = (data as Row[] | null) ?? [];
      const ids = [...new Set(list.map((r) => r.contact_id).filter((x): x is string => !!x))];
      const [cRes, pRes] = await Promise.all([
        ids.length ? supabase.from("contacts").select("id, name, phone").in("id", ids) : Promise.resolve({ data: [] }),
        supabase.from("profiles").select("user_id, full_name"),
      ]);
      if (cancelled) return;
      const cmap: Record<string, string> = {};
      for (const c of (cRes.data as { id: string; name: string | null; phone: string | null }[]) ?? []) {
        cmap[c.id] = c.name || c.phone || "Unknown";
      }
      const nmap: Record<string, string> = {};
      for (const p of (pRes.data as { user_id: string; full_name: string | null }[]) ?? []) {
        if (p.full_name) nmap[p.user_id] = p.full_name;
      }
      setContacts(cmap);
      setNames(nmap);
      setRows(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [canEditSettings]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.actor_name ?? "system"} ${sentence(r, names)} ${r.contact_id ? contacts[r.contact_id] ?? "" : ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, filter, names, contacts]);

  if (profileLoading) return null;
  if (!canEditSettings) {
    return (
      <section className="max-w-3xl">
        <SettingsPanelHead title="Activity" description="Only the owner and admins can read the activity record." />
      </section>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title="Activity"
        description="Who did what, newest first: assignments, tags, notes, follow-ups, deals, status and AI hand-offs. The database writes this record itself, so it cannot be edited."
      />
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search by person, client or action"
        aria-label="Search activity"
        className="h-9 w-full rounded-lg border border-border bg-muted px-3 text-sm outline-none focus:border-primary/50"
      />
      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing recorded yet. New actions appear here as they happen.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-3">
              <span className="shrink-0 text-xs text-muted-foreground sm:w-36">
                {new Date(r.created_at).toLocaleString()}
              </span>
              <span className="min-w-0 flex-1 text-foreground">
                <b>{r.actor_name || (r.actor_user_id ? "Someone" : "System")}</b> {sentence(r, names)}
                {r.contact_id && contacts[r.contact_id] ? (
                  <span className="text-muted-foreground"> · {contacts[r.contact_id]}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
