import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCompany } from '@/lib/tenancy/company';
import { LandingPage } from '@/components/marketing/landing-page';

const DESCRIPTION =
  'A shared WhatsApp inbox for your whole team, with contacts, sales pipelines, ' +
  'broadcasts and automations around it. Connect your own numbers by QR code — ' +
  'no Meta Business API application. Open source and self-hostable.';

/**
 * The root layout marks the entire app noindex, which is right for every
 * page behind a sign-in and wrong for exactly this one: the landing page is
 * the only thing here that is supposed to be findable. Overridden locally
 * rather than loosened globally, so a new dashboard page is still private
 * by default.
 */
export const metadata: Metadata = {
  title: { absolute: 'WaCRM — a shared WhatsApp inbox and CRM for your team' },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: {
    title: 'WaCRM — a shared WhatsApp inbox and CRM for your team',
    description: DESCRIPTION,
    type: 'website',
  },
};

/**
 * The front door.
 *
 * Until now this redirected to /dashboard, which stopped existing when the
 * dashboard moved under /[company]. The product's own root URL therefore
 * answered "No company at this address" — the worst possible first
 * impression, and invisible to us because nobody signed in ever visits it.
 *
 * What belongs here depends entirely on who is asking:
 *
 *   * Someone signed in wants their work, not a sales pitch. They go
 *     straight to their company, resolved from the SESSION like everywhere
 *     else — this page never reads a slug from the address, because there
 *     is no address to read.
 *
 *   * Everyone else is here to find out what this is, so they get the
 *     landing page.
 *
 * A suspended or deactivated company deliberately falls through to the
 * landing page rather than to an error: the explanation belongs on their
 * own company address, where the branding tells them whose system is
 * withholding it, and this page has no way to know which company they mean
 * before they sign in.
 */
export default async function RootPage() {
  const result = await getCompany();
  if (result.ok) redirect(`/${result.company.slug}`);

  return <LandingPage />;
}
