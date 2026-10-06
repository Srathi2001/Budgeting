# Starts the budget tool for local use: the database and the app, each in its own window.
# They keep running until you stop them: press Ctrl+C in each window (app first, database last).
# Where opening new windows is blocked (Start-Process fails on locked-down PCs), it prints how to
# run the two in two terminals instead.
$root = Split-Path -Parent $PSScriptRoot
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Test-Port([int]$port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }
function Show-Manual {
  Write-Host ''
  Write-Host 'This PC does not allow opening new windows. Run the tool in two terminals instead:' -ForegroundColor Yellow
  Write-Host "  Terminal 1:  cd `"$root`"; npm run db:dev"
  Write-Host "  Terminal 2:  cd `"$root`"; npm run dev"
  Write-Host 'Then open http://localhost:3000. Stop with Ctrl+C: Terminal 2 first, then Terminal 1.'
  exit 1
}

try {
  if (-not (Test-Port 5433)) {
    Start-Process $ps -WorkingDirectory $root -ErrorAction Stop -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = 'Budget database (Ctrl+C to stop)'; npm run db:dev"
    for ($i = 0; $i -lt 60 -and -not (Test-Port 5433); $i++) { Start-Sleep 1 }
  }
  if (-not (Test-Port 3000)) {
    Start-Process $ps -WorkingDirectory $root -ErrorAction Stop -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = 'Budget app (Ctrl+C to stop)'; npm run dev"
  }
} catch {
  Show-Manual
}
