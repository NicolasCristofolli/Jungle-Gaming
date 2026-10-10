import type { EntityManager } from '@mikro-orm/postgresql';

export interface OutboxEvent {
  aggregateId: string;
  eventType: string;
  correlationId: string;
  data: Record<string, unknown>;
}

export class OutboxRepository {
  async add(em: EntityManager, event: OutboxEvent, now: Date): Promise<void> {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      correlationId: event.correlationId,
      occurredAt: now.toISOString(),
      version: 1,
      data: event.data,
    };
    await em.execute(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, next_attempt_at)
       VALUES (?, ?, ?, ?::jsonb, ?, ?)`,
      [eventId, event.aggregateId, event.eventType, JSON.stringify(payload), now, now],
    );
  }
}
