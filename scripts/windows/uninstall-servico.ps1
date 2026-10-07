$ErrorActionPreference = "Stop"

$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$exePath = Join-Path $appDir "servico\PlanejamentoAgricola.exe"

if (Test-Path $exePath) {
  & $exePath --uninstall
}

$desktop = [Environment]::GetFolderPath("Desktop")
@(
  (Join-Path $desktop "Controle Agricola.lnk"),
  (Join-Path $desktop "Encerrar Controle Agricola.lnk")
) | ForEach-Object {
  if (Test-Path $_) { Remove-Item $_ -Force }
}

Write-Host "Servico encerrado, autoinicio removido e atalhos da area de trabalho apagados."
