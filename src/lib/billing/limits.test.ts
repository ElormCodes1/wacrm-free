import { describe, it, expect } from 'vitest';

import { planBreaches } from './limits';

const base = { numbers: 1, members: 1, maxNumbers: null, maxMembers: null, planName: 'Growth' };

describe('planBreaches', () => {
  it('says nothing when usage is within the plan', () => {
    expect(planBreaches({ ...base, numbers: 3, maxNumbers: 3 })).toEqual([]);
  });

  it('reports numbers over the ceiling', () => {
    const [breach] = planBreaches({ ...base, numbers: 4, maxNumbers: 1 });
    expect(breach.kind).toBe('numbers');
    expect(breach.text).toBe('4 WhatsApp numbers on a plan that includes 1');
  });

  it('treats null as unlimited, not zero', () => {
    // The trap this guards: encoding "unlimited" as 0 or as a big number.
    // A Business customer with 40 numbers must never be flagged.
    expect(planBreaches({ ...base, numbers: 40, maxNumbers: null })).toEqual([]);
  });

  it('says nothing about a company with no plan', () => {
    // They are already reported as "not on a plan"; flagging them for
    // exceeding a limit they were never given would be noise.
    expect(planBreaches({ ...base, numbers: 99, maxNumbers: 1, planName: null })).toEqual([]);
  });

  it('reports members and numbers independently', () => {
    const breaches = planBreaches({
      ...base,
      numbers: 5,
      maxNumbers: 3,
      members: 9,
      maxMembers: 5,
    });
    expect(breaches.map((b) => b.kind)).toEqual(['numbers', 'members']);
  });

  it('is not tripped by being exactly at the limit', () => {
    // Off-by-one here nags every customer who is using precisely what
    // they paid for, which is the fastest way to get the panel ignored.
    expect(planBreaches({ ...base, numbers: 1, maxNumbers: 1 })).toEqual([]);
    expect(planBreaches({ ...base, members: 5, maxMembers: 5 })).toEqual([]);
  });

  it('reports storage over the plan, in MB', () => {
    const [b] = planBreaches({
      ...base,
      storageBytes: 600 * 1024 * 1024,
      maxStorageMb: 500,
    });
    expect(b.kind).toBe('storage');
    expect(b.text).toBe('600 MB of media stored on a plan that includes 500 MB');
  });

  it('does not flag storage under the ceiling', () => {
    expect(
      planBreaches({ ...base, storageBytes: 400 * 1024 * 1024, maxStorageMb: 500 })
    ).toEqual([]);
  });

  it('reports broadcast volume over the plan', () => {
    const [b] = planBreaches({
      ...base,
      broadcastSends30d: 7500,
      maxBroadcastSends30d: 5000,
    });
    expect(b.kind).toBe('broadcasts');
    expect(b.text).toContain('7,500 broadcast messages in 30 days');
  });

  it('ignores usage it has not been given', () => {
    // The list pages fill usage in separately; a page that has not done
    // so must not report every customer as being at 0 MB over the limit.
    expect(planBreaches({ ...base, maxStorageMb: 500, maxBroadcastSends30d: 100 })).toEqual([]);
  });

  it('uses singular wording for one', () => {
    const [breach] = planBreaches({ ...base, numbers: 2, maxNumbers: 1 });
    expect(breach.text).toContain('2 WhatsApp numbers');
  });
});
