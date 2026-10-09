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
