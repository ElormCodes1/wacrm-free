/**
 * A counting semaphore — the smallest thing that stops background work
 * from starving the request path.
 *
 * The webhook route acks Evolution immediately and does the real work in
 * `after()`, with no limit on how much of it runs at once. That is fine
 * until traffic is steady: one Node process serves both ingestion and
 * every page render, so unbounded ingestion wins and ordinary requests
 * queue behind it. In production that presented as the whole site
 * answering 504 at the proxy's 30s timeout while the app was perfectly
 * healthy and busy — the same webhook work measured 608ms per event under
 * light load and 1393ms (p90 2610ms) during the outage. Not a broken
 * route: a contended process.
 *
 * A limit does not make the work faster. It makes it *bounded*, so there
 * is always CPU left to answer a request, and ingestion degrades into a
 * queue instead of degrading the entire site.
 *
 * Deliberately not a work-dropping queue. Everything that enters is
 * eventually run: a dropped WhatsApp message is invisible and permanent,
 * which is the failure mode this system has already paid for once.
 * Backpressure here is *waiting*, never discarding.
 */
export class Semaphore {
  /** Slots currently held. */
  private active = 0
  /** Callers parked until a slot is handed over, in arrival order. */
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be a positive integer, got ${limit}`)
    }
  }

  /** Slots in use right now. */
  get inUse(): number {
    return this.active
  }

  /**
   * How many callers are parked. Worth logging when it grows: a queue
   * that keeps climbing means arrivals outpace processing, which no
   * concurrency limit can fix and somebody needs to know about.
   */
  get queued(): number {
    return this.waiting.length
  }

  /**
   * Run `fn` once a slot is free, releasing it afterwards.
   *
   * The slot is released even when `fn` throws — a handler that fails
   * must not permanently consume capacity, which would turn one bad
   * event into a slow leak that ends in total stall.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    // Parked. The slot is transferred directly on release, so `active`
    // is already accounted for by the time this resolves.
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve)
    })
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next) {
      // Hand the slot straight to the next caller rather than
      // decrementing and re-incrementing. Doing it in two steps opens a
      // window where a new arrival sees a free slot and jumps the queue,
      // which under sustained load starves whoever waited longest.
      next()
      return
    }
    this.active -= 1
  }
}
