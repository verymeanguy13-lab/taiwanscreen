// =============================================================================
// lib/ptt.ts — PTT Stock board scraper
// =============================================================================

import { queryUnsafe } from '@/lib/db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PTTPost {
  title:      string;
  push_count: number;
  boo_count:  number;
  url:        string;
  date:       string;
}

export interface StockMention {
  symbol:        string;
  mention_count: number;
  sentiment_score: number;  // -1.0 to 1.0
  bullish_count: number;
  bearish_count: number;
  sample_titles: string[];  // up to 3
}

// ── Stock name → symbol lookup (top 50 Taiwan stocks) ────────────────────────

const NAME_TO_SYMBOL: Record<string, string> = {
  '台積電': '2330', 'TSMC': '2330',
  '鴻海':   '2317', '富士康': '2317',
  '聯發科': '2454',
  '台達電': '2308',
  '廣達':   '2382',
  '日月光': '3711',
  '聯電':   '2303',
  '南亞':   '1303',
  '台塑':   '1301',
  '中華電': '2412',
  '中鋼':   '2002',
  '兆豐金': '2886',
  '富邦金': '2881',
  '國泰金': '2882',
  '玉山金': '2884',
  '第一金': '2892',
  '合庫金': '5880',
  '華南金': '2880',
  '彰銀':   '2801',
  '台新金': '2887',
  '永豐金': '2890',
  '遠傳':   '4904',
  '台灣大': '3045',
  '統一':   '1216',
  '大立光': '3008',
  '研華':   '2395',
  '台灣50': '0050',
  '元大台灣50': '0050',
  '0050':   '0050',
  '高股息': '0056',
  '元大高股息': '0056',
  '0056':   '0056',
  '瑞昱':   '2379',
  '威盛':   '2388',
  '奇鋐':   '3017',
  '緯創':   '3231',
  '仁寶':   '2324',
  '英業達': '2356',
  '和碩':   '4938',
  '微星':   '2377',
  '華碩':   '2357',
  '宏碁':   '2353',
  '宏達電': '2498',
  '友達':   '2409',
  '群創':   '3481',
  '力積電': '6770',
  '世界先進': '5347',
  '欣興':   '3037',
  '景碩':   '3189',
  '台光電': '2383',
};

// ── Fetch PTT posts ───────────────────────────────────────────────────────────

export async function fetchPTTPosts(pages: number = 3): Promise<PTTPost[]> {
  const allPosts: PTTPost[] = [];

  try {
    // Get the index page first to find the latest page number
    const indexRes = await fetch('https://www.ptt.cc/bbs/Stock/index.html', {
      headers: { Cookie: 'over18=1' },
    });
    if (!indexRes.ok) return [];

    const indexHtml = await indexRes.text();

    // Extract latest page number from "上頁" link: index[N].html
    const prevMatch = indexHtml.match(/href="\/bbs\/Stock\/index(\d+)\.html"[^>]*>‹/);
    const latestPage = prevMatch ? parseInt(prevMatch[1], 10) + 1 : 3000;

    // Fetch the last N pages
    for (let i = 0; i < pages; i++) {
      const pageNum = latestPage - i;
      if (pageNum < 1) break;

      try {
        const res = await fetch(`https://www.ptt.cc/bbs/Stock/index${pageNum}.html`, {
          headers: { Cookie: 'over18=1' },
        });
        if (!res.ok) continue;

        const html = await res.text();
        const posts = parsePTTPage(html);
        allPosts.push(...posts);

        // Small delay to be polite
        await new Promise(r => setTimeout(r, 200));
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return allPosts;
}

// ── Parse a PTT page ──────────────────────────────────────────────────────────

function parsePTTPage(html: string): PTTPost[] {
  const posts: PTTPost[] = [];

  // Match each post entry block
  const entryRegex = /<div class="r-ent">([\s\S]*?)<\/div>\s*<\/div>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract push count (nrec)
    const nrecMatch = block.match(/<div class="nrec"><span[^>]*>([^<]*)<\/span>/);
    const nrecRaw   = nrecMatch?.[1]?.trim() ?? '0';
    let push_count  = 0;
    let boo_count   = 0;

    if (nrecRaw === '爆') {
      push_count = 100;
    } else if (nrecRaw.startsWith('X')) {
      boo_count = parseInt(nrecRaw.slice(1), 10) || 10;
    } else {
      const n = parseInt(nrecRaw, 10);
      if (!isNaN(n) && n > 0) push_count = n;
      else if (!isNaN(n) && n < 0) boo_count = Math.abs(n);
    }

    // Extract title and URL
    const titleMatch = block.match(/<a href="(\/bbs\/Stock\/[^"]+)"[^>]*>([^<]+)<\/a>/);
    if (!titleMatch) continue;

    const url   = `https://www.ptt.cc${titleMatch[1]}`;
    const title = titleMatch[2].trim();

    // Skip deleted posts
    if (!title || title.includes('(本文已被刪除)')) continue;

    // Extract date
    const dateMatch = block.match(/<div class="date">\s*([^<]+)<\/div>/);
    const rawDate   = dateMatch?.[1]?.trim() ?? '';
    const date      = parseDate(rawDate);

    posts.push({ title, push_count, boo_count, url, date });
  }

  return posts;
}

// ── Parse PTT date format (e.g. "5/24") to ISO ───────────────────────────────

function parseDate(raw: string): string {
  try {
    const parts = raw.trim().split('/');
    if (parts.length === 2) {
      const month = parseInt(parts[0], 10);
      const day   = parseInt(parts[1], 10);
      const year  = new Date().getFullYear();
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  } catch { /* ignore */ }
  return new Date().toISOString().slice(0, 10);
}

// ── Extract stock mentions from posts ─────────────────────────────────────────

export function extractMentions(posts: PTTPost[]): StockMention[] {
  const mentionMap = new Map<string, {
    posts:        PTTPost[];
    bullish:      number;
    bearish:      number;
  }>();

  for (const post of posts) {
    const symbols = new Set<string>();

    // Match 4-digit stock codes
    const codeMatches = post.title.matchAll(/\b(\d{4})\b/g);
    for (const m of codeMatches) {
      symbols.add(m[1]);
    }

    // Match stock names
    for (const [name, symbol] of Object.entries(NAME_TO_SYMBOL)) {
      if (post.title.includes(name)) {
        symbols.add(symbol);
      }
    }

    for (const symbol of symbols) {
      if (!mentionMap.has(symbol)) {
        mentionMap.set(symbol, { posts: [], bullish: 0, bearish: 0 });
      }
      const entry = mentionMap.get(symbol)!;
      entry.posts.push(post);
      if (post.push_count > post.boo_count) entry.bullish++;
      else if (post.boo_count > post.push_count) entry.bearish++;
    }
  }

  const results: StockMention[] = [];

  for (const [symbol, entry] of mentionMap.entries()) {
    const totalPush = entry.posts.reduce((s, p) => s + p.push_count, 0);
    const totalBoo  = entry.posts.reduce((s, p) => s + p.boo_count,  0);
    const sentiment = (totalPush - totalBoo) / (totalPush + totalBoo + 1);

    results.push({
      symbol,
      mention_count:   entry.posts.length,
      sentiment_score: parseFloat(sentiment.toFixed(4)),
      bullish_count:   entry.bullish,
      bearish_count:   entry.bearish,
      sample_titles:   entry.posts.slice(0, 3).map(p => p.title),
    });
  }

  // Sort by mention count descending
  return results.sort((a, b) => b.mention_count - a.mention_count);
}

// ── Ingest PTT mentions into DB ───────────────────────────────────────────────

export async function ingestPTTMentions(): Promise<void> {
  try {
    const posts    = await fetchPTTPosts(3);
    const mentions = extractMentions(posts);
    const today    = new Date().toISOString().slice(0, 10);

    for (const m of mentions) {
      try {
        await queryUnsafe(
          `INSERT INTO ptt_mentions (symbol, date, mention_count, sentiment_score)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (symbol, date) DO UPDATE SET
             mention_count   = EXCLUDED.mention_count,
             sentiment_score = EXCLUDED.sentiment_score`,
          [m.symbol, today, m.mention_count, m.sentiment_score],
        );
      } catch {
        // Skip symbols not in stocks table (foreign key constraint)
        continue;
      }
    }

    console.log(`[ptt] Ingested ${mentions.length} stock mentions for ${today}`);
  } catch (err) {
    console.error('[ptt] Ingest error:', err);
  }
}