import { Money } from "./money";
import { FailureCode } from "./failure-code";
import {
  InvalidTransactionError,
  InvalidTransactionStateError,
} from "./errors";

export enum WagerTransactionKind {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

// dados que chegam para criar uma transação
export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

// tudo que está salvo no banco (para o rehydrate)
export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  processedAt?: Date;
  balanceAfter?: Money;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _balanceAfter?: Money,
  ) {}

  // ---------- criação ----------

  // transação vinda de FORA (API ou fila)
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    // OPENING é interno: ninguém de fora pode mandar
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidTransactionError(
        "OPENING não pode ser enviado externamente",
      );
    }

    const needsReference =
      props.kind === WagerTransactionKind.Refund ||
      props.kind === WagerTransactionKind.Rollback;
    if (needsReference && !props.referenceExternalTransactionId) {
      throw new InvalidTransactionError(
        `${props.kind} exige referenceExternalTransactionId`,
      );
    }

    return WagerTransaction.build(props, WagerTransactionStatus.Pending);
  }

  // transação INTERNA de saldo inicial (usada ao abrir a wallet)
  static createOpening(
    props: Omit<CreateWagerTransactionProps, "kind">,
  ): WagerTransaction {
    return WagerTransaction.build(
      { ...props, kind: WagerTransactionKind.Opening },
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.failureCode,
      state.processedAt,
      state.balanceAfter,
    );
  }

  // monta o objeto (evita repetir os 17 campos no create e no createOpening)
  private static build(
    p: CreateWagerTransactionProps,
    status: WagerTransactionStatus,
  ): WagerTransaction {
    return new WagerTransaction(
      p.id,
      p.providerId,
      p.externalTransactionId,
      p.idempotencyKey,
      p.payloadHash,
      p.walletId,
      p.playerId,
      p.roundId,
      p.gameId,
      p.kind,
      p.money,
      p.referenceExternalTransactionId,
      p.createdAt,
      status,
    );
  }

  // ---------- leitura ----------

  get status(): WagerTransactionStatus {
    return this._status;
  }
  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }
  get processedAt(): Date | undefined {
    return this._processedAt;
  }
  get balanceAfter(): Money | undefined {
    return this._balanceAfter;
  }

  // ---------- transições ----------

  markProcessed(at: Date, balanceAfter: Money): void {
    this.assertNotTerminal(); // 1. trava: estado final não muda
    this._status = WagerTransactionStatus.Processed; // 2. muda o estado
    this._processedAt = at; // 3. registra quando
    this._balanceAfter = balanceAfter; // 4. guarda o saldo (para replay)
  }

  // TODO B: igual ao markProcessed, mas status Rejected e guardando o failureCode
  reject(code: FailureCode, at: Date, balanceAfter: Money): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
    this._balanceAfter = balanceAfter;
  }

  // TODO C: igual, mas status Failed (sem balanceAfter)
  fail(code: FailureCode, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
  }

  // TODO D: só trava + muda o status para PendingReference (não é final, então sem processedAt)
  markPendingReference(): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
  }

  // ---------- perguntas ----------

  // TODO E: true se o status for Processed, Rejected OU Failed
  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  // TODO F: true para todos, MENOS LOSS (LOSS não mexe no saldo)
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  // TODO G: true para REFUND e ROLLBACK
  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  // a idempotency key é a mesma, mas o conteúdo é igual?
  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  // ---------- auxiliar ----------

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Transação ${this.id} já está em estado final (${this._status})`,
      );
    }
  }
}
