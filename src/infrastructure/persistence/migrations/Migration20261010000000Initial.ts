import { Migration } from '@mikro-orm/migrations';

export class Migration20261010000000Initial extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
-- ============ wallets ============
CREATE TABLE wallets (
  id          uuid PRIMARY KEY,
  player_id   uuid          NOT NULL,
  currency    char(3)       NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  balance     numeric(20,2) NOT NULL CHECK (balance >= 0),
  version     integer       NOT NULL CHECK (version >= 1),
  created_at  timestamptz   NOT NULL,
  updated_at  timestamptz   NOT NULL,
  CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency)
);

-- ============ wager_transactions ============
CREATE TABLE wager_transactions (
  id                                 uuid PRIMARY KEY,
  provider_id                        text          NOT NULL,
  external_transaction_id            text          NOT NULL,
  idempotency_key                    text          NOT NULL,
  payload_hash                       char(64)      NOT NULL,
  wallet_id                          uuid          NOT NULL REFERENCES wallets(id),
  player_id                          uuid          NOT NULL,
  round_id                           text          NOT NULL,
  game_id                            text          NOT NULL,
  kind                               text          NOT NULL
    CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
  amount                             numeric(20,2) NOT NULL CHECK (amount >= 0),
  currency                           char(3)       NOT NULL,
  reference_external_transaction_id  text,
  reference_transaction_id           uuid REFERENCES wager_transactions(id),
  status                             text          NOT NULL
    CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
  failure_code                       text,
  balance_after                      numeric(20,2),
  retry_attempts                     integer       NOT NULL DEFAULT 0,
  next_retry_at                      timestamptz,
  created_at                         timestamptz   NOT NULL,
  processed_at                       timestamptz,

  CONSTRAINT uq_tx_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT uq_tx_provider_external UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT ck_tx_reference_required
    CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
  CONSTRAINT ck_tx_failure_code_when_rejected
    CHECK (status NOT IN ('REJECTED','FAILED') OR failure_code IS NOT NULL)
);

-- uma referência não pode ser revertida duas vezes pelo mesmo tipo
CREATE UNIQUE INDEX uq_tx_single_reversal
  ON wager_transactions (reference_transaction_id, kind)
  WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK');

-- o worker de pendências encontra rápido o que reprocessar
CREATE INDEX ix_tx_pending_reference
  ON wager_transactions (next_retry_at)
  WHERE status = 'PENDING_REFERENCE';

-- ============ wallet_ledger_entries ============
CREATE TABLE wallet_ledger_entries (
  id              uuid PRIMARY KEY,
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  wallet_id       uuid          NOT NULL REFERENCES wallets(id),
  transaction_id  uuid          NOT NULL REFERENCES wager_transactions(id),
  direction       text          NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount          numeric(20,2) NOT NULL CHECK (amount > 0),
  currency        char(3)       NOT NULL,
  balance_before  numeric(20,2) NOT NULL CHECK (balance_before >= 0),
  balance_after   numeric(20,2) NOT NULL CHECK (balance_after >= 0),
  created_at      timestamptz   NOT NULL,

  CONSTRAINT uq_ledger_seq UNIQUE (seq),
  CONSTRAINT uq_ledger_tx_wallet UNIQUE (transaction_id, wallet_id),
  CONSTRAINT ck_ledger_arithmetic CHECK (
    (direction = 'CREDIT' AND balance_after = balance_before + amount) OR
    (direction = 'DEBIT'  AND balance_after = balance_before - amount)
  )
);

CREATE INDEX ix_ledger_wallet_seq ON wallet_ledger_entries (wallet_id, seq);

-- ledger imutável: bloqueia UPDATE e DELETE no próprio banco
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_entries is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_immutable
  BEFORE UPDATE OR DELETE ON wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- ============ inbox_messages ============
CREATE TABLE inbox_messages (
  consumer_name  text        NOT NULL,
  message_id     text        NOT NULL,
  payload_hash   char(64)    NOT NULL,
  received_at    timestamptz NOT NULL,
  processed_at   timestamptz,
  PRIMARY KEY (consumer_name, message_id)
);

-- ============ outbox_messages ============
CREATE TABLE outbox_messages (
  id               uuid PRIMARY KEY,
  aggregate_id     uuid        NOT NULL,
  event_type       text        NOT NULL,
  payload          jsonb       NOT NULL,
  occurred_at      timestamptz NOT NULL,
  attempts         integer     NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL,
  published_at     timestamptz
);

CREATE INDEX ix_outbox_pending
  ON outbox_messages (next_attempt_at)
  WHERE published_at IS NULL;
`);
  }

  override async down(): Promise<void> {
    this.addSql(`
DROP TABLE IF EXISTS outbox_messages;
DROP TABLE IF EXISTS inbox_messages;
DROP TRIGGER IF EXISTS trg_ledger_immutable ON wallet_ledger_entries;
DROP TABLE IF EXISTS wallet_ledger_entries;
DROP FUNCTION IF EXISTS forbid_ledger_mutation();
DROP TABLE IF EXISTS wager_transactions;
DROP TABLE IF EXISTS wallets;
`);
  }
}
