$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputDirectory = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$releaseName = 'motive-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tar.gz'
$archivePath = Join-Path $outputDirectory $releaseName
$files = @('index.html', 'styles.css', 'app.js', 'ai-client.js', 'poster.js', 'domain.js', 'data.js', 'server.js', 'package.json', '.gitignore', '.gitattributes', '.env.example', '.dockerignore', 'Dockerfile', 'compose.yaml', 'compose.tls.yaml', 'assets', 'server', 'deploy', 'tests', 'scripts', 'README.md', 'PRODUCT.md', 'DEPLOYMENT.md', 'artifacts/motive-posters-preview.png', 'artifacts/motive-poster-portrait.png', 'artifacts/motive-poster-portrait.svg', 'artifacts/motive-poster-square.png', 'artifacts/motive-poster-square.svg', 'artifacts/motive-poster-story-ar.png', 'artifacts/motive-poster-story-ar.svg')
foreach ($relative in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw "Missing release file: $relative" }
}
if (Test-Path -LiteralPath $archivePath) { throw 'Release archive already exists.' }
# Windows tar can mis-handle non-ASCII absolute paths; inherit the Unicode cwd.
Push-Location -LiteralPath $projectRoot
try {
    & tar -czf ('artifacts/' + $releaseName) -- @files
    if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed.' }
} finally {
    Pop-Location
}
$digest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($archivePath + '.sha256', "$digest  $releaseName`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Release: $archivePath"
Write-Output "SHA256: $digest"
