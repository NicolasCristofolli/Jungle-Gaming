import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../src/infrastructure/persistence/mikro-orm.config';
import { CreateWalletUseCase } from '../../src/application/create-wallet.use-case';
import { SubmitWagerTransactionUseCase } from '../../src/application/submit-wager-transaction.use-case';
import { WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/wager-transaction';
import { IdempotencyConflictError, WalletAlreadyExistsError } from '../../src/application/errors';

// Banco SEPARADO para testes (wagering_test), criado pelo docker/postgres/init.sql
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? String(config.clientUrl).replace(/\/wagering$/, '/wagering_test');

let orm: MikroORM;
let createWallet: CreateWalletUseCase;
let submit: SubmitWagerTransactionUseCase;

beforeAll(async () => {
  // pool com várias conexões: cada chamada paralela pega uma conexão diferente,
  // então o Postgres vê transações realmente simultâneas (não é mock sequencial)
  orm = await MikroORM.init({ ...config, clientUrl: TEST_DATABASE_URL, pool: { min: 0, max: 20 } });
  await orm.migrator.up();
});

beforeEach(async () => {
  // TRUNCATE não dispara o trigger de DELETE do ledger, por isso pode limpar entre testes
  await orm.em.fork().execute(
    `TRUNCATE outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets`,
  );
});

afterAll(async () => {
  await orm.close(true);
});

const PLAYER = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

async function newWallet(amount: string, playerId = PLAYER) {
  return createWallet.execute({ playerId, initialBalance: { amount, currency: 'BRL' } });
}

function bet(walletId: string, externalId: string, amount: string, playerId = PLAYER) {
  return submit.execute({
    idempotencyKey: `provider-a:${externalId}`,
    providerId: 'provider-a',
    externalTransactionId: externalId,
    playerId,
    walletId,
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: { amount, currency: 'BRL' },
  });
}

/** Invariante final: saldo da wallet === saldo reconstruído pelo ledger */
async function expectWalletConsistent(walletId: string) {
  const rows = await orm.em.fork().execute<{ stored: string; calculated: string }[]>(
    `SELECT w.balance AS stored,
            COALESCE(SUM(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END), 0)::numeric(20,2) AS calculated
       FROM wallets w
       LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
      WHERE w.id = ?
      GROUP BY w.balance`,
    [walletId],
  );
  expect(rows[0]?.stored).toBe(rows[0]?.calculated);
}

async function countDebits(walletId: string): Promise<number> {
  const rows = await orm.em.fork().execute<{ n: string }[]>(
    `SELECT COUNT(*) AS n FROM wallet_ledger_entries WHERE wallet_id = ? AND direction = 'DEBIT'`,
    [walletId],
  );
  return Number(rows[0]?.n);
}

async function balanceOf(walletId: string): Promise<string> {
  const rows = await orm.em.fork().execute<{ balance: string }[]>(
    `SELECT balance FROM wallets WHERE id = ?`,
    [walletId],
  );
  return String(rows[0]?.balance);
}

beforeAll(() => {
  createWallet = new CreateWalletUseCase(orm);
  submit = new SubmitWagerTransactionUseCase(orm);
});

describe('Concorrência na wallet (Postgres real)', () => {
  it('cenário da seção 8: saldo 100, duas apostas de 80 em paralelo → uma passa, saldo 20', async () => {
    const wallet = await newWallet('100.00');

    const results = await Promise.all([
      bet(wallet.id, 'tx-a', '80.00'),
      bet(wallet.id, 'tx-b', '80.00'),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);
    expect(results.find((r) => r.status === WagerTransactionStatus.Rejected)?.failureCode).toBe(
      'INSUFFICIENT_FUNDS',
    );
    expect(await balanceOf(wallet.id)).toBe('20.00');
    expect(await countDebits(wallet.id)).toBe(1);
    await expectWalletConsistent(wallet.id);
  });

  it('a mesma aposta enviada 50 vezes em paralelo gera um único débito', async () => {
    const wallet = await newWallet('100.00');

    const results = await Promise.all(
      Array.from({ length: 50 }, () => bet(wallet.id, 'tx-same', '25.00')),
    );

    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(results.filter((r) => r.idempotentReplay)).toHaveLength(49);
    // todo replay devolve o MESMO resultado original (inclusive o saldo daquele momento)
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(new Set(results.map((r) => r.balance.amount))).toEqual(new Set(['75.00']));
    expect(await balanceOf(wallet.id)).toBe('75.00');
    expect(await countDebits(wallet.id)).toBe(1);
    await expectWalletConsistent(wallet.id);
  });

  it('wallets diferentes são processadas em paralelo sem interferir', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        newWallet('100.00', `0192f28f-5dc0-7d58-bdb2-${String(i).padStart(12, '0')}`),
      ),
    );

    await Promise.all(
      wallets.flatMap((w) =>
        Array.from({ length: 5 }, (_, j) => bet(w.id, `tx-${w.id}-${j}`, '10.00', w.playerId)),
      ),
    );

    for (const w of wallets) {
      expect(await balanceOf(w.id)).toBe('50.00');
      expect(await countDebits(w.id)).toBe(5);
      await expectWalletConsistent(w.id);
    }
  });

  it('mesma Idempotency-Key com payload diferente é conflito e não altera nada', async () => {
    const wallet = await newWallet('100.00');
    await bet(wallet.id, 'tx-1', '10.00');

    await expect(bet(wallet.id, 'tx-1', '99.00')).rejects.toThrow(IdempotencyConflictError);

    expect(await balanceOf(wallet.id)).toBe('90.00');
    await expectWalletConsistent(wallet.id);
  });

  it('criar wallet duplicada para o mesmo player e moeda é conflito', async () => {
    await newWallet('10.00');
    await expect(newWallet('10.00')).rejects.toThrow(WalletAlreadyExistsError);
  });
});
