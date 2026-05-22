export default function Footer() {
  return (
    <footer
      className="w-full py-6 text-center"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      <p
        className="text-xs leading-relaxed"
        style={{ color: 'var(--text-muted)' }}
      >
        資料來源：台灣證券交易所 (TWSE)｜本站資料僅供參考，不構成投資建議
      </p>
      <p
        className="mt-1 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        © 2025 台股雷達
      </p>
    </footer>
  );
}
