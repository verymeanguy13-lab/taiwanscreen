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

// For dynamically built SQL strings
export async function queryUnsafe<T>(
  sqlString: string,
  params: unknown[] = [],
): Promise<T[]> {
  const parts = sqlString.split(/\$\d+/);
  const strings = Object.assign(parts, { raw: parts }) as TemplateStringsArray;
  const rows = await sql(strings, ...params);
  return rows as T[];
}

// Returns the most recent date in any date-keyed table
export async function getLatestDate(tableName: string): Promise<string> {
  try {
    const rows = await queryUnsafe<{ max: string | null }>(
      `SELECT MAX(date) AS max FROM ${tableName}`,
      [],
    );
    return rows[0]?.max ?? new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}