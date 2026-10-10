import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../domain/money';
import { Wallet } from '../domain/wallet';
import { WagerTransaction } from '../domain/wager-transaction';
import { LedgerDirection, WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletRepository } from '../infrastructure/persistence/wallet.repository';
import { WagerTransactionRepository } from '../infrastructure/persistence/wager-transaction.repository';
import { LedgerRepository } from '../infrastructure/persistence/ledger.repository';
import { computePayloadHash } from './payload-hash';
import { WalletAlreadyExistsError } from './errors';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export class CreateWalletUseCase {
  private readonly wallets = new WalletRepository();
  private readonly transactions = new WagerTransactionRepository();
  private readonly ledger = new LedgerRepository();

  constructor(private readonly orm: MikroORM) {}

  async execute(input: CreateWalletInput): Promise<Wallet> {
    const initialBalance = Money.from(input.initialBalance); // valida formato (400 se inválido)
    const now = new Date();
    const wallet = Wallet.open({ id: crypto.randomUUID(), playerId: input.playerId, initialBalance, now });

    try {
      // wallet + transação OPENING + lançamento CREDIT: tudo na MESMA transação SQL
      await this.orm.em.fork().transactional(async (em) => {
        await this.wallets.insert(em, wallet);

        if (initialBalance.isPositive()) {
          const opening = WagerTransaction.createOpening({
            id: crypto.randomUUID(),
            providerId: 'internal',
            externalTransactionId: wallet.id,
            idempotencyKey: `internal:opening:${wallet.id}`,
            payloadHash: computePayloadHash({ walletId: wallet.id, initialBalance: initialBalance.toJSON() }),
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: 'opening',
            gameId: 'opening',
            money: initialBalance,
            createdAt: now,
          });
          opening.markProcessed(now, initialBalance);
          await this.transactions.insert(em, opening);

          await this.ledger.insert(em, WalletLedgerEntry.create({
            id: crypto.randomUUID(),
            walletId: wallet.id,
            transactionId: opening.id,
            direction: LedgerDirection.Credit,
            money: initialBalance,
            balanceBefore: Money.zero(wallet.currency),
            balanceAfter: initialBalance,
            createdAt: now,
          }));
        }
      });
    } catch (error) {
      // o UNIQUE (player_id, currency) do banco é quem garante "uma wallet por player+moeda"
      if (error instanceof UniqueConstraintViolationException) throw new WalletAlreadyExistsError();
      throw error;
    }
    return wallet;
  }
}
