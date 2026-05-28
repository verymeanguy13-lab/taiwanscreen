// =============================================================================
// lib/db.ts — Neon PostgreSQL client
// =============================================================================

import { neon, neonConfig, types } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

// Tell the Neon driver to return numeric types as JS numbers, not strings
// OIDs: 700=float4, 701=float8, 1700=numeric, 20=int8, 21=int2, 23=int4
const parseNumber = (val: string) => parseFloat(val);
const parseInt_   = (val: string) => parseInt(val, 10);
types.setTypeParser(700,  parseNumber);
types.setTypeParser(701,  parseNumber);
types.setTypeParser(1700, parseNumber);
types.setTypeParser(20,   parseInt_);
types.setTypeParser(21,   parseInt_);
types.setTypeParser(23,   parseInt_);

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
  const rows = await sql.query(sqlString, params);
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