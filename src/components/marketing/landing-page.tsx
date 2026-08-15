import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCheck,
  CheckCircle2,
  CircleDashed,
  FileText,
  Inbox,
  Kanban,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Megaphone,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Play,
  QrCode,
  Radio,
  Search,
  SendHorizontal,
  Server,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Smile,
  Users,
  UsersRound,
  Workflow,
  Zap,
} from 'lucide-react';

import { BrandLogo } from '@/components/layout/brand-logo';
import { formatMinor } from '@/lib/billing/money';
import type { PublicPlan } from '@/lib/billing/public-plans';
import { ModeToggle } from '@/components/layout/mode-toggle';

/**
 * The public landing page.
 *
 * Every claim here is one the product can actually keep. That is a real
 * constraint rather than a stylistic preference: this page is the thing a
 * customer reads before they hand their WhatsApp number to us, so an
 * exaggeration here becomes a support conversation later. There are no
 * invented customer counts, no testimonials, no pricing, and no logos of
 * companies who have never heard of us — where a number would normally go,
 * there is a fact instead.
 *
 * It renders entirely on the server. A marketing page that ships a
 * megabyte of JavaScript to describe a fast product argues against itself,
 * and nothing here needs to react to anything: the only interactive
 * elements are links.
 */

const REPO_URL = 'https://github.com/ElormCodes1/wacrm-free';

/**
 * lucide-react dropped its brand icons, so the GitHub mark is inline.
 * Fifteen lines of path data beats a dependency for one glyph.
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: Inbox,
    title: 'Shared team inbox',
    body: 'Every conversation from every number in one place. Replies, media, voice notes, documents and group chats — with the sender named, so a group does not read as a wall of phone numbers.',
  },
  {
    icon: Users,
    title: 'Contacts that remember',
    body: 'Tags, notes and custom fields attached to the person, not the thread. Search across everything you have ever been sent.',
  },
  {
    icon: ListChecks,
    title: 'Sales pipelines',
    body: 'Move a chat onto a board and work it like a deal. Stages, owners and value, kept next to the conversation that produced it.',
  },
  {
    icon: Megaphone,
    title: 'Broadcasts',
    body: 'Send to a segment and watch delivery land in real time — as individual messages from your own number, not a visible group.',
  },
  {
    icon: Zap,
    title: 'Automations',
    body: 'Trigger on a keyword, a new contact or a stage change. Tag, assign, reply or hand off, without writing anything.',
  },
  {
    icon: Workflow,
    title: 'Flows',
    body: 'Build a multi-step conversation — a qualifying set of questions, a booking, an order — that runs itself and drops the result into the inbox.',
  },
  {
    icon: Bot,
    title: 'AI replies and agents',
    body: 'Draft answers from your own history, or let an agent handle first contact and step aside the moment a human takes over.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles and an audit trail',
    body: 'Owners, admins and agents see different things. Who changed what is recorded, because a shared inbox without accountability is just a shared password.',
  },
];

export function LandingPage({ plans = [] }: { plans?: PublicPlan[] }) {
  // No plans configured means no pricing anywhere on the page — not an
  // empty section with a heading over nothing, and not a "Pricing" link
  // that scrolls to a blank. This is the state the app ships in.
  const hasPricing = plans.length > 0;

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* ---------- header ---------- */}
      <header className="border-border/60 bg-background/80 sticky top-0 z-50 border-b backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandLogo className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight whitespace-nowrap">WaCRM</span>
          </Link>

          {/* lg, not md: at exactly 768px these four links plus the logo and
              the two buttons overlap — the wordmark and "Features" collide
              and the buttons wrap onto two lines. */}
          <div className="text-muted-foreground hidden items-center gap-6 text-sm whitespace-nowrap lg:flex">
            <a href="#features" className="hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#how" className="hover:text-foreground transition-colors">
              How it connects
            </a>
            {hasPricing && (
              <a href="#pricing" className="hover:text-foreground transition-colors">
                Pricing
              </a>
            )}
            <a href="#self-host" className="hover:text-foreground transition-colors">
              Self-hosting
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <GithubMark className="h-4 w-4" />
              GitHub
            </a>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* The same toggle the app uses, so the choice someone makes
                here is the one they still have after signing in — it is
                stored per device, not per page. */}
            <ModeToggle />
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ---------- hero ---------- */}
        <section className="relative overflow-hidden">
          {/* Soft brand glow. Pointer-events-none so it can never eat a click. */}
          <div
            aria-hidden
            className="bg-primary/20 pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[52rem] -translate-x-1/2 rounded-full blur-[120px]"
          />

          <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 md:pt-28 md:pb-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
                <span className="bg-primary h-1.5 w-1.5 rounded-full" />
                Open source · Self-hostable
              </span>

              <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl">
                Your team&apos;s WhatsApp,
                <br />
                run like a real CRM.
              </h1>

              <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty">
                A shared inbox across every number you own — with contacts, pipelines,
                broadcasts and automations built around it. Your customers keep messaging
                the WhatsApp they already use. Your team stops working out of one
                phone.
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold transition-colors"
                >
                  Create your company
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="border-border bg-card hover:bg-card-2 inline-flex h-11 items-center justify-center rounded-lg border px-6 text-sm font-semibold transition-colors"
                >
                  Sign in
                </Link>
              </div>

              <p className="text-muted-foreground mt-5 text-sm">
                Pair a normal WhatsApp number by QR code, the same way WhatsApp Web
                does. No Meta Business API application, no per-conversation fees.
              </p>
            </div>

            {/* ---------- product glimpse ---------- */}
            <InboxPreview />
          </div>
        </section>

        {/* ---------- differentiators ---------- */}
        <section id="how" className="border-border/60 border-t">
          <div className="mx-auto grid max-w-6xl gap-px px-5 py-16 md:grid-cols-3 md:py-20">
            <Pillar
              icon={QrCode}
              title="Your own numbers"
              body="Connect the number your customers already have, by scanning a QR code. Add as many as you run — a sales line, a support line, a second branch — and work them from one inbox."
            />
            <Pillar
              icon={Server}
              title="Your own data"
              body="Conversations and contacts live in a Postgres database you control, behind row-level security. Nothing about your customers is ours to sell, mine or lose."
            />
            <Pillar
              icon={ShieldCheck}
              title="Your own address"
              body="Every company gets a permanent address of its own, with your name and logo on the sign-in page — so staff can tell whose system they are signing into before they type a password."
            />
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section id="features" className="border-border/60 border-t">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
                Everything a CRM does, without leaving the app your customers use.
              </h2>
              <p className="text-muted-foreground mt-4 text-lg text-pretty">
                WhatsApp is where the conversation happens. The rest of the work —
                following up, assigning, segmenting, reporting — usually happens
                somewhere else, badly. This puts it in the same place.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="border-border bg-card hover:border-primary/40 rounded-xl border p-5 transition-colors"
                >
                  <div className="bg-primary-soft text-primary flex h-9 w-9 items-center justify-center rounded-lg">
                    <f.icon className="h-4.5 w-4.5" />
                  </div>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {f.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- the address ---------- */}
        <section className="border-border/60 border-t">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-2 md:py-24">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
                An address you can print.
              </h2>
              <p className="text-muted-foreground mt-4 text-lg text-pretty">
                Your company gets its own permanent address, taken from your name. It
                goes on the sign-in page your staff use, and it never changes — so it
                is safe to put on a card, a poster or a training document.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  'Your name and logo appear before anyone signs in.',
                  'Issued once and permanent — no broken links later.',
                  'Staff who mistype another company’s address simply land on yours.',
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <CheckCircle2 className="text-primary mt-0.5 h-4.5 w-4.5 shrink-0" />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-border bg-card rounded-xl border p-6">
              <div className="border-border bg-background flex items-center gap-2 rounded-lg border px-3 py-2.5">
                <div className="flex gap-1.5">
                  <span className="bg-muted-foreground/30 h-2.5 w-2.5 rounded-full" />
                  <span className="bg-muted-foreground/30 h-2.5 w-2.5 rounded-full" />
                  <span className="bg-muted-foreground/30 h-2.5 w-2.5 rounded-full" />
                </div>
                <div className="text-muted-foreground ml-2 truncate font-mono text-xs">
                  app.example.com<span className="text-primary">/your-company</span>
                </div>
              </div>

              <div className="mt-6 flex flex-col items-center py-6 text-center">
                <div className="bg-primary-soft text-primary flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold">
                  YC
                </div>
                <p className="mt-3 font-semibold">Your Company</p>
                <p className="text-muted-foreground mt-1 text-sm">Sign in to your account</p>
                <div className="border-border mt-5 w-full max-w-56 space-y-2">
                  <div className="border-border bg-background h-9 rounded-md border" />
                  <div className="border-border bg-background h-9 rounded-md border" />
                  <div className="bg-primary h-9 rounded-md" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- pricing ---------- */}
        {hasPricing && <Pricing plans={plans} />}

        {/* ---------- self-hosting ---------- */}
        <section id="self-host" className="border-border/60 border-t">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
            <div className="border-border bg-card rounded-2xl border p-8 md:p-12">
              <div className="grid items-center gap-8 md:grid-cols-2">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-balance md:text-3xl">
                    Or run the whole thing yourself.
                  </h2>
                  <p className="text-muted-foreground mt-4 text-pretty">
                    WaCRM is open source and built to be self-hosted: Next.js and
                    Supabase, with a WhatsApp gateway you run on your own server. Point
                    it at your own database and it is entirely yours — no seats to buy,
                    and nobody able to switch it off.
                  </p>
                  <p className="text-muted-foreground mt-4 text-sm">
                    The hosted version is the same software, kept up to date and backed
                    up, for people who would rather not run it.
                  </p>
                  <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="border-border bg-background hover:bg-card-2 mt-6 inline-flex h-10 items-center gap-2 rounded-lg border px-5 text-sm font-semibold transition-colors"
                  >
                    <GithubMark className="h-4 w-4" />
                    View the source
                  </a>
                </div>

                <div className="border-border bg-background overflow-x-auto rounded-xl border p-5 font-mono text-xs">
                  <p className="text-muted-foreground"># bring up the stack</p>
                  <p className="mt-2 whitespace-nowrap">
                    <span className="text-primary">$</span> git clone {REPO_URL}.git
                  </p>
                  <p className="mt-1 whitespace-nowrap">
                    <span className="text-primary">$</span> docker compose up -d
                  </p>
                  <p className="text-muted-foreground mt-3"># then scan the QR code</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- closing ---------- */}
        <section className="border-border/60 border-t">
          <div className="mx-auto max-w-3xl px-5 py-20 text-center md:py-28">
            <h2 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
              Stop running the business from one phone.
            </h2>
            <p className="text-muted-foreground mt-4 text-lg text-pretty">
              Create your company, scan a QR code, and your existing conversations are
              in a shared inbox in minutes.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold transition-colors"
              >
                Create your company
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="border-border bg-card hover:bg-card-2 inline-flex h-11 items-center justify-center rounded-lg border px-6 text-sm font-semibold transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm sm:flex-row">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-6 w-6" />
            <span className="text-foreground font-medium">WaCRM</span>
            <span>— a WhatsApp CRM you can own.</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <GithubMark className="h-4 w-4" />
              Source
            </a>
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">
              Get started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Pillar({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof QrCode;
  title: string;
  body: string;
}) {
  return (
    <div className="px-0 py-6 md:px-8 md:py-0">
      <div className="bg-primary-soft text-primary flex h-10 w-10 items-center justify-center rounded-lg">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">{body}</p>
    </div>
  );
}

/**
 * A still of the inbox.
 *
 * Deliberately drawn rather than screenshotted. A screenshot would either
 * show a real customer's messages or go stale the first time the UI moves;
 * this stays honest about being an illustration, and the names are
 * obviously fictional for the same reason.
 *
 * It does have to be ACCURATE though — an illustration simpler than the
 * product undersells it, and one showing things the product cannot do is a
 * lie. So everything below is something actually built: the four panes,
 * the real sidebar items in their real order, the real filter chips
 * (All/Unread/Open/Closed/Groups), and message kinds the inbox genuinely
 * renders — text, voice notes, documents, reply quotes, @mentions,
 * reactions and delivery receipts.
 *
 * Panes drop away as the screen narrows, in the same order the app drops
 * them: contact panel below xl, sidebar below lg, thread below sm.
 */

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: Inbox, label: 'Inbox', active: true, badge: 7 },
  { icon: ListTodo, label: 'Tasks' },
  { icon: Users, label: 'Contacts' },
  { icon: Kanban, label: 'Pipelines' },
  { icon: Megaphone, label: 'Broadcasts' },
  { icon: Radio, label: 'Channels' },
  { icon: UsersRound, label: 'Communities' },
  { icon: ShoppingBag, label: 'Store' },
  { icon: CircleDashed, label: 'Status' },
  { icon: Zap, label: 'Automations' },
  { icon: Workflow, label: 'Flows' },
  { icon: Bot, label: 'AI Agents' },
  { icon: Settings, label: 'Settings' },
];

const THREADS = [
  { name: 'Ama Boateng', last: 'Please do 👍', time: '2m', unread: 2, active: true, tint: 'bg-[#7C6BF2]' },
  { name: 'Kwesi Mensah', last: '🎤 Voice note · 0:14', time: '11m', unread: 0, tint: 'bg-[#E0803C]' },
  { name: 'Wholesale Buyers', last: 'Yaw: sending the list now', time: '1h', unread: 5, tint: 'bg-[#3C8CE0]' },
  { name: 'Adjoa Nyarko', last: '📄 invoice-4417.pdf', time: '3h', unread: 0, tint: 'bg-[#C74B8B]' },
  { name: 'Kofi Asante', last: 'You: Delivered on Friday', time: '5h', unread: 0, tint: 'bg-[#2FA36B]' },
];

const FILTER_CHIPS = ['All', 'Unread', 'Open', 'Closed', 'Groups'];

function InboxPreview() {
  return (
    <div className="border-border bg-card mx-auto mt-16 overflow-hidden rounded-xl border shadow-2xl">
      {/* window chrome */}
      <div className="border-border bg-card-2 flex items-center gap-2 border-b px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </div>
        <span className="text-muted-foreground ml-2 truncate font-mono text-[11px]">
          app.example.com/your-company/inbox
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,13.5rem)_1fr] lg:grid-cols-[9.5rem_minmax(0,13.5rem)_1fr] xl:grid-cols-[10.5rem_minmax(0,14rem)_1fr_12.5rem]">
        {/* ---------- sidebar ---------- */}
        <div className="border-border bg-card-2 hidden flex-col border-r py-2 lg:flex">
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`mx-2 flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[11px] ${
                item.active ? 'bg-primary-soft text-primary font-medium' : 'text-muted-foreground'
              }`}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.badge ? (
                <span className="bg-primary text-primary-foreground ml-auto rounded-full px-1.5 text-[9px] font-semibold">
                  {item.badge}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {/* ---------- conversation list ---------- */}
        <div className="border-border flex min-w-0 flex-col border-r">
          <div className="border-border space-y-2 border-b px-3 py-2.5">
            <div className="border-border bg-background text-muted-foreground flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px]">
              <Search className="h-3 w-3 shrink-0" />
              <span className="truncate">Search conversations...</span>
            </div>
            <div className="flex gap-1">
              {FILTER_CHIPS.map((chip, i) => (
                <span
                  key={chip}
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] ${
                    i === 0
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <div className="divide-border divide-y">
            {THREADS.map((t, i) => (
              <div
                key={t.name}
                // The tail of the list is dropped on a phone so the stacked
                // thread below stays above the fold rather than being
                // pushed off it.
                className={`items-center gap-2.5 px-3 py-2.5 ${i >= 3 ? 'hidden sm:flex' : 'flex'} ${
                  t.active ? 'bg-primary-soft' : ''
                }`}
              >
                <div
                  className={`${t.tint} flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white`}
                >
                  {t.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[11.5px] font-medium">{t.name}</p>
                    <span className="text-muted-foreground shrink-0 text-[9px]">{t.time}</span>
                  </div>
                  <p className="text-muted-foreground truncate text-[10.5px]">{t.last}</p>
                </div>
                {t.unread > 0 && (
                  <span className="bg-primary text-primary-foreground flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-semibold">
                    {t.unread}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ---------- thread ----------
            Shown on a phone too, stacked under the list. Hiding it below sm
            left the mobile hero looking like a plain chat list, which is
            the one impression this illustration exists to prevent — and a
            phone is what most visitors arrive on. */}
        <div className="border-border flex min-w-0 flex-col border-t sm:border-t-0">
          <div className="border-border flex items-center gap-2.5 border-b px-4 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7C6BF2] text-[10px] font-semibold text-white">
              A
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">Ama Boateng</p>
              <p className="text-muted-foreground truncate text-[10px]">
                +233 24 ••• 118 · Sales line
              </p>
            </div>
            <span className="bg-primary-soft text-primary hidden shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium md:inline">
              Assigned · Yaw
            </span>
            <Phone className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <MoreVertical className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          </div>

          <div className="flex flex-1 flex-col justify-end gap-2 px-4 py-3">
            {/* The opening exchange fills the taller desktop pane; on a
                phone it would only push the interesting messages — the
                voice note, the mention, the document — off the screen. */}
            <div className="hidden justify-center sm:flex">
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[9px]">
                Today
              </span>
            </div>

            <div className="hidden sm:contents">
              <Bubble side="in">Good morning — do you still have the ceramic set?</Bubble>
              <Bubble side="out" time="11:52">
                Morning! Yes, in blue and cream.
              </Bubble>
            </div>

            <Bubble side="in">Is the blue one still available?</Bubble>

            <Bubble side="out" time="12:01">
              Yes — two left. Want me to hold one for you?
            </Bubble>

            {/* voice note */}
            <Bubble side="in">
              <span className="flex items-center gap-2">
                <Play className="h-3.5 w-3.5 shrink-0" />
                <span className="flex items-end gap-[2px]">
                  {[6, 10, 4, 12, 8, 14, 5, 9, 3, 11, 7, 4].map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h}px` }}
                      className="bg-muted-foreground/60 w-[2px] rounded-full"
                    />
                  ))}
                </span>
                <span className="text-[10px] opacity-70">0:14</span>
              </span>
            </Bubble>

            {/* a reply quote, and an @mention that resolves to a teammate */}
            <Bubble side="out" time="12:04">
              <span className="border-primary-foreground/40 mb-1 block border-l-2 pl-2 text-[10px] opacity-80">
                Is the blue one still available?
              </span>
              Holding it now —{' '}
              <span className="bg-primary-foreground/20 rounded px-1 font-medium">@Kwesi</span> will
              package it.
            </Bubble>

            {/* document */}
            <Bubble side="in">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 opacity-70" />
                <span className="min-w-0">
                  <span className="block truncate text-[11px]">receipt-0912.pdf</span>
                  <span className="text-[9px] opacity-60">PDF · 84 KB</span>
                </span>
              </span>
            </Bubble>

            <div className="flex justify-start">
              <span className="border-border bg-card-2 -mt-1 rounded-full border px-1.5 py-0.5 text-[10px]">
                👍 1
              </span>
            </div>
          </div>

          <div className="border-border flex items-center gap-2 border-t px-4 py-2.5">
            <Paperclip className="text-muted-foreground h-4 w-4 shrink-0" />
            <Smile className="text-muted-foreground hidden h-4 w-4 shrink-0 md:block" />
            <div className="border-border bg-background text-muted-foreground min-w-0 flex-1 truncate rounded-full border px-3 py-1.5 text-[11px]">
              Type a message…
            </div>
            <Mic className="text-muted-foreground h-4 w-4 shrink-0" />
            <span className="bg-primary text-primary-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
              <SendHorizontal className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        {/* ---------- contact panel ---------- */}
        <div className="border-border hidden flex-col gap-3.5 border-l px-3 py-4 xl:flex">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#7C6BF2] text-sm font-semibold text-white">
              A
            </div>
            <p className="mt-2 text-[11.5px] font-medium">Ama Boateng</p>
            <p className="text-muted-foreground text-[10px]">+233 24 ••• 118</p>
          </div>

          <PanelSection title="Tags">
            <div className="flex flex-wrap gap-1">
              {['returning', 'accra', 'wholesale'].map((tag) => (
                <span
                  key={tag}
                  className="bg-primary-soft text-primary rounded-full px-1.5 py-0.5 text-[9px]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </PanelSection>

          <PanelSection title="Deal">
            <div className="border-border bg-card-2 rounded-md border px-2 py-1.5">
              <p className="text-[10.5px] font-medium">Bulk order — 40 units</p>
              <p className="text-muted-foreground mt-0.5 text-[9px]">Negotiation · GHS 4,800</p>
            </div>
          </PanelSection>

          <PanelSection title="Notes">
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              Prefers delivery on Fridays. Pays on collection.
            </p>
          </PanelSection>
        </div>
      </div>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-[9px] font-semibold tracking-wider uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

/** One message. Passing `time` adds the timestamp and read receipt. */
function Bubble({
  side,
  time,
  children,
}: {
  side: 'in' | 'out';
  time?: string;
  children: ReactNode;
}) {
  const outbound = side === 'out';
  return (
    <div
      className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-[11.5px] leading-snug ${
        outbound
          ? 'bg-primary text-primary-foreground self-end rounded-br-sm'
          : 'bg-muted self-start rounded-bl-sm'
      }`}
    >
      {children}
      {time && (
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[9px] opacity-70">
          {time}
          <CheckCheck className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

/**
 * Pricing, straight from the plans in the console.
 *
 * The cards say a name, a price and whatever description was written for
 * that plan — and nothing else. The obvious thing to add is a tick-list
 * of features per tier, and the reason there isn't one is that the
 * product has no per-plan feature data: any list here would be invented
 * by whoever built the page, printed in front of the people it makes
 * promises to. When the tiers really do differ, that belongs in the
 * plan's description where the business writes it.
 *
 * Each card carries its plan through to signup, so choosing here means
 * arriving there with it already selected.
 */
function Pricing({ plans }: { plans: PublicPlan[] }) {
  return (
    <section id="pricing" className="border-border/60 border-t">
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
            Pricing
          </h2>
          <p className="text-muted-foreground mt-4 text-lg text-pretty">
            One price per company, whatever the size of your team. Connect as many of your own
            numbers as you run.
          </p>
        </div>

        <div
          className={`mx-auto mt-12 grid gap-6 ${
            plans.length === 1
              ? 'max-w-sm'
              : plans.length === 2
                ? 'max-w-3xl sm:grid-cols-2'
                : 'sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-xl border p-6 ${
                plan.highlight
                  ? 'border-primary bg-card ring-primary/20 ring-1'
                  : 'border-border bg-card'
              }`}
            >
              {plan.highlight && (
                <span className="bg-primary text-primary-foreground absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-semibold">
                  Recommended
                </span>
              )}

              <h3 className="font-semibold">{plan.name}</h3>

              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight tabular-nums">
                  {formatMinor(plan.amountMinor, plan.currency)}
                </span>
                <span className="text-muted-foreground text-sm">
                  /{plan.interval === 'year' ? 'year' : 'month'}
                </span>
              </p>

              {plan.description && (
                <p className="text-muted-foreground mt-4 text-sm leading-relaxed text-pretty">
                  {plan.description}
                </p>
              )}

              <Link
                href={`/signup?plan=${plan.id}`}
                className={`mt-6 inline-flex h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                    : 'border-border bg-background hover:bg-card-2 border'
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground mt-8 text-center text-sm">
          No card required to start — you will be invoiced. Or{' '}
          <a href="#self-host" className="text-foreground underline underline-offset-4">
            run it yourself
          </a>{' '}
          for nothing.
        </p>
      </div>
    </section>
  );
}
