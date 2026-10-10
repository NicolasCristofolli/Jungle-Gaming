import type { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../domain/money';
import type { FailureCode } from '../../domain/failure-code';
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from '../../domain/wager-transaction';

interface TxRow {
  id: string;
  provider_id: string;
  external_transaction_id: string;
  idempotency_key: string;
  payload_hash: string;
  wallet_id: string;
  player_id: string;
  round_id: string;
  game_id: string;
  kind: string;
  amount: string;
  currency: string;
  reference_external_transaction_id: string | null;
  status: string;
  failure_code: string | null;
  balance_after: string | null;
  created_at: Date;
  processed_at: Date | null;
}

function toDomain(r: TxRow): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: r.id,
    providerId: r.provider_id,
    externalTransactionId: r.external_transaction_id,
    idempotencyKey: r.idempotency_key,
    payloadHash: r.payload_hash,
    walletId: r.wallet_id,
    playerId: r.player_id,
    roundId: r.round_id,
    gameId: r.game_id,
    kind: r.kind as WagerTransactionKind,
    money: Money.from({ amount: r.amount, currency: r.currency }),
    referenceExternalTransactionId: r.reference_external_transaction_id ?? undefined,
    createdAt: r.created_at,
    status: r.status as WagerTransactionStatus,
    failureCode: (r.failure_code ?? undefined) as FailureCode | undefined,
    processedAt: r.processed_at ?? undefined,
    balanceAfter: r.balance_after ? Money.from({ amount: r.balance_after, currency: r.currency }) : undefined,
  });
}

export class WagerTransactionRepository {
  async findById(em: EntityManager, id: string): Promise<WagerTransaction | null> {
    const rows = await em.execute<TxRow[]>(`SELECT * FROM wager_transactions WHERE id = ?`, [id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByIdempotencyKey(em: EntityManager, key: string): Promise<WagerTransaction | null> {
    const rows = await em.execute<TxRow[]>(
      `SELECT * FROM wager_transactions WHERE idempotency_key = ?`,
      [key],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByProviderExternalId(
    em: EntityManager,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const rows = await em.execute<TxRow[]>(
      `SELECT * FROM wager_transactions WHERE provider_id = ? AND external_transaction_id = ?`,
      [providerId, externalTransactionId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async insert(em: EntityManager, tx: WagerTransaction): Promise<void> {
    await em.execute(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id,
          player_id, round_id, game_id, kind, amount, currency, reference_external_transaction_id,
          status, failure_code, balance_after, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tx.id, tx.providerId, tx.externalTransactionId, tx.idempotencyKey, tx.payloadHash,
       tx.walletId, tx.playerId, tx.roundId, tx.gameId, tx.kind, tx.money.toString(),
       tx.money.currency, tx.referenceExternalTransactionId ?? null, tx.status,
       tx.failureCode ?? null, tx.balanceAfter?.toString() ?? null, tx.createdAt,
       tx.processedAt ?? null],
    );
  }
}
