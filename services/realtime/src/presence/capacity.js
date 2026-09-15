export const CONNECTION_LIMIT = 100
export function hasCapacity(count) { return count < CONNECTION_LIMIT }
