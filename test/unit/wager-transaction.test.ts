import { describe, it, expect } from "bun:test";
import { Money } from "../../src/domain/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/wager-transaction";
import { FailureCode } from "../../src/domain/failure-code";
import {
  InvalidTransactionError,
  InvalidTransactionStateError,
} from "../../src/domain/errors";
import { createContextId } from "@nestjs/core";

const base = (kind: WagerTransactionKind, ref?: string) => ({
  id: "tx-1",
  providerId: "provider-a",
  externalTransactionId: "ext-1",
  idempotencyKey: "provider-a:ext-1",
  payloadHash: "hash-1",
  walletId: "w-1",
  playerId: "p-1",
  roundId: "r-1",
  gameId: "g-1",
  kind,
  money: Money.from({ amount: "10.00", currency: "BRL" }),
  referenceExternalTransactionId: ref,
  createdAt: new Date(),
});

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

describe("WagerTransaction", () => {
  it("BET nasce PENDING", () => {
    const tx = WagerTransaction.create(base(WagerTransactionKind.Bet));
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
  });

  it("markProcessed muda para PROCESSED e guarda o saldo", () => {
    const tx = WagerTransaction.create(base(WagerTransactionKind.Bet));

    tx.markProcessed(new Date(), brl("90.00"));

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.balanceAfter?.toString()).toBe("90.00");
  });

  it("rejeita OPENING vindo de fora", () => {
    expect(() =>
      WagerTransaction.create(base(WagerTransactionKind.Opening)),
    ).toThrow(InvalidTransactionError);
  });

  it("rejeita REFUND sem referência", () => {
    expect(() =>
      WagerTransaction.create(base(WagerTransactionKind.Refund)),
    ).toThrow(InvalidTransactionError);
  });
  it("rejeita REFUND com referência vazia", () => {
    expect(() =>
      WagerTransaction.create(base(WagerTransactionKind.Refund, "")),
    ).toThrow(InvalidTransactionError);
  });
  it("REFUND com referência é criado em PENDING", () => {
    const tx = WagerTransaction.create(
      base(WagerTransactionKind.Refund, "ext-0"),
    );
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
  });
  it("reject muda para REJECTED e guarda o failureCode", () => {
    const tx = WagerTransaction.create(base(WagerTransactionKind.Bet));

    tx.reject(FailureCode.InsufficientFunds, new Date(), brl("100.00"));

    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
  });

  it("transação PROCESSED não pode ser rejeitada depois", () => {
    const tx = WagerTransaction.create(base(WagerTransactionKind.Bet));
    tx.markProcessed(new Date(), brl("90.00"));

    expect(() =>
      tx.reject(FailureCode.InsufficientFunds, new Date(), brl("90.00")),
    ).toThrow(InvalidTransactionStateError);

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
  });

  it("PENDING_REFERENCE não é final: ainda pode virar PROCESSED", () => {
    const tx = WagerTransaction.create(
      base(WagerTransactionKind.Refund, "ext-0"),
    );
    tx.markPendingReference(); // esperando a BET chegar

    tx.markProcessed(new Date(), brl("110.00"));

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
  });

  it("affectsBalance é false para LOSS e true para BET", () => {
    const loss = WagerTransaction.create(base(WagerTransactionKind.Loss));
    const bet = WagerTransaction.create(base(WagerTransactionKind.Bet));

    expect(loss.affectsBalance()).toBe(false);
    expect(bet.affectsBalance()).toBe(true);
  });

  it("matchesPayload compara o hash do conteúdo", () => {
    const tx = WagerTransaction.create(base(WagerTransactionKind.Bet));

    expect(tx.matchesPayload("hash-1")).toBe(true);
    expect(tx.matchesPayload("outro")).toBe(false);
  });
});
