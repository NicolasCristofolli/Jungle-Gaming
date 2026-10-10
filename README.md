# Distributed Wagering Processor

Serviço de carteira e processamento de apostas — desafio técnico Jungle Gaming.

Stack: Bun · TypeScript (strict) · NestJS · PostgreSQL · MikroORM · LocalStack (SQS) · Docker Compose.

## Pré-requisitos

- Docker + Docker Compose
- Bun 1.x

## Como rodar

```bash
bun install
docker compose up -d          # Postgres (porta 5433) + LocalStack (4566)
bun run migrate               # cria as tabelas e constraints
bun run start                 # API em http://localhost:3000
```

## Testes

```bash
bun run test:unit           # domínio (Money, Wallet, Ledger, WagerTransaction)
bun run test:concurrency    # concorrência real no Postgres (banco wagering_test)
bun test                    # tudo
```

Os testes de concorrência usam um banco real (sem mocks) e verificam, em todos os cenários,
que `saldo da wallet == saldo reconstruído pelo ledger`.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health/live` | processo vivo |
| POST | `/wallets` | cria wallet (saldo inicial gera transação OPENING + lançamento no ledger) |
| GET | `/wallets/:walletId` | consulta saldo e versão |
| POST | `/wagering/transactions` | submete BET / WIN / LOSS (header `Idempotency-Key` obrigatório) |

### Exemplos

```bash
# criar wallet
curl -X POST localhost:3000/wallets -H 'Content-Type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'

# apostar (troque WALLET_ID)
curl -X POST localhost:3000/wagering/transactions -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:tx-1' \
  -d '{"providerId":"provider-a","externalTransactionId":"tx-1","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"WALLET_ID","roundId":"round-1","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

### Status HTTP

| Situação | Status |
| --- | --- |
| transação processada | 201 |
| replay idêntico (`idempotentReplay: true`) | 200 |
| aceita, aguardando referência | 202 |
| payload inválido / sem `Idempotency-Key` | 400 |
| wallet não encontrada | 404 |
| mesma key com payload diferente / wallet duplicada | 409 |
| rejeitada por regra de negócio (com `failureCode`) | 422 |
| falha transitória de infraestrutura | 503 + `Retry-After` |

## Estrutura

```
src/
  domain/           regras de negócio puras (sem Nest, sem ORM)
  application/      use cases
  infrastructure/   HTTP, persistência (SQL + migrations), observabilidade
test/
  unit/             testes do domínio
  concurrency/      testes de concorrência em Postgres real
```

Decisões técnicas, trade-offs e limitações: ver [ARCHITECTURE.md](./ARCHITECTURE.md).