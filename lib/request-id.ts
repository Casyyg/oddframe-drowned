/** Event deduplication IDs must also work on a phone's plain-HTTP LAN preview. */
export function createRequestId(random: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  const bytes = new Uint8Array(16);
  try {
    random.getRandomValues(bytes);
  } catch {
    throw new Error('Could not prepare your action. Please retry.');
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Assign once, inside the caller's save/retry boundary; never replace an ID on retry. */
export function prepareEvent<T extends { requestId?: unknown }>(event: T, random?: Pick<Crypto, 'getRandomValues'>): T {
  event.requestId ??= createRequestId(random);
  return event;
}
