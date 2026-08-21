import { describe, it, expect } from 'vitest'

import { Semaphore } from './semaphore'

/** A promise you can settle from the outside. */
function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let every already-queued microtask run before asserting. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0))

describe('Semaphore', () => {
  it('rejects a limit that cannot admit anybody', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/)
    expect(() => new Semaphore(-1)).toThrow(/positive integer/)
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/)
  })

  it('runs up to the limit at once and makes the rest wait', async () => {
    const sem = new Semaphore(2)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []

    const runs = gates.map((g, i) =>
      sem.run(async () => {
        started.push(i)
        await g.promise
      }),
    )

    // Two admitted, the third parked — this is the whole point.
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(sem.inUse).toBe(2)
    expect(sem.queued).toBe(1)

    gates[0].resolve()
    await runs[0]
    // The slot is handed over in a microtask that is queued behind
    // runs[0]'s own resolution, so the waiter has not run its first line
    // yet at this point. Flush before asserting — this is scheduling, not
    // a missing wake-up.
    await flushMicrotasks()
    expect(started).toEqual([0, 1, 2])

    gates[1].resolve()
    gates[2].resolve()
    await Promise.all(runs)
    expect(sem.inUse).toBe(0)
    expect(sem.queued).toBe(0)
  })

  /**
   * The leak that ends in total stall: if a throwing handler kept its
   * slot, every failure would permanently reduce capacity until nothing
   * could run at all.
   */
  it('releases the slot when the work throws', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    expect(sem.inUse).toBe(0)
    await expect(sem.run(async () => 'after the failure')).resolves.toBe(
      'after the failure',
    )
  })

  it('preserves arrival order so nothing is starved under sustained load', async () => {
    const sem = new Semaphore(1)
    const order: number[] = []
    const first = deferred()

    const runs = [
      sem.run(async () => {
        order.push(0)
        await first.promise
      }),
      ...[1, 2, 3].map((i) =>
        sem.run(async () => {
          order.push(i)
        }),
      ),
    ]

    first.resolve()
    await Promise.all(runs)
    expect(order).toEqual([0, 1, 2, 3])
  })

  it('returns the work’s value', async () => {
    const sem = new Semaphore(3)
    await expect(sem.run(async () => 42)).resolves.toBe(42)
  })

  it('never exceeds the limit under a burst', async () => {
    const sem = new Semaphore(3)
    let concurrent = 0
    let peak = 0

    await Promise.all(
      Array.from({ length: 50 }, () =>
        sem.run(async () => {
          concurrent += 1
          peak = Math.max(peak, concurrent)
          await new Promise((r) => setTimeout(r, 1))
          concurrent -= 1
        }),
      ),
    )

    expect(peak).toBe(3)
    expect(sem.inUse).toBe(0)
  })
})
