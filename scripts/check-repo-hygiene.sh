#!/usr/bin/env bash
# Repo hygiene check for WorldSeed. Safe to run locally or in CI.
#
# Fails (exit 1) if any tracked file, path, or commit message contains:
#   - forbidden tooling/vendor names or assistant-attribution trailers
#   - files that must never be committed (agent config, real .env files)
#   - likely secrets (API keys, private keys)
#   - submission-readiness gaps: missing LICENSE/NOTICE/THIRD_PARTY_LICENSES.md, a filled-in secret in
#     .env.example, a NEXT_PUBLIC_ variable that looks like a key; warns when THIRD_PARTY_LICENSES.md is stale
#
# Usage:
#   scripts/check-repo-hygiene.sh                    # tracked files + commit messages
#   scripts/check-repo-hygiene.sh --include-untracked  # also files not yet added (respects .gitignore)
#
# The forbidden words are assembled from split strings on purpose, so that this
# file does not match its own rules and a repo-wide grep stays clean.

set -u

cd "$(git rev-parse --show-toplevel)" || exit 2

INCLUDE_UNTRACKED=0
for arg in "$@"; do
  case "$arg" in
    --include-untracked) INCLUDE_UNTRACKED=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# --- Patterns (built from fragments; do not "simplify" into whole words) ---
W_A='cla''ude'
W_B='anthr''opic'
WORDS="${W_A}|${W_B}"
MSG_WORDS="${WORDS}|co-authored""-by|generated"" with"

# Paths that must never be tracked.
PATH_BAD_NAMES="(^|/)(${W_A}\\.md|AGENTS\\.md)\$"
PATH_BAD_ENV='(^|/)\.env($|\.)'
PATH_OK_ENV='(^|/)\.env\.example$'

# Likely secrets. Matches are reported by file:line only (values are never printed).
SECRET_RE="tvly-[A-Za-z0-9]{10,}"
SECRET_RE="${SECRET_RE}|sk-[A-Za-z0-9]{20,}"
SECRET_RE="${SECRET_RE}|AKIA[0-9A-Z]{16}"
SECRET_RE="${SECRET_RE}|-----BEGIN .*PRIV""ATE KEY-----"
SECRET_RE="${SECRET_RE}|^[[:space:]]*(export[[:space:]]+)?(NEBIUS_API_KEY|TAVILY_API_KEY)[[:space:]]*=[[:space:]]*[\"']?[A-Za-z0-9_.-]{20,}"

fail=0
report() { echo "HYGIENE FAIL: $*" >&2; fail=1; }

# --- File list ---
if [ "$INCLUDE_UNTRACKED" -eq 1 ]; then
  files=$(git ls-files --cached --others --exclude-standard)
else
  files=$(git ls-files)
fi

while IFS= read -r f; do
  [ -z "$f" ] && continue

  # Path rules
  if printf '%s\n' "$f" | grep -Eiq "$PATH_BAD_NAMES"; then
    report "forbidden file name: $f"
  fi
  if printf '%s\n' "$f" | grep -Eiq "(^|/)\\.${W_A}(/|\$)"; then
    report "forbidden agent config directory: $f"
  fi
  if printf '%s\n' "$f" | grep -Eq "$PATH_BAD_ENV" && ! printf '%s\n' "$f" | grep -Eq "$PATH_OK_ENV"; then
    report "env file must not be tracked (only .env.example is allowed): $f"
  fi
  if printf '%s\n' "$f" | grep -Eiq "$WORDS"; then
    report "forbidden word in path: $f"
  fi

  [ -f "$f" ] || continue

  # Content rules (skip binary files)
  hits=$(grep -IiEn "$WORDS" -- "$f" 2>/dev/null | head -5)
  if [ -n "$hits" ]; then
    report "forbidden word in content of $f"
    printf '%s\n' "$hits" | sed 's/^/    /' >&2
  fi
  secret_lines=$(grep -IEn "$SECRET_RE" -- "$f" 2>/dev/null | cut -d: -f1 | head -5 | tr '\n' ' ')
  if [ -n "$secret_lines" ]; then
    report "possible secret in $f (line(s): ${secret_lines}; value not shown)"
  fi
done <<< "$files"

# --- Commit messages ---
if git rev-parse --verify -q HEAD >/dev/null; then
  while IFS= read -r sha; do
    if git log -1 --format=%B "$sha" | grep -Eiq "$MSG_WORDS"; then
      report "forbidden text in commit message: $(git log -1 --format='%h %s' "$sha")"
    fi
  done < <(git rev-list HEAD)
fi

# --- Submission-readiness checks (extension) ---
warn() { echo "HYGIENE WARN: $*" >&2; }

# Files the submission depends on.
for req in LICENSE NOTICE data/snapshot/LICENSE.md THIRD_PARTY_LICENSES.md; do
  [ -f "$req" ] || report "required file missing: $req"
done

# .env.example is a template: no value may be filled in for a secret-looking variable.
if [ -f .env.example ]; then
  filled=$(grep -En '^[[:space:]]*(export[[:space:]]+)?[A-Z0-9_]*(KEY|TOKEN|SECRET|SALT|PASSWORD)[A-Z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]#]' .env.example | cut -d: -f1 | tr '\n' ' ')
  if [ -n "$filled" ]; then
    report ".env.example line(s) ${filled}give a value to a secret-looking variable (value not shown)"
  fi
fi

# Keys are server-side only: no NEXT_PUBLIC_ variable may look like a key, token or secret.
if [ "$INCLUDE_UNTRACKED" -eq 1 ]; then
  pub=$(git grep -In --untracked -E 'NEXT_PUBLIC_[A-Za-z0-9_]*(KEY|TOKEN|SECRET)' -- . ':!scripts/check-repo-hygiene.sh' 2>/dev/null | cut -d: -f1,2 | head -5 | tr '\n' ' ')
else
  pub=$(git grep -In -E 'NEXT_PUBLIC_[A-Za-z0-9_]*(KEY|TOKEN|SECRET)' -- . ':!scripts/check-repo-hygiene.sh' 2>/dev/null | cut -d: -f1,2 | head -5 | tr '\n' ' ')
fi
if [ -n "$pub" ]; then
  report "NEXT_PUBLIC_ variable that looks like a secret (file:line): ${pub}"
fi

# THIRD_PARTY_LICENSES.md is generated; warn (not fail) when it no longer matches the lockfiles.
# Needs the installed dependencies to compare, so it is skipped when they are absent (for example in CI).
if [ -f scripts/gen-third-party-licenses.mjs ] && command -v node >/dev/null 2>&1 && [ -d frontend/node_modules ] && [ -d pipeline/.venv ]; then
  if ! node scripts/gen-third-party-licenses.mjs --check >/dev/null 2>&1; then
    warn "THIRD_PARTY_LICENSES.md is stale. Run: node scripts/gen-third-party-licenses.mjs"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "Repo hygiene OK."
  exit 0
fi
echo "Repo hygiene check failed." >&2
exit 1
