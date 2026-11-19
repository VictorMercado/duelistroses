#!/bin/sh
# Points this clone at the repo's git hooks (scripts/git-hooks). Run once per clone:
#
#   sh scripts/install-hooks.sh
#
# pre-push copies content/assets to the production server before a push to
# main, which deploys (see the hook for its settings).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$ROOT/scripts/git-hooks/"*
git -C "$ROOT" config core.hooksPath scripts/git-hooks
echo "git hooks installed from scripts/git-hooks:"
ls "$ROOT/scripts/git-hooks"
