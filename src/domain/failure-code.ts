// Motivos pelos quais uma transação pode ser REJEITADA.
export enum FailureCode {
  // BET maior que o saldo da carteira
  InsufficientFunds = "INSUFFICIENT_FUNDS",

  // ROLLBACK de um crédito deixaria o saldo negativo.
  ReversalInsufficientFunds = "REVERSAL_INSUFFICIENT_FUNDS",

  // A moeda da transação não é a moeda da carteira (ex.: aposta em USD numa carteira BRL)
  CurrencyMismatch = "CURRENCY_MISMATCH",

  // O playerId da transação não é o dono da carteira
  WalletPlayerMismatch = "WALLET_PLAYER_MISMATCH",

  // REFUND/ROLLBACK apontam para uma transação que nunca chegou (depois de esgotar as tentativas)
  ReferenceNotFound = "REFERENCE_NOT_FOUND",

  // A referência existe, mas é de outro jogador, carteira, rodada ou moeda
  ReferenceMismatch = "REFERENCE_MISMATCH",

  // Tipo de referência não permitido (ex.: REFUND apontando para um WIN; REFUND só pode apontar para BET)
  InvalidReferenceKind = "INVALID_REFERENCE_KIND",

  // A referência existe, mas foi rejeitada ou falhou, então não há o que reverter
  ReferenceNotProcessed = "REFERENCE_NOT_PROCESSED",

  // A referência já foi revertida antes (não pode reverter duas vezes)
  ReferenceAlreadyReversed = "REFERENCE_ALREADY_REVERSED",

  // O valor do REFUND/ROLLBACK é diferente do valor da transação original
  AmountMismatch = "AMOUNT_MISMATCH",
}
