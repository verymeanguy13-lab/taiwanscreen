'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

interface ScannerResult {
  symbol: string
  signalType: string
  signalDate: string
  score: number
  price: number
  changePercent: number
  volume: number
}

interface ScannerResponse {
  results: ScannerResult[]
  total: number
  date: string | null
}

// Format a YYYY-MM-DD date string to "2026/06/26 收盤" for display
function formatDataDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  const d = new Date(isoDate + 'T00:00:00')
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day} 收盤`
}

export default function RankingsClient() {
  const t = useTranslations('rankings')
  const [data, setData]       = useState<ScannerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [page, setPage]       = useState(0)
  const pageSize = 50

  useEffect(() => {
    setLoading(true)
    fetch(`/api/kline/scanner?limit=${pageSize}&offset=${page * pageSize}`)
      .then(r => r.json())
      .then((json: ScannerResponse) => {
        setData(json)
        setLoading(false)
      })
      .catch(e => {
        setError(String(e))
        setLoading(false)
      })
  }, [page])

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <div className="space-y-4">

      {/* ── Data freshness label ── */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        <span>
          資料截至{' '}
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {loading ? '載入中…' : formatDataDate(data?.date ?? null)}
          </span>
        </span>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          載入失敗：{error}
        </div>
      )}

      {/* ── Results table ── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 text-left">
              <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-300">股票</th>
              <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-300">訊號</th>
              <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-300 text-right">分數</th>
              <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-300 text-right">收盤價</th>
              <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-300 text-right">漲跌幅</th>
              <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-300 text-right">成交量(張)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 rounded bg-gray-200 dark:bg-gray-700" />
                      </td>
                    ))}
                  </tr>
                ))
              : data?.results.map((row, i) => {
                  const up = row.changePercent >= 0
                  return (
                    <tr
                      key={`${row.symbol}-${i}`}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/zh/stock/${row.symbol}`}
                          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {row.symbol}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:text-yellow-300">
                          {row.signalType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {row.score}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.price.toFixed(2)}
                      </td>
                      {/* Taiwan color convention: red = up, green = down */}
                      <td className={`px-4 py-3 text-right font-mono font-medium ${
                        up
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-green-600 dark:text-green-400'
                      }`}>
                        {up ? '+' : ''}{row.changePercent.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-400">
                        {row.volume.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            共 {data?.total ?? 0} 筆 · 第 {page + 1} / {totalPages} 頁
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              ← 上一頁
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              下一頁 →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
