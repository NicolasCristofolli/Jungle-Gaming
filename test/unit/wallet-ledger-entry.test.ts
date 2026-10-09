import { describe, it, expect } from 'bun:test';

import { Money } from '../../src/domain/money';
import { WalletLedgerEntry, LedgerDirection } from '../../src/domain/wallet-ledger-entry';
import { InvalidLedgerEntryError } from '../../src/domain/errors';
import { toArray } from 'rxjs';

// atalho: brl('10.00') cria um Money em BRL
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

// monta os dados de um lançamento; você só passa o que muda em cada teste
function props(direction: LedgerDirection, money: string, before: string, after: string) {
  return {
    id: 'entry-1',
    walletId: 'wallet-1',
    transactionId: 'tx-1',
    direction,
    money: brl(money),
    balanceBefore: brl(before),
    balanceAfter: brl(after),
    createdAt: new Date(),
  };
}

describe('WalletLedgerEntry', () => {
    it('cria um CREDIT correto: 100.00 + 50.00 = 150.00', () => {
        const entry = WalletLedgerEntry.create(props(LedgerDirection.Credit, '50.00', '100.00', '150.00'));
        expect(entry.balanceAfter.toString()).toBe('150.00');
    });

    it('Cria um CREDIT com conta errada (antes 100.00, valor 50.00 e depois 200.00', () => {
        expect(() => WalletLedgerEntry.create(props(LedgerDirection.Credit, '50.00', '100.00', '200.00'))).toThrow(InvalidLedgerEntryError);
    });
    
    it('cria um DEBIT correto: 100.00 - 30.00 = 70.00', () => {
        const entry = WalletLedgerEntry.create(props(LedgerDirection.Debit, '30.00', '100.00', '70.00'));
        expect(entry.balanceAfter.toString()).toBe('70.00');
    });

    it('Cria um DEBIT com conta errada (antes 100.00, valor 30.00 e depois 80.00', () => {
        expect(() => WalletLedgerEntry.create(props(LedgerDirection.Debit, '30.00', '100.00', '80.00'))).toThrow(InvalidLedgerEntryError);
    });

    it('Rejeira lançamento com valor zero', () => {
        expect(() => WalletLedgerEntry.create(props(LedgerDirection.Debit, '00.00', '100.00', '100.00'))).toThrow(InvalidLedgerEntryError);
    });
    it('rehydrate não valida: aceita conta errada vinda do banco', () => {
        expect(() =>
        WalletLedgerEntry.rehydrate(props(LedgerDirection.Credit, '50.00', '100.00', '200.00')),
        ).not.toThrow();
    });
});