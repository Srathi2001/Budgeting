# Starts the budget tool for local use: the database and the app, each in its own window.
# They keep running until you stop them: press Ctrl+C in each window (database last), then close it.
# Never close the database window with the X while it is running: a hard stop can corrupt .pgdata.
$root = Split-Path -Parent $PSScriptRoot
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Test-Port([int]$port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }

if (-not (Test-Port 5433)) {
  Start-Process $ps -WorkingDirectory $root -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = 'Budget database (Ctrl+C to stop)'; npm run db:dev"
  for ($i = 0; $i -lt 60 -and -not (Test-Port 5433); $i++) { Start-Sleep 1 }
}
if (-not (Test-Port 3000)) {
  Start-Process $ps -WorkingDirectory $root -ArgumentList '-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = 'Budget app (Ctrl+C to stop)'; npm run dev"
}
