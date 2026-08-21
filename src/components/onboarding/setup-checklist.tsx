'use client';

import { useEffect, useState } from 'react';
import { Check, Circle, ArrowRight, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCompanyPath } from '@/components/tenancy/company-link';
import { setupTasks, setupProgress, type SetupState } from '@/lib/onboarding/steps';

/**
 * Setup progress, on the dashboard, for as long as it is unfinished.
 *
 * The walkthrough explains the product once; this is what remains
 * afterwards — the short list of things that actually have to happen
 * before a dashboard of zeroes turns into a working inbox.
 *
 * Every tick is derived from real rows. A checklist that completes itself
 * because somebody read a slide is decoration, and worse than none: it
 * reports done while the workspace still does nothing.
 *
 * It disappears on its own once everything is ticked. Nobody needs a
 * permanent monument to having finished setup.
 */
export function SetupChecklist() {
  const [state, setState] = useState<SetupState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const companyPath = useCompanyPath();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Existence checks only — head:true asks for the count and no rows,
      // so this stays cheap on a busy account.
      const [numbers, conversations, business] = await Promise.all([
        supabase
          .from('whatsapp_config')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('is_business', true),
      ]);
      if (cancelled) return;
      setState({
        numberLinked: (numbers.count ?? 0) > 0,
        hasConversation: (conversations.count ?? 0) > 0,
        // A failed query (the column may not exist yet on an un-migrated
        // database) reads as "not done" rather than crashing the card.
        hasBusinessContact: (business.count ?? 0) > 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || dismissed) return null;

  const { done, total } = setupProgress(state);
  // Finished setups do not need a card about setup.
  if (done === total) return null;

  const tasks = setupTasks(state);

  return (
    <div className="border-border bg-card relative rounded-lg border p-5">
      <button
        onClick={() => setDismissed(true)}
        aria-label="Hide setup checklist"
        className="text-muted-foreground hover:text-foreground absolute top-4 right-4"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="font-medium">Finish setting up</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {done} of {total} done
      </p>

      <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-1.5 rounded-full transition-all"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>

      <ul className="mt-4 space-y-3">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-3">
            {task.done ? (
              <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Circle className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${
                  task.done ? 'text-muted-foreground line-through' : ''
                }`}
              >
                {task.label}
              </p>
              {/* The hint is guidance for something not yet done. Leaving
                  it under a completed row is just noise. */}
              {!task.done && task.hint && (
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {task.hint}
                </p>
              )}
            </div>
            {!task.done && (
              <a
                href={companyPath(task.route)}
                className="text-primary hover:text-primary/80 mt-0.5 shrink-0"
                aria-label={task.label}
              >
                <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
