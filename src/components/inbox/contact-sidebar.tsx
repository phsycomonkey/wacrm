"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { canSendMessages } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag, CustomField, FollowUp } from "@/types";
import {
  Phone,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  ListChecks,
  ChevronDown,
  CalendarClock,
  CheckCircle2,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { getDateLocale } from "@/i18n/date-locale";
import { contactHandle } from "@/lib/whatsapp/wa-identity";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { planCustomValueWrites } from "@/lib/contacts/custom-value-writes";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Width/border overrides, used when the panel is shown as a phone sheet. */
  className?: string;
}

export function ContactSidebar({ contact, className }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const dateLocale = getDateLocale(useLocale());
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId, accountRole } = useAuth();
  const canManageContactTags = accountRole ? canSendMessages(accountRole) : false;
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // Inline-editable contact details and custom field values. Saved on blur so
  // an agent never has to leave the chat to fix a name or set a field.
  const [details, setDetails] = useState({ name: "", email: "", company: "" });
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  // Custom fields start collapsed so the panel stays short; the header shows
  // how many are filled in.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [noteKind, setNoteKind] = useState<"note" | "handoff">("note");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [fuOpen, setFuOpen] = useState(false);
  const [fuWhen, setFuWhen] = useState("");
  const [fuNote, setFuNote] = useState("");

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes, allTagsRes, fieldsRes, valuesRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("tags").select("*").order("name"),
      supabase.from("custom_fields").select("*").order("field_name"),
      supabase
        .from("contact_custom_values")
        .select("custom_field_id, value")
        .eq("contact_id", contact.id),
    ]);

    const [fuRes, profRes] = await Promise.all([
      supabase
        .from("follow_ups")
        .select("*")
        .eq("contact_id", contact.id)
        .is("done_at", null)
        .order("due_at"),
      supabase.from("profiles").select("user_id, full_name"),
    ]);
    if (fuRes.data) setFollowUps(fuRes.data as FollowUp[]);
    if (profRes.data) {
      const map: Record<string, string> = {};
      for (const row of profRes.data as { user_id: string; full_name: string | null }[]) {
        if (row.full_name) map[row.user_id] = row.full_name;
      }
      setAuthors(map);
    }

    setDetails({
      name: contact.name ?? "",
      email: contact.email ?? "",
      company: contact.company ?? "",
    });
    if (fieldsRes.data) setCustomFields(fieldsRes.data as CustomField[]);
    if (valuesRes.data) {
      const next: Record<string, string> = {};
      for (const row of valuesRes.data as { custom_field_id: string; value: string | null }[]) {
        next[row.custom_field_id] = row.value ?? "";
      }
      setCustomValues(next);
    }

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data as Tag[]);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // Optimistic: the chip appears or disappears at once and the request runs in
  // the background. Only a failure reverts it, so adding several tags in a row
  // never waits on a full reload.
  const handleToggleTag = useCallback(async (tagId: string) => {
    if (!contact) return;
    const assignedTag = tags.find((tag) => tag.id === tagId);
    const previous = tags;
    if (assignedTag) {
      setTags((cur) => cur.filter((tag) => tag.id !== tagId));
    } else {
      const full = allTags.find((tag) => tag.id === tagId);
      if (full) setTags((cur) => [...cur, { ...full, contact_tag_id: `pending-${tagId}` }]);
    }
    try {
      if (assignedTag) await deleteContactTag(contact.id, tagId);
      else await addContactTag(contact.id, tagId);
    } catch (error) {
      setTags(previous);
      console.error("Failed to update contact tags from inbox:", error);
      toast.error(
        error instanceof Error ? error.message : tSidebar("tagUpdateFailed"),
      );
    }
  }, [contact, allTags, tags, tSidebar]);

  const saveDetail = useCallback(
    async (key: "name" | "email" | "company") => {
      if (!contact || !canManageContactTags) return;
      const next = details[key].trim();
      const previous = (contact[key] ?? "").trim();
      if (next === previous) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("contacts")
        .update({ [key]: next || null, updated_at: new Date().toISOString() })
        .eq("id", contact.id);
      if (error) {
        toast.error(tSidebar("detailUpdateFailed"));
        return;
      }
      // Keep the parent's object in sync so a later blur compares correctly.
      (contact as unknown as Record<string, unknown>)[key] = next || null;
      toast.success(tSidebar("detailUpdated"));
    },
    [contact, details, canManageContactTags, tSidebar],
  );

  const saveCustomValue = useCallback(
    async (fieldId: string) => {
      if (!contact || !canManageContactTags) return;
      const supabase = createClient();
      const { upserts, clearedFieldIds } = planCustomValueWrites(contact.id, {
        [fieldId]: customValues[fieldId] ?? "",
      });
      try {
        if (upserts.length > 0) {
          const { error } = await supabase
            .from("contact_custom_values")
            .upsert(upserts, { onConflict: "contact_id,custom_field_id" });
          if (error) throw error;
        }
        if (clearedFieldIds.length > 0) {
          const { error } = await supabase
            .from("contact_custom_values")
            .delete()
            .eq("contact_id", contact.id)
            .in("custom_field_id", clearedFieldIds);
          if (error) throw error;
        }
      } catch {
        toast.error(tSidebar("fieldUpdateFailed"));
      }
    },
    [contact, customValues, canManageContactTags, tSidebar],
  );

  const addFollowUp = useCallback(async () => {
    if (!contact || !accountId || !fuWhen) return;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("follow_ups")
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        due_at: new Date(fuWhen).toISOString(),
        note: fuNote.trim() || null,
        created_by: session?.user?.id ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error("Could not save the follow-up.");
      return;
    }
    setFollowUps((cur) => [...cur, data as FollowUp].sort((a, b) => a.due_at.localeCompare(b.due_at)));
    setFuWhen("");
    setFuNote("");
    setFuOpen(false);
    toast.success("Follow-up saved.");
  }, [contact, accountId, fuWhen, fuNote]);

  const completeFollowUp = useCallback(async (id: string) => {
    setFollowUps((cur) => cur.filter((f) => f.id !== id));
    const { error } = await createClient()
      .from("follow_ups")
      .update({ done_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error("Could not mark it done.");
      fetchContactData();
    }
  }, [fetchContactData]);

  const quickWhen = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, "0");
    setFuWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`);
  };

  const handleCopyPhone = useCallback(async () => {
    // Copies whatever the row displays — a BSUID-only contact has no
    // phone number to copy, but its @username still identifies them.
    const handle = contact ? contactHandle(contact) : '';
    if (!handle) return;
    await navigator.clipboard.writeText(handle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: (noteKind === "handoff" ? "[Handoff] " : "") + newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  // Array.from splits by code point, so an emoji name does not render as a
  // broken half-surrogate ("�") the way charAt(0) would.
  const initials = (Array.from(displayName)[0] ?? "?").toUpperCase();

  return (
    <div className={cn("flex h-full w-70 flex-col border-l border-border bg-card", className)}>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              style={{ cursor: "pointer" }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">
                {contactHandle(contact)}
              </span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

          </div>

          {/* Editable details */}
          <div className="mt-2 space-y-2">
            {([
              ["name", tSidebar("namePlaceholder")],
              ["email", tSidebar("emailPlaceholder")],
              ["company", tSidebar("companyPlaceholder")],
            ] as const).map(([key, placeholder]) => (
              <input
                key={key}
                value={details[key]}
                onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
                onBlur={() => void saveDetail(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                disabled={!canManageContactTags}
                placeholder={placeholder}
                aria-label={placeholder}
                className="w-full rounded-lg border border-transparent bg-muted px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 disabled:opacity-70"
              />
            ))}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              {canManageContactTags && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    style={{ cursor: "pointer" }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {tSidebar("addTags")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 border-border bg-popover">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {tSidebar("availableTags")}
                      </DropdownMenuLabel>
                      {allTags.length === 0 ? (
                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                          {tSidebar("noAvailableTags")}
                        </DropdownMenuItem>
                      ) : (
                        allTags.map((tag) => (
                          <DropdownMenuCheckboxItem
                            key={tag.id}
                            checked={tags.some((assigned) => assigned.id === tag.id)}
                            onCheckedChange={() => void handleToggleTag(tag.id)}
                            style={{ cursor: "pointer" }}
                            className="text-sm text-popover-foreground"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="truncate">{tag.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    <span>{tag.name}</span>
                    {canManageContactTags && (
                      <button
                        type="button"
                        aria-label={tSidebar("removeTag", { tag: tag.name })}
                        title={tSidebar("removeTag", { tag: tag.name })}
                        onClick={() => void handleToggleTag(tag.id)}
                        style={{ cursor: "pointer" }}
                        className="rounded-full opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Custom fields (collapsed by default) */}
          {customFields.length > 0 && (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => setFieldsOpen((o) => !o)}
                  aria-expanded={fieldsOpen}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted"
                >
                  <ListChecks className="h-3 w-3" />
                  <span className="flex-1">
                    {tSidebar("customFields")}
                    <span className="ml-1 normal-case tracking-normal">
                      ({customFields.filter((f) => (customValues[f.id] ?? "").trim()).length}/{customFields.length} filled)
                    </span>
                  </span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", fieldsOpen && "rotate-180")} />
                </button>
                {fieldsOpen && (
                  <div className="mt-2 space-y-2">
                    {customFields.map((field) => (
                      <label key={field.id} className="block">
                        <span className="px-1 text-[10px] text-muted-foreground">
                          {field.field_name}
                        </span>
                        <input
                          value={customValues[field.id] ?? ""}
                          onChange={(e) =>
                            setCustomValues((v) => ({ ...v, [field.id]: e.target.value }))
                          }
                          onBlur={() => void saveCustomValue(field.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          disabled={!canManageContactTags}
                          className="mt-0.5 w-full rounded-lg border border-transparent bg-muted px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 disabled:opacity-70"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Follow-ups */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <CalendarClock className="h-3 w-3" />
                Follow-ups
              </div>
              {canManageContactTags && (
                <button
                  type="button"
                  onClick={() => setFuOpen((o) => !o)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              )}
            </div>
            {fuOpen && (
              <div className="mt-2 space-y-2 rounded-lg bg-muted p-2">
                <div className="flex flex-wrap gap-1">
                  {[
                    ["Tomorrow", 1],
                    ["In 3 days", 3],
                    ["Next week", 7],
                  ].map(([label, d]) => (
                    <button
                      key={label as string}
                      type="button"
                      onClick={() => quickWhen(d as number)}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="datetime-local"
                  value={fuWhen}
                  onChange={(e) => setFuWhen(e.target.value)}
                  aria-label="Follow-up date and time"
                  className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none"
                />
                <input
                  value={fuNote}
                  onChange={(e) => setFuNote(e.target.value)}
                  placeholder="What to follow up on"
                  aria-label="Follow-up note"
                  className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none"
                />
                <Button
                  size="sm"
                  className="h-7 w-full text-xs"
                  disabled={!fuWhen}
                  onClick={() => void addFollowUp()}
                >
                  Save follow-up
                </Button>
              </div>
            )}
            <div className="mt-2 space-y-1.5">
              {followUps.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nothing scheduled</p>
              ) : (
                followUps.map((f) => {
                  const overdue = new Date(f.due_at) < new Date();
                  return (
                    <div key={f.id} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-xs font-medium",
                            overdue ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {overdue ? "Overdue · " : ""}
                          {format(new Date(f.due_at), "PP HH:mm", { locale: dateLocale })}
                        </p>
                        {f.note && <p className="text-xs text-muted-foreground">{f.note}</p>}
                      </div>
                      {canManageContactTags && (
                        <button
                          type="button"
                          onClick={() => void completeFollowUp(f.id)}
                          aria-label="Mark follow-up done"
                          title="Mark done"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
              {notes.length > 0 && (
                <span className="normal-case tracking-normal">({notes.length})</span>
              )}
            </div>
            <div className="mt-2">
              <div className="mb-1 flex gap-1">
                {(["note", "handoff"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNoteKind(k)}
                    aria-pressed={noteKind === k}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px]",
                      noteKind === k
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {k === "note" ? "Note" : "Handoff note"}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                  aria-label="Add note"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {(showAllNotes ? notes : notes.slice(0, 3)).map((note) => {
                  const handoff = note.note_text.startsWith("[Handoff] ");
                  const text = handoff ? note.note_text.slice(10) : note.note_text;
                  return (
                    <div key={note.id} className="rounded-lg bg-muted px-3 py-2">
                      {handoff && (
                        <span className="mb-1 inline-block rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                          Handoff
                        </span>
                      )}
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{text}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {authors[note.user_id] ? `${authors[note.user_id]} · ` : ""}
                        {format(new Date(note.created_at), "PP HH:mm", { locale: dateLocale })}
                      </p>
                    </div>
                  );
                })}
                {notes.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllNotes((v) => !v)}
                    className="px-1 text-xs font-medium text-primary hover:underline"
                  >
                    {showAllNotes ? "Show fewer notes" : `Show earlier notes (${notes.length - 3})`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
