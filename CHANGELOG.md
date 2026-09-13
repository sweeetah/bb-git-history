# Changelog

All notable changes to Git History are documented here.

## [0.4.1] - 2026-09-12

### Added

- Git History now supports selecting an independently scoped repository from
  canonical immediate `repos/*` worktrees when the thread environment root is
  not itself a Git worktree.
- Multi-repository threads now use a collapsible repository navigator with
  branch and dirty status, per-thread selection memory, and search for large
  repository sets.

### Fixed

- Repository search remains available to clear an active filter when the
  repository list shrinks below the search threshold.
- Repository status counts every untracked file, including when Git is configured
  to hide untracked files.

## [0.4.0] - 2026-09-05

### Added

- An experimental commit graph adds branch and merge lanes while keeping the
  compact history palette and commit markers. It is enabled by default.
- Expanded commits show the complete message and precise author metadata.
- Frontend registration and behavior now have automated test coverage.

### Fixed

- Untracked files now produce new-file patches in the diff viewer.
- Unmerged working-tree paths are labeled as conflicts.
- Multi-page refreshes restart when the repository changes instead of mixing revisions.
- History pages no longer read and discard every commit body.

## [0.3.0] - 2026-08-28

### Added

- Uncommitted files now appear above commit history, including staged, modified, deleted, and untracked files.
- Working-tree files open in the native diff viewer when a textual patch is available.
- The Uncommitted section can be expanded or collapsed and starts collapsed by default.

## [0.2.0] - 2026-08-26

### Added

- File diffs can switch between wrapped long lines and horizontal scrolling.

### Fixed

- Ref labels now collapse into a `+N` counter before they overflow narrow panels.
- Expanded commit messages wrap instead of truncating long text.
- Internal t3 checkpoint refs and checkpoint-only commits no longer appear in history.

## [0.1.1] - 2026-08-24

### Fixed

- Returning from a file diff now preserves the history scroll position without leaving a blank gap above the virtualized commit list.

## [0.1.0] - 2026-08-24

### Added

- Complete repository history across local branches, remote-tracking branches, tags, stashes, and shared worktrees.
- Compact colored branch and merge graph with responsive layouts for narrow and wide panels.
- Inline changed-file summaries and bb-native per-file diffs.
- Virtualized incremental loading and search across loaded commits.
- Light, dark, and custom bb theme support.
- Read-only Git inspection on local and connected bb hosts.
