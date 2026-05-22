// =============================================================================
// lib/broker-parser.ts — TWSE 券商分點 (broker branch) data parser
//
// IMPORTANT: TWSE files may be encoded in Big5 (traditional Chinese encoding).
// When downloading in Node.js, decode before passing to these functions:
//
//   const text = new TextDecoder('big5').decode(buffer)
//   // or:
//   const text = Buffer.from(arrayBuffer).toString('big5')
//
// Both parsers below expect a plain UTF-8/decoded string as input.
// =============================================================================

export interface BrokerFlowRow {
  symbol:      string;
  broker_id:   string;
  broker_name: string;
  buy_volume:  number; // in shares (not lots/張)
  sell_volume: number;
  net_volume:  number; // buy - sell
}

// -----------------------------------------------------------------------------
// Helper: parse a number string — remove commas, return 0 on failure
// -----------------------------------------------------------------------------
function parseVolume(raw: string): number {
  if (!raw) return 0;
  return parseInt(raw.replace(/,/g, '').trim(), 10) || 0;
}

// -----------------------------------------------------------------------------
// parseBrokerFlowText
//
// Parses the TWSE fixed-width / space-delimited text format.
//
// The file is structured in stock blocks:
//
//   [stock code] [stock name]          ← stock header line
//   [broker_id] [broker_name] [buy] [sell]
//   [broker_id] [broker_name] [buy] [sell]
//   ...                                ← blank line or next stock header
//
// Detection strategy:
//   - A line is a STOCK HEADER if its first token is 4–6 digits
//     AND the second token is not purely numeric (it's a name, not a broker ID).
//     Broker IDs are also numeric, so we disambiguate by checking whether
//     the 3rd and 4th tokens (buy/sell) are present.
//   - A line is a DATA ROW if it has at least 4 tokens and the first token
//     looks like a broker ID (up to 4 digits, often with leading zeros).
//
// The exact format may vary — check the raw TWSE file and adjust the
// parsing logic if the output looks wrong.
// -----------------------------------------------------------------------------

export function parseBrokerFlowText(text: string, date: string): BrokerFlowRow[] {
  const results: BrokerFlowRow[] = [];
  let currentSymbol = '';

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    // Collapse multiple spaces/tabs into single space, trim edges
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const tokens = line.split(' ');

    // ── Detect stock header line ──────────────────────────────────────────
    // Pattern: [4–6 digit code] [name string] (only 2 meaningful tokens,
    // or the 3rd token is not a large number like a buy volume)
    //
    // We consider it a header if:
    //   - token[0] is a 4–6 digit stock code
    //   - token[1] exists and is non-empty
    //   - there are fewer than 4 tokens (no buy/sell columns)
    //     OR the line clearly has no numeric buy/sell fields
    if (
      /^\d{4,6}$/.test(tokens[0]) &&
      tokens.length >= 2 &&
      tokens.length < 4
    ) {
      currentSymbol = tokens[0];
      continue;
    }

    // ── Detect data row ───────────────────────────────────────────────────
    // Pattern: [broker_id] [broker_name...] [buy_volume] [sell_volume]
    // Broker IDs are typically 4 digits (e.g. "1020", "9200").
    // Buy and sell volumes are the last two numeric tokens.
    if (!currentSymbol) continue; // no stock context yet

    if (tokens.length >= 4 && /^\d{3,4}$/.test(tokens[0])) {
      const broker_id = tokens[0];

      // The last two tokens are buy and sell volumes
      const sell_volume = parseVolume(tokens[tokens.length - 1]);
      const buy_volume  = parseVolume(tokens[tokens.length - 2]);

      // Everything between broker_id and the two volume columns is the name
      const broker_name = tokens.slice(1, tokens.length - 2).join(' ').trim();

      // Skip rows where both volumes are zero — no activity
      if (buy_volume === 0 && sell_volume === 0) continue;

      results.push({
        symbol:      currentSymbol,
        broker_id,
        broker_name,
        buy_volume,
        sell_volume,
        net_volume:  buy_volume - sell_volume,
      });
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// parseBrokerCSV
//
// Alternative parser for CSV format (some TWSE downloads arrive as CSV).
//
// Expected column order (first row is a header — skip it):
//   symbol, broker_id, broker_name, buy_volume, sell_volume
//
// Handles:
//   - Quoted fields (e.g. "券商名稱")
//   - Comma-separated numbers with or without commas inside quotes
//   - Windows-style line endings (\r\n)
// -----------------------------------------------------------------------------

export function parseBrokerCSV(csvText: string, date: string): BrokerFlowRow[] {
  const results: BrokerFlowRow[] = [];

  const lines = csvText.split(/\r?\n/);

  // Skip header row (index 0)
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    // Split on commas, respecting quoted fields
    const tokens = splitCSVLine(raw);
    if (tokens.length < 5) continue;

    const symbol      = tokens[0].trim();
    const broker_id   = tokens[1].trim();
    const broker_name = tokens[2].trim();
    const buy_volume  = parseVolume(tokens[3]);
    const sell_volume = parseVolume(tokens[4]);

    // Skip header-like rows and rows with no valid symbol
    if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;
    // Skip rows with zero activity
    if (buy_volume === 0 && sell_volume === 0) continue;

    results.push({
      symbol,
      broker_id,
      broker_name,
      buy_volume,
      sell_volume,
      net_volume: buy_volume - sell_volume,
    });
  }

  return results;
}

// -----------------------------------------------------------------------------
// splitCSVLine — handles quoted fields containing commas
// -----------------------------------------------------------------------------
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // Toggle quoted mode; handle escaped double-quotes ("")
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current); // push last field
  return result;
}