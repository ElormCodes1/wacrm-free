"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Task, Profile } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface ContactOption {
  id: string;
  name: string | null;
  phone: string;
}

interface DealOption {
  id: string;
  title: string;
}

/** Defaults used when creating a task from another surface (e.g. a chat). */
export interface TaskFormDefaults {
  conversationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the form edits this task; otherwise it creates a new one. */
  task?: Task | null;
  defaults?: TaskFormDefaults;
  onSaved: () => void;
}

// Convert a stored ISO timestamp into the `YYYY-MM-DDTHH:mm` shape a
// datetime-local input expects, in the viewer's local timezone.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskForm({
  open,
  onOpenChange,
  task,
  defaults,
  onSaved,
}: TaskFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset/populate the form every time the sheet opens or its inputs
  // change. Prop-driven sync — the lint rule is over-cautious here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? "");
      setDueDate(isoToLocalInput(task.due_date));
      setAssignedTo(task.assigned_to ?? "");
      setContactId(task.contact_id ?? "");
      setDealId(task.deal_id ?? "");
      setConversationId(task.conversation_id ?? null);
    } else {
      setTitle("");
      setNotes("");
      setDueDate("");
      setAssignedTo("");
      setContactId(defaults?.contactId ?? "");
      setDealId(defaults?.dealId ?? "");
      setConversationId(defaults?.conversationId ?? null);
    }
  }, [open, task, defaults]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // When creating a task for a contact, default the deal to that contact's
  // deal (the oldest, if they have several) — the user can still change it.
  // No deals for the contact → leave it on "No deal". Edit mode keeps the
  // task's saved deal untouched.
  useEffect(() => {
    if (!open || task || !contactId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("deals")
        .select("id")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (cancelled) return;
      setDealId((data?.[0]?.id as string) ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, task, supabase]);

  // Load supporting data (assignees, contacts, deals) once the sheet opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [p, c, d] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase
          .from("contacts")
          .select("id,name,phone")
          .eq("is_group", false)
          .order("name")
          .limit(500),
        supabase
          .from("deals")
          .select("id,title")
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setProfiles((p.data ?? []) as Profile[]);
      setContacts((c.data ?? []) as ContactOption[]);
      setDeals((d.data ?? []) as DealOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  async function handleSave() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      assigned_to: assignedTo || null,
      contact_id: contactId || null,
      conversation_id: conversationId || null,
      deal_id: dealId || null,
    };

    if (task) {
      const { error } = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", task.id);
      if (error) {
        toast.error("Failed to save task");
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error("Not signed in");
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error("Your profile is not linked to an account.");
        setSaving(false);
        return;
      }
      const { error } = await supabase.from("tasks").insert({
        ...payload,
        user_id: user.id,
        account_id: accountId,
        status: "pending",
      });
      if (error) {
        toast.error("Failed to create task");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(task ? "Task updated" : "Task created");
    onOpenChange(false);
    onSaved();
  }

  async function handleComplete() {
    if (!task) return;
    const isDone = task.status === "done";
    setCompleting(true);
    const { error } = await supabase
      .from("tasks")
      .update({
        status: isDone ? "pending" : "done",
        completed_at: isDone ? null : new Date().toISOString(),
      })
      .eq("id", task.id);
    setCompleting(false);
    if (error) {
      toast.error("Failed to update task");
      return;
    }
    toast.success(isDone ? "Task reopened" : "Task completed");
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    setDeleting(false);
    if (error) {
      toast.error("Failed to delete task");
      return;
    }
    toast.success("Task deleted");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {task ? "Edit Task" : "New Task"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add details..."
                className="min-h-[90px] border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Due date</Label>
              <Input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Assignee</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Unassigned</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Contact</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">No contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Deal</Label>
              <select
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">No deal</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            {task && (
              <Button
                onClick={handleComplete}
                disabled={completing}
                className={
                  task.status === "done"
                    ? "mb-2 w-full border border-border bg-transparent text-muted-foreground hover:bg-muted"
                    : "mb-2 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                }
              >
                {task.status === "done" ? (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    {completing ? "Reopening..." : "Mark as not done"}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {completing ? "Completing..." : "Mark as done"}
                  </>
                )}
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Saving..." : task ? "Save Changes" : "Create Task"}
              </Button>
            </div>

            {task &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
                  <span className="text-destructive">Delete this task?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-destructive px-2 py-1 font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-destructive hover:text-destructive/80"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete Task
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
