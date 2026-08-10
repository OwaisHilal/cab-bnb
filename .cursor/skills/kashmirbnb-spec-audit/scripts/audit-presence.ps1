# Kashmir BnB mechanical presence scan
# Hints only - agent must confirm by reading files.
# Run from repo root:
#   & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File .cursor/skills/kashmirbnb-spec-audit/scripts/audit-presence.ps1

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
if (-not (Test-Path (Join-Path $root "ref"))) {
    $root = Get-Location
}

Write-Host "Kashmir BnB Spec Audit - Mechanical Scan"
Write-Host "Root: $root"
Write-Host ""

function Search-Repo {
    param([string]$Pattern, [string[]]$Globs = @("*.ts", "*.tsx", "*.sql", "*.js", "*.jsx"))
    $hits = @()
    foreach ($g in $Globs) {
        Get-ChildItem -Path $root -Recurse -Filter $g -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch "node_modules|\.next|dist|build" } |
            ForEach-Object {
                if (Select-String -Path $_.FullName -Pattern $Pattern -Quiet) {
                    $hits += $_.FullName.Replace("$root\", "").Replace("\", "/")
                }
            }
    }
    return $hits | Select-Object -Unique
}

# --- Requirement docs ---
Write-Host "=== Requirement documents ==="
$plan = Join-Path $root "ref\kashmirbnb_whatsapp_engineering_plan (2).md"
$checklist = Join-Path $root "ref\kashmirbnb_supabase_implementation_checklist (1).md"
if (Test-Path $plan) { Write-Host "  OK   Engineering plan" } else { Write-Host "  GAP  Engineering plan" }
if (Test-Path $checklist) { Write-Host "  OK   Supabase checklist" } else { Write-Host "  GAP  Supabase checklist" }

# --- Phase 0 ---
Write-Host ""
Write-Host "=== Phase 0 - Setup ==="
@("lib/supabase/server.ts", "lib/supabase/client.ts", ".env.example", "supabase/config.toml") | ForEach-Object {
    $p = Join-Path $root ($_ -replace "/", "\")
    if (Test-Path $p) { Write-Host "  OK   $_" } else { Write-Host "  GAP  $_" }
}

# --- Migrations ---
Write-Host ""
Write-Host "=== Phase 1 - Migrations (0001-0008) ==="
$migrationPatterns = @{
    "0001_core_actors" = "create table.*tourists|0001_core_actors"
    "0002_rate_bands" = "vendor_rate_bands|0002_rate_bands"
    "0003_trip_requests" = "trip_requests|0003_trip"
    "0004_otp" = "otp_verifications|0004_otp"
    "0005_bookings" = "create table.*bookings|0005_bookings"
    "0006_messaging" = "whatsapp_message_log|0006_driver"
    "0007_jobs" = "job_queue|0007_lifecycle"
    "0008_rls" = "row level security|0008_rls"
}
foreach ($key in $migrationPatterns.Keys) {
    $found = Search-Repo -Pattern $migrationPatterns[$key] -Globs @("*.sql")
    if ($found.Count -gt 0) {
        Write-Host "  OK   $key -> $($found[0])"
    } else {
        Write-Host "  GAP  $key"
    }
}

# --- API routes ---
Write-Host ""
Write-Host "=== Phase 2 - API routes ==="
$routes = @(
    "trip-requests",
    "otp/send",
    "otp/verify",
    "whatsapp/webhook",
    "admin/rate-bands",
    "admin/driver-details",
    "cron/dispatch-jobs"
)
foreach ($r in $routes) {
    $seg = $r -replace "/", "[/\\]"
    $dirHits = Get-ChildItem -Path $root -Recurse -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "node_modules|\.next|skills" -and $_.FullName -match $seg }
    if ($dirHits) {
        Write-Host "  OK   app/api/$r"
    } else {
        $fileHits = Search-Repo -Pattern [regex]::Escape($r)
        if ($fileHits.Count -gt 0) {
            Write-Host "  MAYBE app/api/$r (ref in $($fileHits[0]))"
        } else {
            Write-Host "  GAP  app/api/$r"
        }
    }
}

# --- Edge Functions ---
Write-Host ""
Write-Host "=== Phase 3 - Edge Functions ==="
$functions = @(
    "match-vendor-rate-bands",
    "send-quotes",
    "compute-negotiation",
    "finalize-booking",
    "notify-vendor-booking",
    "parse-driver-details",
    "send-confirmation-card",
    "dispatch-lifecycle-events",
    "expire-stale-quotes",
    "job-queue-worker"
)
foreach ($fn in $functions) {
    $fnPath = Join-Path $root "supabase\functions\$fn"
    if (Test-Path $fnPath) {
        Write-Host "  OK   $fn"
    } else {
        Write-Host "  GAP  $fn"
    }
}

# --- Security ---
Write-Host ""
Write-Host "=== Security signals ==="
$leaks = Search-Repo -Pattern "min_quote|negotiation_step_min|negotiation_step_max"
$clientPaths = $leaks | Where-Object { $_ -match "components|app/(?!api)" -and $_ -notmatch "api/|functions/|migrations/" }
if ($clientPaths.Count -gt 0) {
    Write-Host "  WARN Possible client exposure:"
    $clientPaths | ForEach-Object { Write-Host "       $_" }
} else {
    Write-Host "  OK   No obvious min_quote/negotiation_step in client paths"
}

$sig = Search-Repo -Pattern "X-Hub-Signature-256|hub.signature"
if ($sig.Count -gt 0) {
    Write-Host "  OK   Webhook signature: $($sig[0])"
} else {
    Write-Host "  GAP  No X-Hub-Signature-256 handling"
}

$jobQueue = Search-Repo -Pattern "job_queue|job_type"
$jobQueueCount = $jobQueue.Count
if ($jobQueueCount -gt 0) {
    Write-Host ("  OK   job_queue referenced (" + $jobQueueCount + " files)")
} else {
    Write-Host "  GAP  No job_queue usage found"
}

Write-Host ""
Write-Host "Done. Verify each item by reading source files before audit report."
