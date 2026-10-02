# Agent guide: omarchy-spotify (fork)

This is a **fork** of `ninepointlabs/omarchy-spotify`, an Omarchy (Quickshell) bar plugin for
Spotify. The checkout at `~/.config/omarchy/plugins/ninepointlabs.spotify` is also the **live
plugin** the user's bar is running. Whatever branch is checked out there is what runs.
Any agent (Claude, Codex, others) follows this file. `CLAUDE.md` only points here.

## Hard rules

1. **Never push to, open PRs against, or otherwise touch the original repo (`ninepointlabs`).**
   The only writable remote is `origin` (`jph777/omarchy-spotify`). `upstream` is read-only.
2. **Never force-push, rewrite published history, or delete `stable`, `dev` or `upstream`.**
3. **Never commit directly to `stable` or `upstream`.** Work on a branch off `dev`.
4. **Never run `scripts/promote` yourself.** It needs the user's smoke test. Ask them to run it
   in a real terminal; the `!` prompt of agent CLIs has no tty and is refused.
5. **Never edit `/usr/share/omarchy/`**, and never commit secrets: Spotify tokens, the Soloist API
   key, `~/.local/state/omarchy-spotify/auth.json`, or client credentials.
6. Security-sensitive code (see "Security notes" in README.md: the API key, process
   boundaries, token files) needs a test change with any behaviour change.
7. If something needs a step these rules forbid and there is no sensible alternative, **stop and ask
   the user** instead of working around it. Don't use `--no-verify`.

## Branches

| Branch | Role | Who moves it |
|---|---|---|
| `upstream` | Pristine mirror of `ninepointlabs` `main`. Never any of our commits. | `scripts/sync-upstream` only |
| `dev` | Integration branch. Every `feat/*`, `fix/*`, `chore/*` branch lands here. | `scripts/land` |
| `stable` | Tested, smoke-tested code. GitHub default branch. What the bar normally runs. | `scripts/promote` (user only) |

Invariant: `upstream` ⊂ `dev`, and `stable` ⊂ `dev` (stable is always an ancestor of dev, so
promotion is a fast-forward). Naming trap: `upstream` is both a remote and a branch. In commands
use `refs/heads/upstream` for the branch or `upstream/main` for the remote one.

## Workflow

```
scripts/setup                  # once per clone: hooks + safety config + dev worktree
scripts/wt feat/add-to-playlist   # new branch off dev in its own worktree; work and commit there
sh tests/run                      # must pass before landing
scripts/land feat/add-to-playlist "Summary"  # feat/*: tests, SQUASH into one commit on dev, push, clean up
scripts/land fix/my-fix           # everything else: tests, merge --no-ff into dev, push, clean up
scripts/live dev                  # user: point the running bar at dev to smoke test it
scripts/live feat/add-to-playlist # ...or at an unfinalized feature branch
scripts/live stable               # back to stable
scripts/promote                   # USER ONLY, in a real terminal: tests + confirm, then stable = dev, pushed
```

- **Always work in a worktree**, never in the live checkout. The live checkout is the user's
  running plugin: editing there changes their bar immediately, and breakage shows up in it.
- Worktrees live in `~/Work/omarchy-spotify-worktrees/` (override: `OMARCHY_SPOTIFY_WORKTREES`).
  They must stay **outside** `~/.config/omarchy/plugins/`, or the shell would load them as
  duplicate plugins with the same id.
- The shell's hot reload does **not** reliably pick up a branch switch (it kept running the old QML),
  so `scripts/live` runs `workflow.reloadCmd` (`omarchy restart shell`) afterwards. Restarting briefly
  blinks the bar. After editing files in the live checkout itself, run it manually if the UI looks stale.
- `dev` is checked out in its own worktree (`.../dev`), so `scripts/live dev` uses a detached
  checkout of dev's commit. Re-run `scripts/live dev` after landing something new.
- **Features are developed on their own `feat/*` branch and squash-merged into `dev`** (the user's
  preference), so each feature is one clearly labeled commit on the `dev` timeline. Commit freely on
  the branch while iterating. Don't land a `feat/*` branch into `dev` until the user says the
  feature is finalized; test it meanwhile with `scripts/live feat/<name>`. Fixes and chores use
  `--no-ff` merges. Never squash or rewrite history that has already been pushed without asking.
- **Every branch lives on `origin` too: no local-only branches.** Push a `feat/*` (or any) branch as soon as
  you create it (`git push -u origin <branch>`) and push after every commit, so GitHub and the local
  worktree never differ. When a branch is landed or abandoned, delete it locally and on origin
  (`git push origin --delete <branch>`). Only the `backup/*` safety refs may stay local, and only briefly.
- Commit messages: short imperative subject (`Add playlist picker to the panel`). Keep commits
  focused and don't reformat or rename unrelated code, which keeps upstream merges conflict-free.
- Prefer **new files** for new features and touch `Panel.qml`, `Service.qml` and
  `bin/spotify-bridge` minimally. Those are the files upstream changes most.

## Pulling upstream (rare, only when the user asks)

`scripts/sync-upstream` fast-forwards `upstream`, pushes it to origin, and merges it into `dev`.
On conflicts, resolve them in the dev worktree, run `sh tests/run`, commit, push `dev`. Then ask
the user to smoke test and promote. Never promote an upstream merge on your own.

## Testing

- `sh tests/run` runs the Python bridge suite and the Node `Model.js` suite. It must pass before
  `scripts/land` and again before promotion.
- The manual smoke test is the user's: the panel opens, playback works, search works, and the
  changed feature behaves. Tell them what changed and what to look at.

## Enforcement

- Git hooks (`.githooks/`, installed by `scripts/setup`): no commits or merge commits on `stable`
  or `upstream`, no pushes to ninepointlabs, no force-push or branch deletion, `upstream` must
  stay a mirror, and `stable` is pushable only via `scripts/promote`.
- GitHub branch protection on `origin` for `stable` and `upstream`: no force-push, no deletion.

## Facts

- The plugin talks to Spotify via the user's own developer app (`clientId` in
  `~/.config/omarchy/shell.json`). It requests only read scopes today; anything that writes
  (playlists) needs new OAuth scopes and a one-time reconnect, so mention that to the user.
- The plugin hot-reloads on file save in the live dir. Settings are managed with
  `omarchy bar set ninepointlabs.spotify <key> <value>`.
- Soloist is the user's headless player (a separate systemd user service, not in this repo).
