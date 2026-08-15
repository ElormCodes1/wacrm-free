import { getOperator } from '@/lib/operator/session';
import { getTwoFactorState } from '@/lib/operator/two-factor';
import { PageHeader } from '../ui';
import { SecurityPanel } from './security-panel';

/**
 * The operator's own account.
 *
 * Not recorded as an operator action: nothing here crosses into a
 * customer's data, and logging "looked at their own settings" would
 * dilute a trail whose value is that every entry involves somebody
 * else's business.
 */
export default async function OperatorSecurity() {
  const operator = await getOperator();
  if (!operator) return null;

  const state = await getTwoFactorState(operator.userId);

  return (
    <>
      <PageHeader
        title="Your security"
        description="This account can read and suspend every company on the platform. Treat it accordingly."
      />
      <div className="max-w-2xl p-8">
        <SecurityPanel
          enrolled={state.enrolled}
          recoveryCodesLeft={state.recoveryCodesLeft}
        />
      </div>
    </>
  );
}
