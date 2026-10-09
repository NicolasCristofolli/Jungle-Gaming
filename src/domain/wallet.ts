import { Money } from "./money";
import { WalletLedgerEntry, LedgerDirection } from "./wallet-ledger-entry";
import {
  CurrencyMismatchError,
  InsufficientFundsError,
  InvalidMoneyError,
} from "./errors";

// Todos os dados de uma wallet (usado no rehydrate)
export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// O que é preciso para movimentar o saldo (debit/credit)
export interface MovementProps {
  entryId: string;
  transactionId: string;
  money: Money;
  now: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // ---------- criação ----------

  // Abre uma wallet NOVA
  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    now: Date;
  }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyError("Saldo inicial não pode ser negativo");
    }
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.now,
      props.now,
    );
  }

  // Reconstrói do banco: sem validar
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  // ---------- leitura (getters) ----------

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // ---------- movimentação ----------
  debit(props: MovementProps): WalletLedgerEntry {
    // 1. a moeda bate com a da wallet?
    this.assertSameCurrency(props.money);

    // 2. tem saldo suficiente?
    if (this._balance.isLessThan(props.money)) {
      throw new InsufficientFundsError(
        `Saldo insuficiente: saldo ${this._balance.toString()}, débito ${props.money.toString()}`,
      );
    }

    // 3. calcula o saldo novo
    const before = this._balance;
    const after = before.subtract(props.money);

    // 4. cria o lançamento ANTES de mudar a wallet
    const entry = WalletLedgerEntry.create({
      id: props.entryId,
      walletId: this.id,
      transactionId: props.transactionId,
      direction: LedgerDirection.Debit,
      money: props.money,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: props.now,
    });

    // 5. só agora altera o estado da wallet
    this._balance = after;
    this._version += 1;
    this._updatedAt = props.now;

    // 6. devolve o lançamento para quem chamou salvar no banco
    return entry;
  }

  credit(props: MovementProps): WalletLedgerEntry {
    // 1. a moeda bate com a da wallet?
    this.assertSameCurrency(props.money);

    // 2. calcula o saldo novo
    const before = this._balance;
    const after = before.add(props.money);

    // 3. cria o lançamento ANTES de mudar a wallet
    const entry = WalletLedgerEntry.create({
      id: props.entryId,
      walletId: this.id,
      transactionId: props.transactionId,
      direction: LedgerDirection.Credit,
      money: props.money,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: props.now,
    });

    // 4. só agora altera o estado da wallet
    this._balance = after;
    this._version += 1;
    this._updatedAt = props.now;

    // 5. devolve o lançamento para quem chamou salvar no banco
    return entry;
  }

  // ---------- auxiliar ----------

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(
        `Moeda ${money.currency} diferente da wallet (${this.currency})`,
      );
    }
  }
}
