'use client';

import { useState, useEffect, useCallback } from 'react';
import { CompanyLink } from '@/components/tenancy/company-link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  Pipeline,
  PipelineStage,
  Task,
} from '@/types';
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Loader2,
  ListTodo,
  Square,
  CheckSquare,
  Star,
  ArrowLeft,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { GroupInfoPanel } from './group-info-panel';
import { contactDisplayName } from '@/lib/inbox/contact-name';
import { TaskForm } from '@/components/tasks/task-form';

interface StarredMessage {
  id: string;
  content_text: string | null;
  content_type: string | null;
  created_at: string;
}

// Fallback label for a starred message with no text (media, etc.).
const MEDIA_LABELS: Record<string, string> = {
  image: '📷 Photo',
  video: '🎬 Video',
  audio: '🎤 Voice message',
  document: '📄 Document',
  location: '📍 Location',
  contact: '👤 Contact',
  poll: '📊 Poll',
  call: '📞 Call',
};
function starredLabel(m: StarredMessage): string {
  return m.content_text || MEDIA_LABELS[m.content_type ?? ''] || 'Message';
}

interface ContactSidebarProps {
  contact: Contact | null;
  /** Bubbles the resolved group subject + picture up so the thread header,
   *  list and avatar update without a reload. */
  onGroupResolved?: (update: {
    name?: string;
    avatarUrl?: string | null;
  }) => void;
  /**
   * Set when this panel is showing someone opened from inside the thread
   * (an @mention, a group member) rather than the conversation's own
   * contact. Renders a way back and a way to message them.
   */
  peeking?: boolean;
  /** Return to the conversation's own contact. */
  onClosePeek?: () => void;
  /** Open this person's 1:1 thread. */
  onMessage?: () => void;
  /** Resolving the profile — the panel is showing but has no contact yet. */
  loading?: boolean;
}

export function ContactSidebar({
  contact,
  onGroupResolved,
  peeking = false,
  onClosePeek,
  onMessage,
  loading = false,
}: ContactSidebarProps) {
  const { accountId, defaultCurrency } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [starred, setStarred] = useState<StarredMessage[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // "Add to deal" — a compact inline form to drop this contact into a
  // pipeline stage without leaving the inbox.
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [dealStages, setDealStages] = useState<PipelineStage[]>([]);
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [dealPipelineId, setDealPipelineId] = useState('');
  const [dealStageId, setDealStageId] = useState('');
  const [savingDeal, setSavingDeal] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    // Collapse the add-deal form when switching contacts.
    setShowAddDeal(false);

    const supabase = createClient();

    // Fetch deals, notes, tags, tasks, and starred messages in parallel
    const [dealsRes, notesRes, tagsRes, tasksRes, starredRes] =
      await Promise.all([
        supabase
          .from('deals')
          .select('*, stage:pipeline_stages(*)')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_notes')
          .select('*')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('contact_tags')
          .select('id, tag_id, tags(*)')
          .eq('contact_id', contact.id),
        supabase
          .from('tasks')
          .select('*')
          .eq('contact_id', contact.id)
          // pending before done ('pending' > 'done'), then soonest due first.
          .order('status', { ascending: false })
          .order('due_date', { nullsFirst: false }),
        supabase
          .from('messages')
          .select(
            'id, content_text, content_type, created_at, conversation:conversations!inner(contact_id)'
          )
          .eq('conversation.contact_id', contact.id)
          .not('starred_at', 'is', null)
          .order('starred_at', { ascending: false })
          .limit(50),
      ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);
    if (starredRes.data)
      setStarred(starredRes.data as unknown as StarredMessage[]);
    if (notesRes.data) setNotes(notesRes.data);
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

  const toggleTask = useCallback(
    async (task: Task) => {
      const done = task.status !== 'done';
      const completed_at = done ? new Date().toISOString() : null;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: done ? 'done' : 'pending', completed_at }
            : t
        )
      );
      const supabase = createClient();
      const { error } = await supabase
        .from('tasks')
        .update({ status: done ? 'done' : 'pending', completed_at })
        .eq('id', task.id);
      if (error) {
        toast.error('Failed to update task');
        fetchContactData();
      }
    },
    [fetchContactData]
  );

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
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
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const loadStages = useCallback(async (pipelineId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('pipeline_stages')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .order('position');
    return (data ?? []) as PipelineStage[];
  }, []);

  const openAddDeal = useCallback(async () => {
    if (!contact) return;
    setShowAddDeal(true);
    setDealTitle(contact.name || contact.phone || 'New deal');
    setDealValue('');
    const supabase = createClient();
    const { data } = await supabase
      .from('pipelines')
      .select('*')
      .order('created_at');
    const list = (data ?? []) as Pipeline[];
    setPipelines(list);
    const first = list[0];
    if (first) {
      setDealPipelineId(first.id);
      const stages = await loadStages(first.id);
      setDealStages(stages);
      setDealStageId(stages[0]?.id ?? '');
    } else {
      setDealPipelineId('');
      setDealStages([]);
      setDealStageId('');
    }
  }, [contact, loadStages]);

  const handlePipelineChange = useCallback(
    async (pipelineId: string) => {
      setDealPipelineId(pipelineId);
      const stages = await loadStages(pipelineId);
      setDealStages(stages);
      setDealStageId(stages[0]?.id ?? '');
    },
    [loadStages]
  );

  const handleCreateDeal = useCallback(async () => {
    if (!contact) return;
    if (!accountId) {
      toast.error('Your profile is not linked to an account.');
      return;
    }
    if (!dealPipelineId || !dealStageId || !dealTitle.trim()) {
      toast.error('Pick a pipeline and a stage.');
      return;
    }
    setSavingDeal(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error('Not signed in');
      setSavingDeal(false);
      return;
    }
    const { data, error } = await supabase
      .from('deals')
      .insert({
        title: dealTitle.trim(),
        value: parseFloat(dealValue) || 0,
        currency: defaultCurrency,
        contact_id: contact.id,
        pipeline_id: dealPipelineId,
        stage_id: dealStageId,
        user_id: user.id,
        account_id: accountId,
        status: 'open',
      })
      .select('*, stage:pipeline_stages(*)')
      .single();
    setSavingDeal(false);
    if (error || !data) {
      toast.error('Failed to add deal');
      return;
    }
    setDeals((prev) => [data as Deal, ...prev]);
    setShowAddDeal(false);
    toast.success('Added to pipeline');
  }, [
    contact,
    accountId,
    dealPipelineId,
    dealStageId,
    dealTitle,
    dealValue,
    defaultCurrency,
  ]);

  if (loading && !contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-70 items-center justify-center border-l">
        <p className="text-muted-foreground text-sm">Select a conversation</p>
      </div>
    );
  }

  const displayName = contactDisplayName(contact);
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="border-border bg-card flex h-full w-70 flex-col border-l">
      {/* Peek header. Shown only when this panel is displaying someone
          opened from inside the thread, so the agent can tell at a glance
          that the conversation behind them hasn't changed — and get back
          to it, or switch to this person's own thread. */}
      {peeking && (
        <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClosePeek}
            className="h-8 gap-1 px-2 text-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
          {onMessage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMessage}
              className="ml-auto h-8 gap-1 px-2 text-xs"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Message
            </Button>
          )}
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
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
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Groups get the Group Info panel in place of phone/tags/deals. */}
          {contact.is_group && (
            <div className="mt-4">
              <GroupInfoPanel
                groupId={contact.phone}
                groupName={displayName}
                onResolved={onGroupResolved}
              />
            </div>
          )}

          {!contact.is_group && (
            <>
              {/* Phone */}
              <div className="mt-4 space-y-2">
                <button
                  onClick={handleCopyPhone}
                  className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
                >
                  <Phone className="text-muted-foreground h-4 w-4" />
                  <span className="flex-1 text-left">{contact.phone}</span>
                  {copied ? (
                    <Check className="text-primary h-3 w-3" />
                  ) : (
                    <Copy className="text-muted-foreground h-3 w-3" />
                  )}
                </button>

                {contact.email && (
                  <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                    <Mail className="text-muted-foreground h-4 w-4" />
                    <span className="truncate">{contact.email}</span>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-border my-4 border-t" />

              {/* Tags */}
              <div>
                <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
                  <TagIcon className="h-3 w-3" />
                  Tags
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {tags.length === 0 ? (
                    <p className="text-muted-foreground px-1 text-xs">
                      No tags
                    </p>
                  ) : (
                    tags.map((tag) => (
                      <span
                        key={tag.contact_tag_id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: `${tag.color}20`,
                          color: tag.color,
                        }}
                      >
                        {tag.name}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="border-border my-4 border-t" />

              {/* Active Deals */}
              <div>
                <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
                  <DollarSign className="h-3 w-3" />
                  Active Deals
                </div>
                <div className="mt-2 space-y-2">
                  {deals.length === 0 && !showAddDeal ? (
                    <p className="text-muted-foreground px-1 text-xs">
                      No deals
                    </p>
                  ) : (
                    deals.map((deal) => (
                      <CompanyLink
                        key={deal.id}
                        to="pipelines"
                        query={{ pipeline: deal.pipeline_id, deal: deal.id }}
                        className="bg-muted hover:bg-muted/70 block rounded-lg px-3 py-2 transition-colors"
                        title="Open this deal in Pipelines"
                      >
                        <p className="text-foreground text-sm font-medium">
                          {deal.title}
                        </p>
                        <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                          <span>
                            {deal.currency ?? '$'}
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
                      </CompanyLink>
                    ))
                  )}

                  {showAddDeal ? (
                    <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-2.5">
                      {pipelines.length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                          No pipelines yet. Create one on the Pipelines page
                          first.
                        </p>
                      ) : (
                        <>
                          <input
                            value={dealTitle}
                            onChange={(e) => setDealTitle(e.target.value)}
                            placeholder="Deal title"
                            className="border-border bg-card text-foreground placeholder-muted-foreground focus:border-primary/60 w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
                          />
                          <div className="grid gap-1">
                            <label className="text-muted-foreground px-0.5 text-[10px] font-medium tracking-wider uppercase">
                              Pipeline
                            </label>
                            <select
                              value={dealPipelineId}
                              onChange={(e) =>
                                handlePipelineChange(e.target.value)
                              }
                              className="border-border bg-card text-foreground focus:border-primary/60 h-8 w-full rounded-md border px-2 text-xs outline-none"
                            >
                              {pipelines.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-1">
                            <label className="text-muted-foreground px-0.5 text-[10px] font-medium tracking-wider uppercase">
                              Stage
                            </label>
                            <select
                              value={dealStageId}
                              onChange={(e) => setDealStageId(e.target.value)}
                              className="border-border bg-card text-foreground focus:border-primary/60 h-8 w-full rounded-md border px-2 text-xs outline-none"
                            >
                              {dealStages.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="relative">
                            <DollarSign className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
                            <input
                              type="number"
                              value={dealValue}
                              onChange={(e) => setDealValue(e.target.value)}
                              placeholder="Value (optional)"
                              className="border-border bg-card text-foreground placeholder-muted-foreground focus:border-primary/60 w-full rounded-md border py-1.5 pr-2 pl-6 text-xs outline-none"
                            />
                          </div>
                        </>
                      )}
                      <div className="flex gap-2 pt-0.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-xs"
                          onClick={() => setShowAddDeal(false)}
                          disabled={savingDeal}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 flex-1 text-xs"
                          onClick={handleCreateDeal}
                          disabled={
                            savingDeal ||
                            pipelines.length === 0 ||
                            !dealPipelineId ||
                            !dealStageId
                          }
                        >
                          {savingDeal ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Save'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={openAddDeal}
                      className="border-border text-muted-foreground hover:border-primary/50 hover:text-primary flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-2 text-xs font-medium transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add to deal
                    </button>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="border-border my-4 border-t" />

              {/* Tasks */}
              <div>
                <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
                  <ListTodo className="h-3 w-3" />
                  Tasks
                </div>
                <div className="mt-2 space-y-2">
                  {tasks.length === 0 ? (
                    <p className="text-muted-foreground px-1 text-xs">
                      No tasks
                    </p>
                  ) : (
                    tasks.map((t) => {
                      const done = t.status === 'done';
                      return (
                        <div
                          key={t.id}
                          className="bg-muted flex items-start gap-2 rounded-lg px-3 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => toggleTask(t)}
                            aria-label={
                              done ? 'Mark task pending' : 'Mark task done'
                            }
                            className="text-muted-foreground hover:text-primary mt-0.5 shrink-0"
                          >
                            {done ? (
                              <CheckSquare className="text-primary h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTask(t);
                              setTaskFormOpen(true);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p
                              className={`text-sm ${
                                done
                                  ? 'text-muted-foreground line-through'
                                  : 'text-foreground'
                              }`}
                            >
                              {t.title}
                            </p>
                            {t.due_date && (
                              <p className="text-muted-foreground mt-0.5 text-[11px]">
                                {format(new Date(t.due_date), 'MMM d, HH:mm')}
                              </p>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTask(null);
                      setTaskFormOpen(true);
                    }}
                    className="border-border text-muted-foreground hover:border-primary/50 hover:text-primary flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-2 text-xs font-medium transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Add task
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="border-border my-4 border-t" />

            {/* Starred messages */}
            <div>
              <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
                <Star className="h-3 w-3" />
                Starred
              </div>
              <div className="mt-2 space-y-2">
                {starred.length === 0 ? (
                  <p className="text-muted-foreground px-1 text-xs">
                    No starred messages
                  </p>
                ) : (
                  starred.map((m) => (
                    <div key={m.id} className="bg-muted rounded-lg px-3 py-2">
                      <p className="text-foreground line-clamp-3 text-xs whitespace-pre-wrap">
                        {starredLabel(m)}
                      </p>
                      <p className="text-muted-foreground mt-1 text-[10px]">
                        {format(new Date(m.created_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <TaskForm
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        task={editingTask}
        defaults={{ contactId: contact.id }}
        onSaved={fetchContactData}
      />
    </div>
  );
}
