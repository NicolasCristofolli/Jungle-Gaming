import type { EntityManager } from '@mikro-orm/postgresql';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';

/** O ledger só tem INSERT: o banco bloqueia UPDATE/DELETE com trigger. */
export class LedgerRepository {
  async insert(em: EntityManager, entry: WalletLedgerEntry): Promise<void> {
    await em.execute(
      `INSERT INTO wallet_ledger_entries
         (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.walletId, entry.transactionId, entry.direction, entry.money.toString(),
       entry.money.currency, entry.balanceBefore.toString(), entry.balanceAfter.toString(), entry.createdAt],
    );
  }
}
