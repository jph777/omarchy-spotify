# Shared helpers, sourced by the other scripts.
set -eu
COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
LIVE=$(dirname "$COMMON")                          # the main worktree: the live plugin
WT_ROOT=${OMARCHY_SPOTIFY_WORKTREES:-$HOME/Work/omarchy-spotify-worktrees}
DEV_WT=$WT_ROOT/dev
die() { echo "error: $*" >&2; exit 1; }
