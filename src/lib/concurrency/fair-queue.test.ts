import { describe, it, expect } from 'vitest'

import { FairQueue } from './fair-queue'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('FairQueue', () => {
  it('rejects limits that cannot admit anybody', () => {
    expect(() => new FairQueue(0, 1)).toThrow(/global/)
    expect(() => new FairQueue(1, 0)).toThrow(/perKey/)
  })

  it('never exceeds the global limit', async () => {
    const q = new FairQueue(3, 3)
    let live = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        q.run(`tenant-${i % 5}`, async () => {
          live += 1
          peak = Math.max(peak, live)
          await new Promise((r) => setTimeout(r, 1))
          live -= 1
        }),
      ),
    )
    expect(peak).toBe(3)
    expect(q.inUse).toBe(0)
  })

  it('never lets one tenant exceed its own share', async () => {
    const q = new FairQueue(8, 2)
    const perKeyPeak = new Map<string, number>()
    const live = new Map<string, number>()

    await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const key = `tenant-${i % 4}`
        return q.run(key, async () => {
          const n = (live.get(key) ?? 0) + 1
          live.set(key, n)
          perKeyPeak.set(key, Math.max(perKeyPeak.get(key) ?? 0, n))
          await new Promise((r) => setTimeout(r, 1))
          live.set(key, n - 1)
        })
      }),
    )

    for (const peak of perKeyPeak.values()) expect(peak).toBeLessThanOrEqual(2)
  })

  /**
   * The whole point. A tenant that floods the queue must not delay a
   * tenant who sent one message — that is the customer who did nothing
   * wrong and is the one who notices.
   */
  it('serves a quiet tenant without waiting for a flood to drain', async () => {
    const q = new FairQueue(1, 1)
    const gates = Array.from({ length: 6 }, () => deferred())
    const order: string[] = []

    // Noisy tenant queues six, all blocked.
    const noisy = gates.map((g, i) =>
      q.run('noisy', async () => {
        order.push(`noisy-${i}`)
        await g.promise
      }),
    )
    await flush()

    // Quiet tenant arrives last, behind all six.
    const quiet = q.run('quiet', async () => {
      order.push('quiet')
    })

    // Release the in-flight noisy item. The freed slot must go to the
    // quiet tenant, not back to the next noisy one.
    gates[0].resolve()
    await quiet

    expect(order).toEqual(['noisy-0', 'quiet'])

    gates.forEach((g) => g.resolve())
    await Promise.all(noisy)
    expect(q.inUse).toBe(0)
    expect(q.queued).toBe(0)
  })

  it('keeps one tenant’s own events in order', async () => {
    const q = new FairQueue(4, 1)
    const seen: number[] = []
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        q.run('same-tenant', async () => {
          seen.push(i)
        }),
      ),
    )
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('releases the slot when the work throws', async () => {
    const q = new FairQueue(1, 1)
    await expect(
      q.run('t', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(q.inUse).toBe(0)
    await expect(q.run('t', async () => 'still works')).resolves.toBe('still works')
  })

  /**
   * Keys are tenant ids and there is no upper bound on how many appear
   * over a process's life. Bookkeeping must not accumulate.
   */
  it('does not retain state for finished tenants', async () => {
    const q = new FairQueue(2, 1)
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => q.run(`tenant-${i}`, async () => i)),
    )
    expect(q.queued).toBe(0)
    expect(q.waitingKeys).toBe(0)
    expect(q.inUse).toBe(0)
  })

  it('rotates between several waiting tenants rather than favouring one', async () => {
    const q = new FairQueue(1, 1)
    const blocker = deferred()
    const served: string[] = []

    const first = q.run('a', async () => {
      await blocker.promise
    })
    await flush()

    // b, c and a all queue while 'a' holds the only slot.
    const rest = [
      q.run('b', async () => {
        served.push('b')
      }),
      q.run('c', async () => {
        served.push('c')
      }),
      q.run('a', async () => {
        served.push('a')
      }),
    ]

    blocker.resolve()
    await Promise.all([first, ...rest])

    // Every tenant served, and the one that was already running does not
    // get to go again before the others have had their turn.
    expect(served).toHaveLength(3)
    expect(served.indexOf('a')).toBe(2)
  })
})
