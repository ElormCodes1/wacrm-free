import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Inbox,
  ListChecks,
  Megaphone,
  QrCode,
  Server,
  ShieldCheck,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';

import { BrandLogo } from '@/components/layout/brand-logo';

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

export function LandingPage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* ---------- header ---------- */}
      <header className="border-border/60 bg-background/80 sticky top-0 z-50 border-b backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandLogo className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight">WaCRM</span>
          </Link>

          <div className="text-muted-foreground hidden items-center gap-8 text-sm md:flex">
            <a href="#features" className="hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#how" className="hover:text-foreground transition-colors">
              How it connects
            </a>
            <a href="#self-host" className="hover:text-foreground transition-colors">
              Self-hosting
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-4 py-2 text-sm font-medium transition-colors"
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
                </div>

                <div className="border-border bg-background rounded-xl border p-5 font-mono text-xs">
                  <p className="text-muted-foreground"># bring up the stack</p>
                  <p className="mt-2">
                    <span className="text-primary">$</span> git clone wacrm-free
                  </p>
                  <p className="mt-1">
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
 * Deliberately drawn rather than screenshotted: a screenshot would either
 * show a real customer's messages or go stale the first time the UI moves,
 * and this stays honest about being an illustration. The names are
 * obviously fictional for the same reason.
 */
function InboxPreview() {
  const threads = [
    { name: 'Ama Boateng', last: 'Is the blue one still available?', time: '2m', unread: 2 },
    { name: 'Kwesi Mensah', last: 'Voice note (0:14)', time: '11m', unread: 0 },
    { name: 'Wholesale Buyers', last: 'Yaw: sending the list now', time: '1h', unread: 5 },
    { name: 'Adjoa Nyarko', last: 'Thank you! 🙏', time: '3h', unread: 0 },
  ];

  return (
    <div className="border-border bg-card mx-auto mt-16 max-w-4xl overflow-hidden rounded-xl border shadow-2xl">
      {/* window chrome */}
      <div className="border-border bg-card-2 flex items-center gap-2 border-b px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </div>
        <span className="text-muted-foreground ml-2 font-mono text-xs">Inbox</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,15rem)_1fr]">
        {/* thread list */}
        <div className="border-border divide-border divide-y border-r">
          {threads.map((t, i) => (
            <div
              key={t.name}
              className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? 'bg-primary-soft' : ''}`}
            >
              <div className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                {t.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <span className="text-muted-foreground shrink-0 text-[10px]">{t.time}</span>
                </div>
                <p className="text-muted-foreground truncate text-xs">{t.last}</p>
              </div>
              {t.unread > 0 && (
                <span className="bg-primary text-primary-foreground flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
                  {t.unread}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* conversation */}
        <div className="hidden flex-col justify-end gap-3 p-5 sm:flex">
          <div className="bg-muted max-w-[70%] self-start rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
            Is the blue one still available?
          </div>
          <div className="bg-primary text-primary-foreground max-w-[70%] self-end rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">
            Yes — two left. Want me to hold one for you?
          </div>
          <div className="bg-muted max-w-[70%] self-start rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
            Please do 👍
          </div>
          <div className="border-border mt-2 flex items-center gap-2 border-t pt-3">
            <div className="border-border bg-background text-muted-foreground flex-1 rounded-full border px-3.5 py-2 text-xs">
              Type a message…
            </div>
            <div className="bg-primary h-8 w-8 shrink-0 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
