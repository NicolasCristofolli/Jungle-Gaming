import type { QueryResult } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../domain/money';
import { Wallet } from '../../domain/wallet';

interface WalletRow {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: WalletRow): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.player_id,
    currency: row.currency,
    balance: Money.from({ amount: row.balance, currency: row.currency }),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class WalletRepository {
  /**
   * Lê a wallet TRAVANDO a linha (SELECT ... FOR UPDATE).
   */
  async findByIdForUpdate(em: EntityManager, id: string): Promise<Wallet | null> {
    const rows = await em.execute<WalletRow[]>(
      `SELECT * FROM wallets WHERE id = ? FOR UPDATE`,
      [id],
    );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  /** Leitura simples, sem lock (para GET). */
  async findById(em: EntityManager, id: string): Promise<Wallet | null> {
    const rows = await em.execute<WalletRow[]>(`SELECT * FROM wallets WHERE id = ?`, [id]);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async insert(em: EntityManager, wallet: Wallet): Promise<void> {
    await em.execute(
      `INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [wallet.id, wallet.playerId, wallet.currency, wallet.balance.toString(),
       wallet.version, wallet.createdAt, wallet.updatedAt],
    );
  }

  /**
   * Grava o saldo novo. O "AND version = ?" é defesa em profundidade: com o FOR UPDATE
   * ninguém mais altera a linha, mas se um dia alguém esquecer o lock, o update falha
   * em vez de sobrescrever silenciosamente (lost update).
   */
  async update(em: EntityManager, wallet: Wallet, expectedVersion: number): Promise<void> {
    const result = await em.execute<QueryResult>(
      `UPDATE wallets SET balance = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
      [wallet.balance.toString(), wallet.version, wallet.updatedAt, wallet.id, expectedVersion],
      'run',
    );
    if (result.affectedRows !== 1) {
      throw new Error(`Lost update detectado na wallet ${wallet.id}`);
    }
  }
}
