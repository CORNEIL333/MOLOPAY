import type { PoolClient } from 'pg';
import { readClientLedgerTotals } from '../ledger/balance.store';
import {
  ClientBalance,
  requestRecovery,
  type Account,
  type RecoveryMethod,
  type RecoveryRequest,
} from './domain';

/**
 * Demande de récupération exécutée dans la transaction de l'appelant : le
 * solde est lu depuis le grand livre, jamais accepté en paramètre.
 */
export async function requestRecoveryFromLedger(
  client: PoolClient,
  input: {
    readonly id: string;
    readonly account: Account;
    readonly newPhone: string;
    readonly method: RecoveryMethod;
    readonly now: string;
  },
): Promise<RecoveryRequest> {
  const totals = await readClientLedgerTotals(client, input.account.id);
  return requestRecovery({
    ...input,
    balance: ClientBalance.fromLedgerTotals(totals),
  });
}
