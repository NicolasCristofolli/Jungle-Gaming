# ARCHITECTURE

Este documento descreve as decisões técnicas, os trade-offs e as limitações conhecidas da solução.

## 1. Visão geral

O serviço mantém wallets de jogadores e processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) enviadas por provedores de jogos.

Fluxo de uma transação:

```
HTTP (controller) → valida payload (zod) → use case
  → abre transação SQL
  → SELECT ... FOR UPDATE na wallet          (serializa operações da MESMA wallet)
  → checa idempotência (replay ou conflito)
  → aplica regras no domínio (Wallet / WagerTransaction)
  → grava transação + lançamento no ledger + wallet + eventos na outbox
  → COMMIT (ou ROLLBACK de tudo)
```

Prioridade da implementação: correção financeira, concorrência e idempotência primeiro (são as falhas eliminatórias), com testes contra Postgres real. Mensageria e observabilidade ficaram parcialmente implementadas (ver seção 10).

## 2. Camadas

| Camada | Pasta | Responsabilidade | Depende de |
| --- | --- | --- | --- |
| Domínio | `src/domain` | regras de negócio e invariantes | nada (TypeScript puro + `decimal.js`) |
| Aplicação | `src/application` | orquestra um caso de uso dentro de uma transação | domínio + repositórios |
| Infraestrutura | `src/infrastructure` | HTTP, SQL, migrations, módulos do Nest | aplicação e domínio |

- O domínio não importa NestJS nem MikroORM. Isso permite testá-lo em milissegundos, sem banco.
- Os use cases não usam decorators do Nest. Quem os instancia é o `DatabaseModule` (`useFactory`), então a aplicação não conhece o framework.
- Os controllers são finos: validam o payload, chamam o use case e traduzem o resultado em status HTTP. O mesmo use case pode ser reutilizado pelo consumidor SQS.

Modelagem do domínio:

- Construtores `private` + factories estáticas (`create`, `open`, `from`, `rehydrate`). `rehydrate` reconstrói estado persistido sem revalidar regras.
- `Wallet.debit()` / `credit()` **devolvem** o `WalletLedgerEntry`: não existe forma de mudar o saldo sem produzir o lançamento correspondente.
- A ordem dentro de `debit/credit` é: validar, criar o lançamento, só então mudar o estado. Uma operação rejeitada não deixa a wallet em estado intermediário (coberto por teste).
- `WalletLedgerEntry` é imutável estruturalmente (só campos `readonly`, sem métodos de transição) e valida a aritmética na criação (`balanceBefore ± money === balanceAfter`).

## 3. Dinheiro

- `Money` encapsula um `Decimal` (`decimal.js`) + moeda ISO-4217. É imutável: toda operação devolve uma nova instância.
- `number` nunca é usado para dinheiro: ponto flutuante binário não representa decimais com exatidão (`0.1 + 0.2 = 0.30000000000000004`). Há teste cobrindo esse caso.
- Entrada aceita apenas string no formato `^\d+\.\d{2}$` (escala fixa de 2 casas). Rejeita vazio, `NaN`, `Infinity`, notação científica, negativos e mais de 2 casas. Não há arredondamento silencioso.
- Operações entre moedas diferentes lançam `CurrencyMismatchError`. `equals` entre moedas diferentes devolve `false` (é uma pergunta com resposta válida, não um erro).
- No banco: `numeric(20,2)` + coluna de moeda. O driver devolve `numeric` como string, que é convertida direto para `Money` (nunca passa por `number`).
- O modelo é multi-moeda; o desafio usa apenas `BRL`.

## 4. Concorrência

**Estratégia: lock pessimista por wallet (`SELECT ... FOR UPDATE`) dentro de `em.transactional()`, isolamento READ COMMITTED.**

- A unidade de concorrência é a wallet. Duas operações na mesma wallet são serializadas pelo Postgres; wallets diferentes não se bloqueiam (sem lock global).
- O lock vive no banco, então funciona com qualquer número de instâncias da aplicação.
- Defesa em profundidade: o `UPDATE` da wallet usa `WHERE id = ? AND version = ?`. Se um dia alguém remover o lock, o update falha em vez de sobrescrever silenciosamente.
- Experimento: removendo o `FOR UPDATE`, os testes de concorrência falham com "lost update detectado". Com o lock, passam de forma estável.
- Ordem de locks: sempre wallet primeiro, depois transação. Mantida em todo o código para evitar deadlocks.

Alternativas consideradas:

| Alternativa | Por que não |
| --- | --- |
| Lock otimista (`version`) + retry | em wallet "quente" (muitas apostas seguidas) gera retries em cascata; o pessimista simplesmente enfileira |
| `UPDATE ... SET balance = balance - x WHERE balance >= x` | resolve o saldo, mas ainda preciso do `balanceBefore` para o ledger e de checar idempotência/referências de forma consistente |
| SERIALIZABLE | exige tratar falhas de serialização com retry em todo lugar; o lock explícito é mais previsível |
| Ordenação/dedup do SQS FIFO | é otimização, não garantia (restrição 3); o banco é responsável pelas invariantes |

Trade-off: operações da mesma wallet são sequenciais, então o throughput de uma única wallet é limitado pela duração da transação. Para wallets muito quentes, uma evolução seria processar em lotes ou particionar o consumo por wallet (`MessageGroupId = walletId`).

## 5. Idempotência

- `Idempotency-Key` é obrigatório (400 se ausente) e é a fonte da verdade.
- Persistência: `UNIQUE (idempotency_key)` e `UNIQUE (provider_id, external_transaction_id)` em `wager_transactions`. Nada em memória.
- `payloadHash` = SHA-256 (hex) do JSON canônico (chaves ordenadas recursivamente) dos campos de negócio: `providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind, money, referenceExternalTransactionId`. Header e metadados de transporte não entram.
- Mesma key + mesmo hash → **replay**: devolve o resultado original, inclusive o saldo daquele momento (`balance_after` gravado na transação), com `idempotentReplay: true` e HTTP 200.
- Mesma key + hash diferente → **conflito** (HTTP 409), sem efeito.
- A checagem acontece **depois** de travar a wallet: as 50 cópias concorrentes da mesma aposta passam uma por vez; a primeira grava e as outras 49 viram replay.
- Rede de segurança: se duas requisições iguais não se bloquearem (ex.: `walletId` diferentes) e colidirem no `UNIQUE`, o use case captura a violação e roda de novo, caindo no caminho de replay ou conflito.

## 6. Garantias no schema

As invariantes são aplicadas no banco, não só no código:

| Regra | Implementação |
| --- | --- |
| saldo nunca negativo | `CHECK (balance >= 0)` |
| uma wallet por player + moeda | `UNIQUE (player_id, currency)` |
| idempotência | `UNIQUE (idempotency_key)`, `UNIQUE (provider_id, external_transaction_id)` |
| REFUND/ROLLBACK exigem referência | `CHECK` |
| rejeição sempre tem motivo | `CHECK (status NOT IN ('REJECTED','FAILED') OR failure_code IS NOT NULL)` |
| reversão única por tipo | índice único parcial `(reference_transaction_id, kind) WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')` |
| aritmética do ledger | `CHECK (balance_after = balance_before ± amount)` |
| um lançamento por transação/wallet | `UNIQUE (transaction_id, wallet_id)` |
| ledger imutável | trigger `BEFORE UPDATE OR DELETE` que lança exceção |
| inbox sem duplicata | `PRIMARY KEY (consumer_name, message_id)` |
| paginação estável do ledger | coluna `seq` (identity) |

Migrations versionadas e reversíveis (`bun run migrate` / `bun run migrate:down`).

Interpretação documentada: a regra 4 diz "não pode ser revertida duas vezes **pelo mesmo tipo**". Segui a letra (índice por `reference_transaction_id + kind`). A alternativa mais conservadora seria permitir uma única reversão por referência, de qualquer tipo.

## 7. ORM e estratégia transacional

- MikroORM (preferencial no enunciado) gerencia conexão, pool, migrations e a transação (`em.fork().transactional(...)`).
- As queries críticas são SQL explícito nos repositórios. O `FOR UPDATE` fica visível no código e o controle de concorrência é auditável.
- Trade-off: abro mão do Unit of Work/Identity Map do MikroORM nessas operações em troca de previsibilidade do SQL emitido.
- Mapeamento do `Money`: duas colunas (`amount numeric(20,2)` + `currency char(3)`), reidratadas via `Money.from`.

## 8. Estados e códigos de falha

Máquina de estados da `WagerTransaction`:

```
PENDING → PROCESSED | REJECTED | FAILED | PENDING_REFERENCE
PENDING_REFERENCE → PROCESSED | REJECTED | FAILED
PROCESSED, REJECTED, FAILED → (terminais: qualquer transição lança InvalidTransactionStateError)
```

- `OPENING` é interno: só pode ser criado por `WagerTransaction.createOpening()`. A factory pública `create()` recusa esse tipo.
- `LOSS` é processado sem mexer no saldo e sem lançamento no ledger.

`failureCode`:

| Código | Quando | Provedor deve |
| --- | --- | --- |
| `INSUFFICIENT_FUNDS` | BET maior que o saldo | desistir |
| `REVERSAL_INSUFFICIENT_FUNDS` | reversão deixaria saldo negativo | escalar para operação manual |
| `CURRENCY_MISMATCH` | moeda difere da wallet | corrigir payload |
| `WALLET_PLAYER_MISMATCH` | player não é dono da wallet | corrigir payload |
| `REFERENCE_NOT_FOUND` | referência não chegou no prazo | desistir ou reenviar a original |
| `REFERENCE_MISMATCH` | referência de outro player/wallet/rodada/moeda | corrigir payload |
| `INVALID_REFERENCE_KIND` | tipo de referência não permitido | corrigir payload |
| `REFERENCE_NOT_PROCESSED` | referência rejeitada ou falhou | desistir |
| `REFERENCE_ALREADY_REVERSED` | já revertida | desistir |
| `AMOUNT_MISMATCH` | valor ≠ valor da referência | corrigir payload |

Status HTTP: 201 processada, 200 replay, 202 pendente, 400 payload inválido, 404 não encontrada, 409 conflito, 422 rejeição de negócio, 503 + `Retry-After` falha transitória.

## 9. Autenticação

Não implementada: não pontua e competiria com correção financeira e concorrência. Desenho proposto: Keycloak via Docker Compose, provedores autenticam com OIDC client credentials, um `AuthGuard` valida o JWT e expõe o `providerId` do token, que deve bater com o `providerId` do payload. Health checks ficam abertos; mensagens da fila são canal interno.

## 10. Limitações conhecidas e próximos passos

| Limitação | Como resolveria |
| --- | --- |
| REFUND/ROLLBACK ficam `PENDING_REFERENCE` (resolução da referência não implementada) | resolver por `(providerId, referenceExternalTransactionId)`, validar regras 2–5, aplicar crédito/débito inverso; worker agendado com backoff exponencial e limite de tentativas → `REFERENCE_NOT_FOUND` |
| Eventos gravados na outbox, mas sem publisher | worker com `SELECT ... FOR UPDATE SKIP LOCKED` em lotes, publica no SQS e marca `published_at`; falha → `attempts++` e `next_attempt_at` com backoff. At-least-once: consumidores deduplicam por `eventId` |
| Sem consumidor SQS | long polling, mesmo use case, inbox `(consumer_name, message_id)` na mesma transação, `DeleteMessage` só após commit; erro de negócio → ack, transitório → `ChangeMessageVisibility` com backoff, permanente → DLQ; SIGTERM devolve a visibilidade das mensagens não iniciadas |
| Sem logs estruturados nem métricas | `pino` (JSON com `correlationId`, `transactionId`, `walletId`) e `prom-client` em `/metrics` |
| Sem `/health/ready`, reconciliação e ledger paginado | `SELECT 1` + `GetQueueUrl`; soma do ledger vs saldo sem correção automática (loga + métrica); cursor opaco sobre `seq` |
| Testes com 3+ instâncias e crash recovery | subir 3 processos com `Bun.spawn` e disparar requisições alternando portas |

## 11. Ambiente

- LocalStack fixado na versão 4.12: as imagens recentes exigem auth token, o que quebraria o `docker compose up` do avaliador.
- Postgres exposto na porta 5433 do host para não conflitar com instalações locais na 5432.

## 12. Criação

Usei o Claude como apoio durante o desafio, principalmente porque não tenho tanta experiência com TypeScript e principalmente com uma criação tão completa de arquitetura e o prazo era curto.

**Escrito por mim, com orientação e revisão da IA:**
- Todo o domínio (`Money`, `Wallet`, `WalletLedgerEntry`, `WagerTransaction`, `FailureCode`)
  e os testes unitários correspondentes
- Os controllers HTTP

**Gerado pela IA, revisado, executado e testado por mim:**
- Infraestrutura: `docker-compose`, migration e repositórios SQL
- Use cases de criação de wallet e de submissão de transação
- Testes de concorrência contra Postgres real
- Rascunho deste documento, que reescrevi com minhas palavras

Optei por escrever o domínio eu mesmo porque é onde estão as regras de negócio e as
invariantes, e eu queria entendê-las a fundo. A infraestrutura foi delegada para caber no
prazo, priorizando o que o enunciado trata como crítico: correção financeira, concorrência
e idempotência.