/**
 * Concurrency with fairness between tenants.
 *
 * A single global limit protects the process but not the customers. This
 * is multi-tenant: every account's WhatsApp events arrive at the same
 * webhook and are served by the same Node process, so a plain FIFO
 * semaphore means one busy line — a history sync, a broadcast reply
 * storm, one shop having a good day — fills every slot and every OTHER
 * account's messages wait behind it. A tenant with one message queues
 * behind a tenant with five hundred, and the tenant who notices is the
 * one who did nothing wrong.
 *
 * So two limits and a rotation:
 *
 *   global  — how much work the process will do at once. This is the
 *             number that keeps page requests answerable, and it is the
 *             one that stopped the site 504ing.
 *
 *   perKey  — how much of that any single tenant may hold. The cap on
 *             blast radius: exceed it and the rest of your burst waits
 *             while other tenants keep flowing.
 *
 *   rotation— when a slot frees, it goes to the next tenant in turn who
 *             is waiting, not to whoever queued earliest. Without this,
 *             perKey alone still lets a tenant with a deep backlog
 *             reclaim its slot instantly every time and starve everyone
 *             else in aggregate.
 *
 * Nothing is ever dropped. Backpressure is waiting, never discarding — a
 * lost WhatsApp message is invisible and permanent, and this system has
 * already paid for that once.
 */
export class FairQueue {
  private activeTotal = 0
  private readonly activeByKey = new Map<string, number>()
  /** Parked callers per key, in arrival order within that key. */
  private readonly waiting = new Map<string, Array<() => void>>()
  /** Round-robin cursor over keys that have waiters. */
  private rotation: string[] = []
  private cursor = 0

  constructor(
    private readonly global: number,
    private readonly perKey: number,
  ) {
    if (!Number.isInteger(global) || global < 1) {
      throw new Error(`FairQueue global limit must be a positive integer, got ${global}`)
    }
    if (!Number.isInteger(perKey) || perKey < 1) {
      throw new Error(`FairQueue perKey limit must be a positive integer, got ${perKey}`)
    }
  }

  /** Slots in use across all tenants. */
  get inUse(): number {
    return this.activeTotal
  }

  /** Total parked callers. Worth logging when it climbs. */
  get queued(): number {
    let n = 0
    for (const list of this.waiting.values()) n += list.length
    return n
  }

  /** How many tenants currently have work waiting. */
  get waitingKeys(): number {
    return this.waiting.size
  }

  /**
   * Run `fn` on behalf of `key`, once both limits allow it.
   *
   * The slot is released even when `fn` throws — a failing handler must
   * not permanently consume capacity, which would turn one bad event into
   * a slow leak ending in total stall.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(key)
    try {
      return await fn()
    } finally {
      this.release(key)
    }
  }

  private canAdmit(key: string): boolean {
    return (
      this.activeTotal < this.global &&
      (this.activeByKey.get(key) ?? 0) < this.perKey
    )
  }

  private take(key: string): void {
    this.activeTotal += 1
    this.activeByKey.set(key, (this.activeByKey.get(key) ?? 0) + 1)
  }

  private async acquire(key: string): Promise<void> {
    // Jumping the queue while others wait for the same key would reorder
    // one tenant's own events, so an existing queue for this key is
    // itself a reason to wait.
    if (this.canAdmit(key) && !this.waiting.has(key)) {
      this.take(key)
      return
    }
    return new Promise<void>((resolve) => {
      const list = this.waiting.get(key)
      if (list) {
        list.push(resolve)
      } else {
        this.waiting.set(key, [resolve])
        this.rotation.push(key)
      }
    })
  }

  private release(key: string): void {
    this.activeTotal -= 1
    const n = (this.activeByKey.get(key) ?? 1) - 1
    if (n > 0) this.activeByKey.set(key, n)
    else this.activeByKey.delete(key)

    // Move the rotation PAST the tenant that just finished, so the slot
    // it freed is offered to somebody else first. Without this the cursor
    // still points at that tenant, it is trivially admissible, and a
    // tenant with a deep backlog reclaims its own slot every single time
    // — perKey stays satisfied while everyone else starves, which is the
    // exact failure this class exists to prevent.
    const at = this.rotation.indexOf(key)
    if (at !== -1) this.cursor = (at + 1) % this.rotation.length

    this.dispatch()
  }

  /**
   * Hand the freed slot to the next waiting tenant in rotation.
   *
   * Walks at most one full lap: a tenant already at its perKey limit is
   * skipped rather than blocking the search, so a single saturated tenant
   * cannot stop others being served.
   */
  private dispatch(): void {
    if (this.rotation.length === 0) return

    for (let i = 0; i < this.rotation.length; i += 1) {
      const index = (this.cursor + i) % this.rotation.length
      const key = this.rotation[index]
      const list = this.waiting.get(key)

      if (!list || list.length === 0) {
        // Stale entry — drop it and restart, since indices have shifted.
        this.forget(key)
        this.dispatch()
        return
      }

      if (!this.canAdmit(key)) continue

      const next = list.shift()!
      this.take(key)
      if (list.length === 0) {
        // forget() splices this key out, so everything after it shifts
        // left by one — `index` now addresses the FOLLOWING tenant, which
        // is exactly where the rotation should resume.
        this.forget(key)
        this.cursor =
          this.rotation.length === 0 ? 0 : index % this.rotation.length
      } else {
        // Advance past the tenant just served so the next free slot goes
        // to someone else — this is the rotation.
        this.cursor = (index + 1) % this.rotation.length
      }
      next()
      return
    }
  }

  private forget(key: string): void {
    this.waiting.delete(key)
    const at = this.rotation.indexOf(key)
    if (at !== -1) this.rotation.splice(at, 1)
    if (this.rotation.length === 0) this.cursor = 0
    else this.cursor %= this.rotation.length
  }
}
