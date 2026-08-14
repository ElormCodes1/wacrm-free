import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveInstanceConfig,
  invalidateInstanceConfig,
  type InstanceConfig,
} from './config'

const CONFIG: InstanceConfig = {
  id: 'cfg-1',
  account_id: 'acc-1',
  user_id: 'usr-1',
}

/** A query stub that counts how many times it actually reached the "DB". */
function countingQuery(result: InstanceConfig | null) {
  let calls = 0
  const query = async () => {
    calls += 1
    return result
  }
  return { query, calls: () => calls }
}

describe('resolveInstanceConfig', () => {
  beforeEach(() => invalidateInstanceConfig())

  it('queries once and serves the rest from cache', async () => {
    const { query, calls } = countingQuery(CONFIG)

    const a = await resolveInstanceConfig('inst-a', query, 0)
    const b = await resolveInstanceConfig('inst-a', query, 1_000)
    const c = await resolveInstanceConfig('inst-a', query, 59_000)

    expect(a).toEqual(CONFIG)
    expect(b).toEqual(CONFIG)
    expect(c).toEqual(CONFIG)
    expect(calls()).toBe(1)
  })

  it('caches per instance, not globally', async () => {
    const { query, calls } = countingQuery(CONFIG)

    await resolveInstanceConfig('inst-a', query, 0)
    await resolveInstanceConfig('inst-b', query, 0)

    expect(calls()).toBe(2)
  })

  it('re-queries once the hit TTL has passed', async () => {
    const { query, calls } = countingQuery(CONFIG)

    await resolveInstanceConfig('inst-a', query, 0)
    await resolveInstanceConfig('inst-a', query, 60_001)

    expect(calls()).toBe(2)
  })

  it('expires a miss quickly, so a number linked moments ago still works', async () => {
    let result: InstanceConfig | null = null
    let calls = 0
    const query = async () => {
      calls += 1
      return result
    }

    expect(await resolveInstanceConfig('inst-a', query, 0)).toBeNull()
    // Within the miss TTL the null is still served from cache.
    expect(await resolveInstanceConfig('inst-a', query, 4_000)).toBeNull()
    expect(calls).toBe(1)

    // The number gets linked; 5s later the miss has expired and we re-read.
    result = CONFIG
    expect(await resolveInstanceConfig('inst-a', query, 5_001)).toEqual(CONFIG)
    expect(calls).toBe(2)
  })

  it('stops serving a mapping that was explicitly invalidated', async () => {
    const { query, calls } = countingQuery(CONFIG)

    await resolveInstanceConfig('inst-a', query, 0)
    invalidateInstanceConfig('inst-a')
    await resolveInstanceConfig('inst-a', query, 1_000)

    expect(calls()).toBe(2)
  })

  it('invalidating one instance leaves the others cached', async () => {
    const { query, calls } = countingQuery(CONFIG)

    await resolveInstanceConfig('inst-a', query, 0)
    await resolveInstanceConfig('inst-b', query, 0)
    invalidateInstanceConfig('inst-a')
    await resolveInstanceConfig('inst-b', query, 1_000)

    expect(calls()).toBe(2)
  })
})
