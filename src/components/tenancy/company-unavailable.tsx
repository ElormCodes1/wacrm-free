import { Building2, Ban, UserX } from 'lucide-react';

/**
 * What an address shows when it cannot lead anywhere useful.
 *
 * Deliberately a complete, composed page rather than an error boundary or
 * a redirect to a generic 404. A half-rendered dashboard or a bare stack
 * trace reads as "the app is down", which sends the person to support;
 * this reads as "you typed the wrong thing" or "your company's access has
 * stopped", which sends them to the right place.
 */
export function CompanyUnavailable({
  kind,
  slug,
  name,
}: {
  kind: 'unknown' | 'suspended' | 'deactivated';
  slug: string;
  name?: string;
}) {
  const copy = {
    unknown: {
      icon: Building2,
      title: 'No company at this address',
      body: (
        <>
          Nothing is registered at <code className="font-mono">/{slug}</code>. Check the
          spelling — addresses are usually a company&apos;s name in lowercase, with
          hyphens instead of spaces.
        </>
      ),
    },
    suspended: {
      icon: Ban,
      title: `${name ?? 'This company'} is suspended`,
      body: (
        <>
          Access to <code className="font-mono">/{slug}</code> has been paused. Your
          company&apos;s administrator or account manager can tell you why and restore it.
        </>
      ),
    },
    deactivated: {
      icon: UserX,
      title: 'Your access has been turned off',
      body: (
        <>
          Your account is no longer active for this company. An administrator can
          restore it.
        </>
      ),
    },
  }[kind];

  const Icon = copy.icon;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full">
          <Icon className="text-muted-foreground h-6 w-6" />
        </div>
        <h1 className="text-foreground mt-4 text-xl font-semibold">{copy.title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{copy.body}</p>
      </div>
    </main>
  );
}
