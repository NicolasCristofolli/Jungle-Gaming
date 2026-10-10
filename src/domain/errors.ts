// Classe "mãe" de todos os erros de regra de negócio.
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name; // faz o erro aparecer com o nome certo no terminal
  }
}

// Erro para quando o valor de dinheiro é inválido ("abc", "1.234", etc.)
export class InvalidMoneyError extends DomainError {
  constructor(message: string) {
    super("INVALID_MONEY", message);
  }
}

// Erro para quando tenta somar BRL com USD
export class CurrencyMismatchError extends DomainError {
  constructor(message: string) {
    super("CURRENCY_MISMATCH", message);
  }
}

export class InvalidLedgerEntryError extends DomainError {
  constructor(message: string) {
    super("INVALID_LEDGER_ENTRY", message);
  }
}

// Erro de saldo insuficiente
export class InsufficientFundsError extends DomainError {
  constructor(message: string) {
    super("INSUFFICIENT_FUNDS", message);
  }
}

// tentou mudar uma transação que já está num estado final
export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super("INVALID_TRANSACTION_STATE", message);
  }
}

// dados da transação inválidos (ex.: REFUND sem referência)
export class InvalidTransactionError extends DomainError {
  constructor(message: string) {
    super("INVALID_TRANSACTION", message);
  }
}
