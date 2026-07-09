"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Task } from "@/types";
import { TaskForm, type TaskFormDefaults } from "@/components/tasks/task-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  CheckSquare,
  Loader2,
  Plus,
  Calendar,
  User as UserIcon,
  MessageSquare,
  Handshake,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { toast } from "sonner";

// Sort helper for the "To do" list: overdue first, then soonest due,
// then tasks with no due date last.
function compareTodo(a: Task, b: Task): number {
  if (a.due_date && b.due_date) {
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  }
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return 0;
}

function assigneeLabel(t: Task): string | null {
  if (!t.assignee) return null;
  return t.assignee.full_name || t.assignee.email || null;
}

function contactLabel(t: Task): string | null {
  if (!t.contact) return null;
  return t.contact.name || t.contact.phone || null;
}

export function TasksClient({ initial }: { initial: Task[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId } = useAuth();

  // Seeded from the server so the first paint shows the tasks; the mount
  // load() refreshes.
  const [tasks, setTasks] = useState<Task[] | null>(initial);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [createDefaults, setCreateDefaults] = useState<TaskFormDefaults>({});

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("tasks")
      .select(
        "*, contact:contacts(id,name,phone), assignee:profiles!tasks_assigned_to_fkey(id,full_name,email), deal:deals(id,title)",
      )
      .eq("account_id", accountId)
      .order("status")
      .order("due_date", { nullsFirst: false });
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setError(null);
    setTasks((data ?? []) as unknown as Task[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Auto-open the New Task dialog when arriving with `?new=1`, pre-filled
  // with any conversation / contact / deal params (create-from-chat).
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(null);
    setCreateDefaults({
      conversationId: searchParams.get("conversation"),
      contactId: searchParams.get("contact"),
      dealId: searchParams.get("deal"),
    });
    setFormOpen(true);
  }, [searchParams]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setCreateDefaults({});
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((task: Task) => {
    setEditing(task);
    setFormOpen(true);
  }, []);

  // Toggle a task's completion, optimistically.
  const toggleComplete = useCallback(
    async (task: Task) => {
      const done = task.status === "done";
      const nextStatus: Task["status"] = done ? "pending" : "done";
      const completedAt = done ? null : new Date().toISOString();
      setTasks(
        (prev) =>
          prev?.map((t) =>
            t.id === task.id
              ? { ...t, status: nextStatus, completed_at: completedAt }
              : t,
          ) ?? prev,
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("tasks")
        .update({ status: nextStatus, completed_at: completedAt })
        .eq("id", task.id);
      if (updateErr) {
        toast.error("Failed to update task");
        load();
      }
    },
    [load],
  );

  const { todo, done } = useMemo(() => {
    const list = tasks ?? [];
    const todoList = list
      .filter((t) => t.status === "pending")
      .slice()
      .sort(compareTodo);
    const doneList = list
      .filter((t) => t.status === "done")
      .slice()
      .sort((a, b) => {
        const at = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bt = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return bt - at;
      });
    return { todo: todoList, done: doneList };
  }, [tasks]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (tasks === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const isEmpty = todo.length === 0 && done.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow-ups and to-dos for your team, linked to contacts and deals.
          </p>
        </div>
        <Button
          size="sm"
          onClick={openCreate}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New task
        </Button>
      </div>

      {isEmpty ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <CheckSquare className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No tasks yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a task to track a follow-up with a contact or deal.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              To do{todo.length > 0 && ` · ${todo.length}`}
            </h2>
            {todo.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
                Nothing to do. Nice.
              </p>
            ) : (
              <ul className="space-y-2">
                {todo.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={toggleComplete}
                    onEdit={openEdit}
                    onOpenContact={(convId) =>
                      router.push(`/inbox?c=${convId}`)
                    }
                  />
                ))}
              </ul>
            )}
          </section>

          {done.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Done · {done.length}
              </h2>
              <ul className="space-y-2">
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={toggleComplete}
                    onEdit={openEdit}
                    onOpenContact={(convId) =>
                      router.push(`/inbox?c=${convId}`)
                    }
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        task={editing}
        defaults={createDefaults}
        onSaved={load}
      />
    </div>
  );
}

interface TaskRowProps {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onOpenContact: (conversationId: string) => void;
}

function TaskRow({ task, onToggle, onEdit, onOpenContact }: TaskRowProps) {
  const done = task.status === "done";
  const assignee = assigneeLabel(task);
  const contact = contactLabel(task);
  const overdue =
    !done &&
    !!task.due_date &&
    isPast(new Date(task.due_date)) &&
    !isToday(new Date(task.due_date));

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onEdit(task)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEdit(task);
          }
        }}
        className={cn(
          "flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors",
          done
            ? "border-border bg-card/50 hover:border-border/70"
            : "border-border bg-card hover:border-border/70",
        )}
      >
        <div
          className="pt-0.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={done}
            onCheckedChange={() => onToggle(task)}
            aria-label={done ? "Mark as not done" : "Mark as done"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "text-sm font-medium",
                done
                  ? "text-muted-foreground line-through"
                  : "text-foreground",
              )}
            >
              {task.title}
            </span>
            {task.due_date && (
              <span
                className={cn(
                  "flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                  overdue
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Calendar className="h-3 w-3" />
                {format(new Date(task.due_date), "MMM d, p")}
              </span>
            )}
          </div>

          {task.notes && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {task.notes}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {assignee && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <span
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold uppercase text-primary"
                  aria-hidden
                >
                  {assignee.charAt(0)}
                </span>
                {assignee}
              </span>
            )}
            {!assignee && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <UserIcon className="h-3 w-3" />
                Unassigned
              </span>
            )}
            {contact && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (task.conversation_id) {
                    onOpenContact(task.conversation_id);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary",
                  task.conversation_id
                    ? "cursor-pointer hover:bg-primary/20"
                    : "cursor-default",
                )}
              >
                <MessageSquare className="h-3 w-3" />
                {contact}
              </button>
            )}
            {task.deal && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <Handshake className="h-3 w-3" />
                {task.deal.title}
              </span>
            )}
          </div>
        </div>

        {/* Explicit complete / reopen action on the row itself. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task);
          }}
          title={done ? "Mark as not done" : "Mark as done"}
          className={cn(
            "flex shrink-0 items-center gap-1 self-center rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
            done
              ? "border border-border text-muted-foreground hover:bg-muted"
              : "bg-primary/10 text-primary hover:bg-primary/20",
          )}
        >
          {done ? (
            <RotateCcw className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">{done ? "Reopen" : "Done"}</span>
        </button>
      </div>
    </li>
  );
}
