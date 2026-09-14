$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputDirectory = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$releaseName = 'Motive-SalesCowork-v' + $version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip'
$archivePath = Join-Path $outputDirectory $releaseName
$partialPath = $archivePath + '.partial'
$files = @('vehicle-comparison.js', 'artifact-workbench.js', 'workbench-ui.js', 'experience-model.js', 'experience-ui.js', 'experience.css', 'Motive-三角色Cowork-UX设计-v3.md', 'index.html', 'styles.css', 'cowork.css', 'cowork.js', 'cowork-ui.js', 'chat-ui.js', 'chat.css', 'ux.css', 'workspace-model.js', 'workspace-ui.js', 'task-flow.js', 'task-ui.js', 'customer-profile.js', 'profile-ui.js', 'app.js', 'ai-client.js', 'poster.js', 'domain.js', 'data.js', 'server.js', 'package.json', '.gitignore', '.gitattributes', '.env.example', '.dockerignore', 'Dockerfile', 'compose.yaml', 'compose.tls.yaml', 'README.md', 'Motive-垂直Cowork-UX重构方案-v2.md', 'DEPLOYMENT.md', '开始使用.md', '安装并连接Copilot.cmd', '启动Motive.cmd')
$files += @('markdown.js', 'execution.js')
foreach ($directory in @('assets', 'server', 'deploy', 'tests', 'scripts')) {
    $directoryPath = Join-Path $projectRoot $directory
    foreach ($file in Get-ChildItem -LiteralPath $directoryPath -Recurse -File) {
        if ($file.Name -eq 'Caddyfile' -or $file.Extension -in @('.js', '.mjs', '.ps1', '.sh', '.svg', '.conf')) {
            $files += $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
        }
    }
}
if (Test-Path -LiteralPath (Join-Path $projectRoot 'package-lock.json')) { $files += 'package-lock.json' }
if (Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts/Motive-Vehicle-Comparison-Demo.html')) { $files += 'artifacts/Motive-Vehicle-Comparison-Demo.html' }
if (Test-Path -LiteralPath (Join-Path $projectRoot 'artifacts/motive-posters-preview.png')) { $files += 'artifacts/motive-posters-preview.png' }
$files = @($files | Sort-Object -Unique)
$hashes = [ordered]@{}
foreach ($relative in $files) {
    $source = Join-Path $projectRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relative" }
    $hashes[$relative] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
}
if ((Test-Path -LiteralPath $archivePath) -or (Test-Path -LiteralPath $partialPath)) { throw 'Release archive already exists.' }
$verification = @{ realModelVerified = $false; code = 'NOT_CHECKED' }
$reportPath = Join-Path $projectRoot 'runtime/copilot-check.json'
if (Test-Path -LiteralPath $reportPath) {
    $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $verification = @{ realModelVerified = [bool]($report.ok -and $report.liveRequested -and $report.checks.Count -eq 5); code = $report.code; checkedAt = $report.checkedAt }
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($partialPath, [System.IO.FileMode]::CreateNew)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false, [System.Text.Encoding]::UTF8)
try {
    foreach ($relative in $files) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $projectRoot $relative), $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $entry = $zip.CreateEntry('RELEASE.json')
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $writer.Write((@{version=$version; createdAt=(Get-Date).ToUniversalTime().ToString('o'); copilotVerification=$verification; files=$hashes} | ConvertTo-Json -Depth 5)) } finally { $writer.Dispose() }
} finally { $zip.Dispose(); $stream.Dispose() }
# Read back every entry before publishing the final ZIP name.
$check = [System.IO.Compression.ZipFile]::OpenRead($partialPath)
try {
    if ($check.Entries.Count -ne $files.Count + 1) { throw 'Archive entry count mismatch.' }
    foreach ($relative in $files) {
        $entryStream = $check.GetEntry($relative).Open()
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($sha.ComputeHash($entryStream))).Replace('-', '').ToLowerInvariant() } finally { $entryStream.Dispose(); $sha.Dispose() }
        if ($actual -ne $hashes[$relative]) { throw "Archive verification failed: $relative" }
    }
} finally { $check.Dispose() }
$resolvedOutput = [System.IO.Path]::GetFullPath($outputDirectory) + [System.IO.Path]::DirectorySeparatorChar
foreach ($target in @($partialPath, $archivePath)) {
    if (-not [System.IO.Path]::GetFullPath($target).StartsWith($resolvedOutput, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive target is outside the output directory.' }
}
[System.IO.File]::Move($partialPath, $archivePath)
$digest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($archivePath + '.sha256', "$digest  $releaseName`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Release: $archivePath"
Write-Output "Files verified: $($files.Count + 1)"
Write-Output "SHA256: $digest"
