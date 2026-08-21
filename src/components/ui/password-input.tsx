'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A password field that can be unmasked.
 *
 * Typing a password you cannot see is a guess you only find out about
 * after the form rejects it — worst on signup, where the penalty is
 * having set an account password you cannot reproduce, and on phones,
 * where autocorrect and a cramped keyboard make a mistyped character the
 * normal case rather than the unlucky one.
 *
 * Deliberately NOT a persisted preference. The field starts masked every
 * time: the whole point of masking is the person standing behind you, and
 * a toggle that remembered "shown" would quietly defeat it on the next
 * screen the user did not expect it on.
 */
export function PasswordInput({
  className,
  id,
  /** Labels the toggle for screen readers, e.g. "Confirm password". */
  fieldLabel = 'password',
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'> & { fieldLabel?: string }) {
  const [shown, setShown] = useState(false);
  // A stable id so the toggle can point at its own field when the caller
  // did not supply one.
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        type={shown ? 'text' : 'password'}
        // Room for the button, so a long password never runs underneath it.
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        // Never a submit: inside a form, a bare <button> submits it, so
        // revealing the password would post half-filled credentials.
        onClick={() => setShown((s) => !s)}
        // The control is decoration for anyone using a screen reader —
        // they are not reading the dots — but it must not be a mystery
        // either, hence a label rather than aria-hidden.
        aria-label={`${shown ? 'Hide' : 'Show'} ${fieldLabel}`}
        aria-pressed={shown}
        aria-controls={inputId}
        // -1: tabbing through a sign-in form should go password → submit,
        // not password → eye → submit. The toggle is reachable by pointer
        // and by shift-tab, without sitting in the path of every sign-in.
        tabIndex={-1}
        className={cn(
          'text-muted-foreground hover:text-foreground absolute top-1/2 right-0 flex h-9 w-10',
          '-translate-y-1/2 items-center justify-center rounded-md transition-colors',
          'focus-visible:ring-primary/20 focus-visible:ring-2 focus-visible:outline-none',
          // Disabled fields should not offer to reveal anything.
          props.disabled && 'pointer-events-none opacity-50',
        )}
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
