// =============================================================================
// lib/db.ts — Neon PostgreSQL client
// =============================================================================

import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL!);

// Typed wrapper for static template literal queries
export async function query<T>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const rows = await sql(strings, ...values);
  return rows as T[];
}

// For dynamically built SQL strings — uses sql() with parameters array
export async function queryUnsafe<T>(
  sqlString: string,
  params: unknown[] = [],
): Promise<T[]> {
  // Build a tagged template call dynamically by splitting on $1, $2, etc.
  const parts = sqlString.split(/\$\d+/);
  const strings = Object.assign(parts, { raw: parts }) as TemplateStringsArray;
  const rows = await sql(strings, ...params);
  return rows as T[];
}

// Returns the most recent date in any date-keyed table
export async function getLatestDate(tableName: string): Promise<string> {
  try {
    const rows = await sql`SELECT MAX(date) AS max FROM ${sql(tableName)}`;
    return (rows[0]?.max as string) ?? new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}