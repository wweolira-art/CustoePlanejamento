$ErrorActionPreference = "Stop"

$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$servicoDir = Join-Path $appDir "servico"
$csPath = Join-Path $PSScriptRoot "PlanejamentoAgricolaControle.cs"
$exePath = Join-Path $servicoDir "PlanejamentoAgricola.exe"

Write-Host "Pasta do app: $appDir"

if (-not (Test-Path (Join-Path $appDir "package.json"))) {
  throw "package.json nao encontrado em $appDir"
}

New-Item -ItemType Directory -Force -Path $servicoDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $servicoDir "logs") | Out-Null

Write-Host "Compilando frontend..."
Push-Location $appDir
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Falha no npm run build" }
} finally {
  Pop-Location
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
  throw "Compilador C# nao encontrado. Instale o .NET Framework 4.8."
}

Write-Host "Gerando executavel..."
$utf8Bom = New-Object System.Text.UTF8Encoding $true
$source = [IO.File]::ReadAllText($csPath)
[IO.File]::WriteAllText($csPath, $source, $utf8Bom)

& $csc /nologo /target:winexe /optimize+ `
  /reference:System.Windows.Forms.dll `
  /reference:System.Drawing.dll `
  /out:$exePath `
  $csPath

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exePath)) {
  throw "Falha ao compilar o executavel."
}

function Stop-PortListener([int]$Port) {
  $lines = netstat -ano -p tcp | Select-String ":$Port\s+.+\sLISTENING\s+\d+"
  foreach ($line in $lines) {
    if ($line.Line -match "\s(\d+)\s*$") {
      $pidOnPort = [int]$Matches[1]
      if ($pidOnPort -gt 0) {
        Write-Host "Encerrando processo $pidOnPort na porta $Port..."
        taskkill /PID $pidOnPort /T /F 2>$null | Out-Null
      }
    }
  }
}

Stop-PortListener 8788
Stop-PortListener 5173

Write-Host "Instalando autoinicio e iniciando em segundo plano..."
& $exePath --install
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao iniciar o servico. Veja o log em $servicoDir\logs\servico.log"
}
Start-Process -FilePath $exePath -ArgumentList "--background" -WindowStyle Hidden
Start-Sleep -Seconds 2

$desktop = [Environment]::GetFolderPath("Desktop")
$wsh = New-Object -ComObject WScript.Shell

$startShortcut = $wsh.CreateShortcut((Join-Path $desktop "Controle Agricola.lnk"))
$startShortcut.TargetPath = $exePath
$startShortcut.WorkingDirectory = $servicoDir
$startShortcut.WindowStyle = 7
$startShortcut.Description = "Inicia o Controle Agricola em segundo plano e abre o navegador"
$startShortcut.Save()

$stopShortcut = $wsh.CreateShortcut((Join-Path $desktop "Encerrar Controle Agricola.lnk"))
$stopShortcut.TargetPath = $exePath
$stopShortcut.Arguments = "--stop"
$stopShortcut.WorkingDirectory = $servicoDir
$stopShortcut.WindowStyle = 7
$stopShortcut.Description = "Encerra o servico do Controle Agricola"
$stopShortcut.Save()

Write-Host ""
Write-Host "Pronto."
Write-Host "Executavel: $exePath"
Write-Host "Atalhos na area de trabalho: Controle Agricola e Encerrar Controle Agricola"
Write-Host "Icone na bandeja do Windows (canto inferior direito): clique com o botao direito para encerrar ou abrir."
Write-Host "No proximo login apos religar o computador, o servico sobe sozinho."
Write-Host "App: http://localhost:5173/"
