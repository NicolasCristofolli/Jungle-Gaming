import { describe, it, expect } from "bun:test";
import { Money } from "../../src/domain/money";
import { Wallet } from "../../src/domain/wallet";
import { LedgerDirection } from "../../src/domain/wallet-ledger-entry";
import {
  InsufficientFundsError,
  CurrencyMismatchError,
} from "../../src/domain/errors";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const now = new Date();

// cria uma wallet com o saldo que você quiser
const walletWith = (amount: string) =>
  Wallet.open({ id: "w-1", playerId: "p-1", initialBalance: brl(amount), now });

// dados de um movimento
const move = (amount: string) => ({
  entryId: "e-1",
  transactionId: "t-1",
  money: brl(amount),
  now,
});

describe("Wallet", () => {
  it("debita 30.00 de 100.00 → saldo 70.00", () => {
    const wallet = walletWith("100.00");

    const entry = wallet.debit(move("30.00"));

    expect(wallet.balance.toString()).toBe("70.00");

    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("70.00");
  });
  it("open começa com 1", () => {
    const wallet = walletWith("100.00");
    expect(wallet.version).toBe(1);
  });
  it("debit sobe o version de 1 para 2", () => {
    const wallet = walletWith("100.00");

    wallet.debit(move("30.00"));

    expect(wallet.version).toBe(2);
  });
  it("Erro ao debito maior que o saldo (deixando version e saldo)", () => {
    const wallet = walletWith("100.00");
    expect(() => wallet.debit(move("120.00"))).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);
  });
  it("Erro ao debitar USD numa wallet BRL", () => {
    const wallet = walletWith("100.00");
    const usd = Money.from({ amount: "10.00", currency: "USD" }); // dinheiro em USD

    expect(() =>
      wallet.debit({ entryId: "e-1", transactionId: "t-1", money: usd, now }),
    ).toThrow(CurrencyMismatchError);
  });
  it("credit de 50.00 em 100.00 saldo 150.00, version 2, lançamento com direção Credit", () => {
    const wallet = walletWith("100.00");

    const entry = wallet.credit(move("50.00"));

    expect(wallet.balance.toString()).toBe("150.00");
    expect(wallet.version).toBe(2);

    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("150.00");
  });

  it("saldo 100.00, débito de 80.00 funciona, um segundo débito de 80.00 lança InsufficientFundsError, e o saldo final é 20.00", () => {
    const wallet = walletWith("100.00");

    wallet.debit(move("80.00"));

    expect(() => wallet.debit(move("80.00"))).toThrow(InsufficientFundsError);

    expect(wallet.balance.toString()).toBe("20.00");
    expect(wallet.version).toBe(2);
  });
});
