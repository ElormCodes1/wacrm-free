'use client';

import { useState } from 'react';
import { ArrowRight, ArrowLeft, AlertTriangle, Check } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCompanyPath } from '@/components/tenancy/company-link';
import { GUIDE_STEPS } from '@/lib/onboarding/steps';

interface WelcomeGuideProps {
  open: boolean;
  /** Finished the tour — distinct from dismissing it. */
  onComplete: () => void;
  /** Closed it early. Recorded separately so it does not nag. */
  onSkip: () => void;
}

/**
 * The welcome walkthrough.
 *
 * A new workspace opens on a dashboard of zeroes with fourteen items in
 * the sidebar, none of which do anything until a WhatsApp number is
 * linked — a dependency nothing on screen mentions.
 *
 * A stepped dialog rather than spotlights over the real UI: the sidebar
 * those spotlights would point at is hidden on mobile, so half the
 * audience would get a tour of empty space. This reads the same
 * everywhere and can be reopened later.
 *
 * Skipping is a first-class outcome. Someone who wants to look around on
 * their own should be able to leave immediately, and be able to come back
 * without being pestered in between.
 */
export function WelcomeGuide({ open, onComplete, onSkip }: WelcomeGuideProps) {
  const [index, setIndex] = useState(0);
  const companyPath = useCompanyPath();

  const step = GUIDE_STEPS[index];
  const isLast = index === GUIDE_STEPS.length - 1;

  function next() {
    if (isLast) {
      onComplete();
      return;
    }
    setIndex((i) => i + 1);
  }

  return (
    <Dialog
      open={open}
      // Closing by any route — Escape, the X, clicking away — counts as
      // skipping. Treating only the explicit button as a skip would leave
      // the guide reopening forever for anyone who pressed Escape.
      onOpenChange={(next) => {
        if (!next) onSkip();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {step.body}
          </DialogDescription>
        </DialogHeader>

        {step.warning && (
          <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
              {step.warning}
            </p>
          </div>
        )}

        {step.route && step.action && (
          <a
            href={companyPath(step.route)}
            className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm font-medium"
          >
            {step.action}
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          {/* Progress dots: cheap orientation, and they make it obvious the
              tour is short — the main reason people abandon one. */}
          <div className="flex items-center gap-1.5">
            {GUIDE_STEPS.map((s, i) => (
              <span
                key={s.id}
                aria-hidden
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'bg-primary w-4' : 'bg-muted-foreground/30 w-1.5'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIndex((i) => i - 1)}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {!isLast && (
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Skip
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isLast ? (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Done
                </>
              ) : (
                'Next'
              )}
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground text-center text-xs">
          Step {index + 1} of {GUIDE_STEPS.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}
