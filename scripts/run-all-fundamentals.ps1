# scripts/run-all-fundamentals.ps1
# Runs all ingest-fundamentals batches sequentially until all stocks are processed.
# Usage: .\scripts\run-all-fundamentals.ps1

$secret = "mysecret123"
$base = "https://taiwanscreen.vercel.app"
$batchSize = 20
$offset = 0
$totalCount = 0
$totalErrors = 0

Write-Host "Starting full fundamentals ingestion (debt_ratio + EPS + margins)..."

while ($true) {
    $url = "$base/api/admin/ingest-fundamentals?offset=$offset"
    
    try {
        $response = Invoke-WebRequest -Uri $url -Method POST `
            -Headers @{"x-cron-secret"=$secret} `
            -UseBasicParsing
        
        $data = $response.Content | ConvertFrom-Json
        
        $totalCount += $data.count
        $totalErrors += $data.errors
        
        Write-Host "offset=$offset processed=$($data.processed) count=$($data.count) errors=$($data.errors) total=$totalCount"
        
        # Stop if we got fewer stocks than batch size (last batch)
        if ($data.processed -lt $batchSize) {
            Write-Host "Last batch reached. Done."
            break
        }
        
        $offset += $batchSize
        
        # Small delay to be polite to FinMind rate limits
        Start-Sleep -Milliseconds 500
        
    } catch {
        Write-Host "Error at offset=$offset : $_"
        # Wait and retry once
        Start-Sleep -Seconds 3
        $offset += $batchSize
        
        # Safety stop after 200 batches (~4000 stocks)
        if ($offset -gt 4000) {
            Write-Host "Safety stop at offset $offset"
            break
        }
    }
}

Write-Host ""
Write-Host "Complete. Total rows upserted: $totalCount, errors: $totalErrors"