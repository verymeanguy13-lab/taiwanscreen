// =============================================================================
// lib/cache.ts — Cache passthrough
//
// Cache passthrough — no external cache at launch.
// To add Upstash Redis later:
//   1. Run: npm install @upstash/redis
//   2. Replace this file's implementation with the Redis version
//   3. No other files need to change
// =============================================================================

export async function cached<T>(
  _key: string,
  _ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}