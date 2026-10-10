import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../domain/money';
import { FailureCode } from '../domain/failure-code';
import { InsufficientFundsError } from '../domain/errors';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import type { WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletRepository } from '../infrastructure/persistence/wallet.repository';
import { WagerTransactionRepository } from '../infrastructure/persistence/wager-transaction.repository';
import { LedgerRepository } from '../infrastructure/persistence/ledger.repository';
import { OutboxRepository } from '../infrastructure/persistence/outbox.repository';
import { computePayloadHash } from './payload-hash';
import { IdempotencyConflictError, WalletNotFoundError } from './errors';

export interface SubmitWagerInput {
  idempotencyKey: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId?: string;
}

export interface SubmitWagerResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  failureCode?: string;
  idempotentReplay: boolean;
}

export class SubmitWagerTransactionUseCase {
  private readonly wallets = new WalletRepository();
  private readonly transactions = new WagerTransactionRepository();
  private readonly ledger = new LedgerRepository();
  private readonly outbox = new OutboxRepository();

  constructor(private readonly orm: MikroORM) {}

  async execute(input: SubmitWagerInput): Promise<SubmitWagerResult> {
    // 1. FORA da transação: valida e calcula o hash (nada é gravado se for inválido)
    const money = Money.from(input.money);
    const payloadHash = computePayloadHash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    try {
      return await this.runInTransaction(input, money, payloadHash);
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        return this.runInTransaction(input, money, payloadHash);
      }
      throw error;
    }
  }

  private runInTransaction(input: SubmitWagerInput, money: Money, payloadHash: string) {
    return this.orm.em.fork().transactional(async (em) => {
      // 2. TRAVA a wallet. A partir daqui, operações na MESMA wallet esperam na fila.
      const wallet = await this.wallets.findByIdForUpdate(em, input.walletId);
      if (!wallet) throw new WalletNotFoundError(input.walletId);

      // 3. Idempotência: já existe transação com essa key?
      const existing = await this.transactions.findByIdempotencyKey(em, input.idempotencyKey);
      if (existing) {
        if (!existing.matchesPayload(payloadHash)) throw new IdempotencyConflictError(input.idempotencyKey);
        return this.toResult(existing, true, wallet.balance); // replay: devolve o resultado ORIGINAL
      }
      const sameExternal = await this.transactions.findByProviderExternalId(
        em, input.providerId, input.externalTransactionId,
      );
      if (sameExternal) throw new IdempotencyConflictError(input.idempotencyKey);

      // 4. Cria a transação (valida OPENING e referência obrigatória no domínio)
      const now = new Date();
      const tx = WagerTransaction.create({
        id: crypto.randomUUID(),
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
        createdAt: now,
      });

      // 5. Regras de negócio
      const versionBefore = wallet.version;
      let entry: WalletLedgerEntry | undefined;

      if (input.playerId !== wallet.playerId) {
        tx.reject(FailureCode.WalletPlayerMismatch, now, wallet.balance);
      } else if (money.currency !== wallet.currency) {
        tx.reject(FailureCode.CurrencyMismatch, now, wallet.balance);
      } else if (tx.requiresReference()) {
        // REFUND/ROLLBACK: resolução de referência ainda não implementada (próximo passo).
        // Fica PENDING_REFERENCE, sem mexer no saldo, para o worker de pendências processar.
        tx.markPendingReference();
      } else if (!tx.affectsBalance()) {
        tx.markProcessed(now, wallet.balance); // LOSS: registra, não mexe no saldo
      } else {
        const movement = { entryId: crypto.randomUUID(), transactionId: tx.id, money, now };
        try {
          entry = tx.kind === WagerTransactionKind.Bet ? wallet.debit(movement) : wallet.credit(movement);
          tx.markProcessed(now, wallet.balance);
        } catch (error) {
          if (!(error instanceof InsufficientFundsError)) throw error;
          tx.reject(FailureCode.InsufficientFunds, now, wallet.balance);
        }
      }

      // 6. Persiste tudo na MESMA transação: transação, ledger, wallet e outbox
      await this.transactions.insert(em, tx);
      if (entry) {
        await this.ledger.insert(em, entry);
        await this.wallets.update(em, wallet, versionBefore);
      }
      await this.addEvents(em, tx, entry, input.correlationId ?? input.idempotencyKey, now);

      return this.toResult(tx, false, wallet.balance);
    }); // 7. commit aqui. Se qualquer passo lançar erro, rollback de TUDO.
  }

  private async addEvents(
    em: EntityManager,
    tx: WagerTransaction,
    entry: WalletLedgerEntry | undefined,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    const eventType =
      tx.status === WagerTransactionStatus.Processed ? 'WagerTransactionProcessed'
      : tx.status === WagerTransactionStatus.Rejected ? 'WagerTransactionRejected'
      : 'WagerTransactionPendingReference';

    await this.outbox.add(em, {
      aggregateId: tx.id,
      eventType,
      correlationId,
      data: { transactionId: tx.id, walletId: tx.walletId, kind: tx.kind, status: tx.status,
              failureCode: tx.failureCode, money: tx.money.toJSON() },
    }, now);

    if (entry) {
      await this.outbox.add(em, {
        aggregateId: entry.walletId,
        eventType: 'WalletBalanceChanged',
        correlationId,
        data: { walletId: entry.walletId, transactionId: tx.id, direction: entry.direction,
                money: entry.money.toJSON(), balanceBefore: entry.balanceBefore.toJSON(),
                balanceAfter: entry.balanceAfter.toJSON() },
      }, now);
    }
  }

  private toResult(tx: WagerTransaction, idempotentReplay: boolean, currentBalance: Money): SubmitWagerResult {
    return {
      transactionId: tx.id,
      status: tx.status,
      balance: (tx.balanceAfter ?? currentBalance).toJSON(),
      failureCode: tx.failureCode,
      idempotentReplay,
    };
  }
}
