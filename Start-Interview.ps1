$ErrorActionPreference = 'Stop'
$interviewRoot = $PSScriptRoot
$interviewData = if ($env:INTERVIEW_DATA_DIR) { $env:INTERVIEW_DATA_DIR } else {
    Join-Path $interviewRoot 'data\private'
}
$interviewPort = if ($env:INTERVIEW_PORT) { $env:INTERVIEW_PORT } else { 4173 }
$interviewUrl = "http://127.0.0.1:$interviewPort"
function Test-InterviewServer {
    try { return (Invoke-RestMethod "$interviewUrl/api/health" -TimeoutSec 2).app -eq 'interview-rehearsal' }
    catch { return $false }
}
if (!(Test-Path -LiteralPath (Join-Path $interviewRoot 'dist\app\index.html'))) {
    throw '앱 폴더에서 pnpm install 및 pnpm build 실행 필요'
}
if (!(Test-InterviewServer)) {
    if (Get-NetTCPConnection -LocalPort $interviewPort -State Listen -ErrorAction SilentlyContinue) {
        throw "$interviewPort 포트에서 다른 서버 실행 중"
    }
    $logDirectory = Join-Path $interviewData 'logs'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $nodeCommand = (Get-Command node).Source
    $entry = Join-Path $interviewRoot 'server\index.mjs'
    $server = Start-Process -FilePath $nodeCommand -ArgumentList @('"' + $entry + '"') -WorkingDirectory $interviewRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
    for ($i = 0; $i -lt 30 -and !(Test-InterviewServer); $i++) {
        if ($server.HasExited) { throw '앱 서버 시작 실패. 자료 폴더의 logs/server-error.log 확인 필요' }
        Start-Sleep -Milliseconds 200
    }
    if (!(Test-InterviewServer)) { throw '앱 서버 응답 확인 실패' }
}
Write-Host "Whale에서 $interviewUrl/ 열기"

