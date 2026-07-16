#!/usr/bin/env bash
#
# Cavallino Index — one-command setup.
#
#   ./setup.sh [repo-name] [public|private]
#
# Creates the GitHub repo, pushes, turns on Pages, runs the first crawl,
# and prints the live URL. Safe to re-run.

set -euo pipefail

REPO_NAME="${1:-ferrari-tracker}"
VISIBILITY="${2:-public}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- 0. Preflight -------------------------------------------------------
command -v git >/dev/null || die "git isn't installed."
command -v gh >/dev/null || die "GitHub CLI isn't installed. Install it: brew install gh"

gh auth status >/dev/null 2>&1 || die "GitHub CLI isn't signed in. Run: gh auth login"

[ -f crawler/crawl.py ] || die "Run this from the repo root (the folder holding crawler/ and web/)."

if [ "$VISIBILITY" != "public" ] && [ "$VISIBILITY" != "private" ]; then
  die "Visibility must be 'public' or 'private'."
fi

if [ "$VISIBILITY" = "private" ]; then
  printf '\n\033[33m! Pages on a private repo needs a paid GitHub plan. The deploy step\n'
  printf '  will fail on a free account.\033[0m\n'
fi

# --- 1. Commit ----------------------------------------------------------
say "Preparing the commit"
if [ ! -d .git ]; then
  git init -b main >/dev/null
fi
git add -A
if git diff --staged --quiet 2>/dev/null; then
  echo "  Nothing new to commit."
else
  git commit -m "Cavallino Index — hourly Ferrari price tracker" >/dev/null
  echo "  Committed."
fi

# --- 2. Repo ------------------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  say "Pushing to the existing remote"
  git push -u origin main
else
  say "Creating github.com/<you>/$REPO_NAME ($VISIBILITY)"
  gh repo create "$REPO_NAME" "--$VISIBILITY" --source=. --remote=origin --push
fi

SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER="${SLUG%%/*}"
NAME="${SLUG##*/}"

# --- 3. Pages -----------------------------------------------------------
# Must happen before the workflow deploys, or the deploy step errors.
say "Turning on GitHub Pages (source: Actions)"
if gh api "repos/$SLUG/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$SLUG/pages" -f build_type=workflow >/dev/null
  echo "  Already on — set to build from Actions."
else
  gh api -X POST "repos/$SLUG/pages" -f build_type=workflow >/dev/null \
    || die "Couldn't enable Pages. Turn it on by hand: Settings → Pages → Source: GitHub Actions"
  echo "  Enabled."
fi

# --- 4. First run -------------------------------------------------------
say "Starting the first crawl"
# The push above already starts a run. Dispatching a second one races it: both
# crawl, both commit, and the slower push is rejected. Only dispatch if nothing
# is already running — e.g. a re-run with nothing new to push.
sleep 6
live() {
  gh run list --workflow=update.yml --limit 5 --json databaseId,status \
    -q '[.[] | select(.status != "completed")][0].databaseId' 2>/dev/null || echo ""
}
RUN_ID=$(live)
if [ -z "$RUN_ID" ]; then
  gh workflow run update.yml >/dev/null 2>&1 || true
  sleep 6
  RUN_ID=$(live)
fi
if [ -n "$RUN_ID" ]; then
  echo "  Watching run $RUN_ID (~2 min). Ctrl-C is safe — it keeps running."
  gh run watch "$RUN_ID" --exit-status || die "The run failed. Open it: gh run view $RUN_ID --log-failed"
else
  echo "  Couldn't find the run. Check: gh run list"
fi

# --- 5. Done ------------------------------------------------------------
URL=$(gh api "repos/$SLUG/pages" -q .html_url 2>/dev/null || echo "https://$OWNER.github.io/$NAME/")
printf '\n\033[32m✓ Live at %s\033[0m\n' "$URL"
printf '  Pages can take a minute to serve the first deploy.\n'
printf '  It now crawls by itself at :17 every hour.\n\n'
printf '  Actions:  https://github.com/%s/actions\n' "$SLUG"
printf '  Run now:  gh workflow run update.yml\n\n'
