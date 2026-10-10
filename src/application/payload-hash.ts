import { createHash } from 'node:crypto';

/**
 * JSON canônico: chaves ordenadas em todos os níveis.
 * {"b":1,"a":2} e {"a":2,"b":1} geram o MESMO texto, logo o mesmo hash.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

/** SHA-256 (hex) do JSON canônico dos campos de negócio. Header e metadados NÃO entram. */
export function computePayloadHash(businessFields: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(businessFields))).digest('hex');
}
