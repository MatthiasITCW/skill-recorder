# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Skill Recorder contributors

param(
  [string]$InstallerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "install.ps1")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$tokens = $null
$parseErrors = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $InstallerPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) {
  $parseErrors | ForEach-Object { Write-Error $_.Message }
  throw "install.ps1 contains PowerShell syntax errors"
}

$helperNames = @(
  "ConvertTo-ExtendedLengthPath",
  "Move-DirectoryTree",
  "Remove-DirectoryTree"
)
$functionDefinitions = @(
  $installerAst.FindAll(
    {
      param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
    },
    $true
  )
)
$helperSource = @(
  foreach ($helperName in $helperNames) {
    $matches = @($functionDefinitions | Where-Object Name -eq $helperName)
    if ($matches.Count -ne 1) {
      throw "Expected one $helperName definition in install.ps1, found $($matches.Count)."
    }
    $matches[0].Extent.Text
  }
)
. ([scriptblock]::Create($helperSource -join [Environment]::NewLine))

$uncPath = ConvertTo-ExtendedLengthPath -Path "\\server\share\folder"
if ($uncPath -ne "\\?\UNC\server\share\folder") {
  throw "Extended-length UNC conversion returned an unexpected path: $uncPath"
}

$testRoot = Join-Path (
  [IO.Path]::GetTempPath()
) ("skill-recorder-installer-" + [guid]::NewGuid().ToString("N"))
$sourceDirectory = Join-Path $testRoot ("source-" + ("a" * 96))
$nestedDirectoryName = "b" * 120
$sourceFile = Join-Path (
  Join-Path $sourceDirectory $nestedDirectoryName
) "coverage.json"
$destinationDirectory = Join-Path $testRoot "build"
$destinationFile = Join-Path (
  Join-Path $destinationDirectory $nestedDirectoryName
) "coverage.json"

try {
  [IO.Directory]::CreateDirectory(
    (ConvertTo-ExtendedLengthPath -Path (Split-Path -Parent $sourceFile))
  ) | Out-Null
  [IO.File]::WriteAllText(
    (ConvertTo-ExtendedLengthPath -Path $sourceFile),
    "installer long-path regression"
  )
  [IO.File]::SetAttributes(
    (ConvertTo-ExtendedLengthPath -Path $sourceFile),
    [IO.FileAttributes]::ReadOnly
  )

  if ($sourceFile.Length -le 260) {
    throw "Long-path test setup produced only $($sourceFile.Length) characters."
  }

  Move-DirectoryTree -Source $sourceDirectory -Destination $destinationDirectory
  if ([IO.Directory]::Exists((ConvertTo-ExtendedLengthPath -Path $sourceDirectory))) {
    throw "Move-DirectoryTree left the source directory behind."
  }
  if (-not [IO.File]::Exists((ConvertTo-ExtendedLengthPath -Path $destinationFile))) {
    throw "Move-DirectoryTree did not move the long-path test file."
  }

  Remove-DirectoryTree -Path $destinationDirectory
  if ([IO.Directory]::Exists((ConvertTo-ExtendedLengthPath -Path $destinationDirectory))) {
    throw "Remove-DirectoryTree left the destination directory behind."
  }
} finally {
  Remove-DirectoryTree -Path $testRoot
}

Write-Host "Windows installer long-path tests passed."
