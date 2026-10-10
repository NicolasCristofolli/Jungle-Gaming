/** Erros da camada de aplicação (não são regra de negócio da wallet, são do fluxo). */
export class ApplicationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class WalletNotFoundError extends ApplicationError {
  constructor(id: string) { super('WALLET_NOT_FOUND', `Wallet ${id} não encontrada`); }
}
export class WalletAlreadyExistsError extends ApplicationError {
  constructor() { super('WALLET_ALREADY_EXISTS', 'Já existe wallet para este player e moeda'); }
}
export class IdempotencyConflictError extends ApplicationError {
  constructor(key: string) { super('IDEMPOTENCY_CONFLICT', `Idempotency-Key ${key} já usada com payload diferente`); }
}
