# Task for the coding agent: two tooling follow-ups (identity-tool cold-frame flag; HyperFrames comments-panel pixel diffs)

You work for a manager (Claude) who re-runs your key checks. Read this whole file, then do the steps in order. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-followups-tools` (branch `codex/followups-tools`, from `20585df`, the integration line). Dependencies: this worktree has no `node_modules`; use the sibling `../VideoSaaS-engine/node_modules` and `../VideoSaaS-engine/frontend/node_modules` read-only (e.g. by `NODE_PATH` or by symlinking `node_modules` into this worktree if that is what the tools need; do not commit symlinks, do not install anything). Use absolute paths in every command. Never write in other worktrees.

## Goal
1. `tools/phase3/engine-identity.mjs` must stop flagging items whose first GPU draw is two-valued, and still prove old == new. Today it already discards one warm-up draw per mounted size, yet `fixture:balloon-0@9:16` (small, 360x640, `--gpu`) was flagged: its **frame 0 hash varied between `c3ad9c5f` and `bc276fb9` across fresh pages for BOTH the old and the new engine**, frames 1..4 stable. So one warm-up is not enough for that item; find out what is.
2. Find the cause of the HyperFrames comments-panel corner-antialias pixel diffs (2 to 56 px, max delta 18, repeatable) that appeared after Phase 4a, say which commit introduces them and why, then either recapture the baseline on purpose (if the change is deliberate) or document the tolerance (if it is machine noise).

## Read first
- `tools/phase3/engine-identity.mjs` (the `run()` function with the warm-up and hash loop; the retry/vote logic near the end that sets `smallVerdict`/`fullVerdict`; the `cold first-draw` fields `firstDrawIdentical`, `oldFirstHash`, `newFirstHash`), `docs/phase3/engine-inside-report.md` sections 3 and 11 (the cause: Chromium demotes a GPU 2D canvas after a `getImageData` readback; cold offscreen layers/caches), `docs/phase3/engine-identity-result-gpu.json` (row `fixture:balloon-0@9:16`).
- `tools/phase3/capture-hf.mjs`, `capture-final.mjs`, `compare.mjs`, `make-hf-fixture.mjs`, and the baseline dirs `tools/phase3/hf-baseline`, `hf-after`, `hf-final-baseline`, `hf-final-after`, `3h-hf-after`, `3h-hf-diff` (read `git log --oneline -3 -- <dir>` for each to see who last changed them and why).
- The HyperFrames comments panel in the frontend (find it with `grep -rn -i "comment" frontend/components frontend/app --include=*.tsx -l`) and `git diff 88d4efa c760509 -- frontend` and `git diff c760509 7ba5f0c -- frontend`, limited to the panel, its CSS, fonts and layout.

## Mapping notes (from the manager's read-only survey; verify them)
- `capture-hf.mjs` starts its own `npx next dev --webpack -H 127.0.0.1 -p <free port>` in `frontend/`, needs `frontend/node_modules`, uses fixtures `frontend/test/fixtures/hf/*` (made by `make-hf-fixture.mjs`) and Chrome at `/Applications/Google Chrome.app`, headless, widths 1280 and 400, height 800, light and dark; 12 states -> 48 PNGs named `<state>-<width>-<theme>.png`; default output `tools/phase3/hf-baseline`. The comments panel is the `d-comments` and `g3-applying-comments` states.
- `compare.mjs` takes `dirA dirB diffDir`; a file passes only when it has **zero** differing pixels (no tolerance today); it exits 1 on any failure.
- Last commits touching the dirs: `hf-baseline` and `hf-after` were last changed by `54aed0e` (Phase 3b), `hf-final-after` by `2899052`, `3h-hf-after` by `ec3ba9c`. Note `3h-hf-after` is the most recent HF capture set; decide which set is the right baseline for each commit you test and say why.
- Comments panel: `frontend/components/animation-workspace/CommentsPanel.tsx` + `frontend/app/animation-workspace.css`. `88d4efa..c760509` changes CommentsPanel.tsx by 17 lines (adds class `aw-comment-refused`, `role=status`, apply disabled when no scenes); `c760509..7ba5f0c` by 77 lines (aria-labels/titles, `disabled={applying}` on the x button, `aw-time`/`aw-x` class restructure). Neither range touches `animation-workspace.css` or any font. `aw-comment-refused` has no CSS rule anywhere (report that as a finding if confirmed). These are leads, not conclusions: the diff may also come from the environment (Chrome version, fonts, antialiasing), so test at the three commits as step 2 says.

## Architecture rules
- Reuse the existing tools; extend `engine-identity.mjs`, `capture-hf.mjs`, `compare.mjs` in their current style (plain `.mjs`, `playwright-core`, JSON output, console lines). No new dependencies, no new packages.
- **No engine source changes** (`packages/plate-engine/src/**` is forbidden). **No frontend app changes** except a deliberate baseline recapture of image directories under `tools/phase3/`.
- Identity comparison stays strict: a REAL old/new difference must still be reported. Do not loosen hashes; remove only the flakiness that is demonstrably cold-start GPU variance shared by old and new.
- Determinism: any warm-up you add is a discarded draw before the compared draws; the compared draws are what is hashed.

## Files allowed to change
`tools/phase3/**` (scripts, the two reports below, recaptured baseline image dirs only if the cause is a deliberate 4a change and only in a separate commit-ready set the manager will commit), `docs/phase3/engine-identity-result*.json` (regenerated), `docs/phase3/followups-tools-report.md`.
## Files forbidden
Everything else: `packages/**`, `backend/**`, `worker/**`, `frontend/**` (except nothing), lockfiles, `.env*`, credential files, other worktrees.

## Steps in order

**Part 1: identity tool (needs `.lock-timing` for every GPU run).**
1. Reproduce: under the lock, run `fixture:balloon-0@9:16` (use `--styles` or an items filter if the tool has one; otherwise add a small `--items` filter) on **10 fresh pages** for the old and the new engine with `--gpu`, recording the hash of frame 0 for: the first draw, each of the next 4 draws of the same frame, and the next 4 draws after drawing frame 1 then frame 0 again. Report counts. Determine what makes frame 0 two-valued (candidates: the item draws frame 0 as a still with a cache created on the first draw; a lazily created tile/layer; the GPU demotion happening on the 2nd or 3rd readback instead of the 1st; the size switch small -> full on the same page). Report the evidence.
2. Fix the tool accordingly: every compared frame-0 hash is taken at a matched warm state, with the minimum number of discarded warm-up draws that makes old-vs-old stable for all 67 items over 10 fresh pages for the items known to flip (`balloon-0@9:16`, `lighthouse` both aspects, `moonPhases@1:1`). If no number of warm-ups stabilises an item, exclude cold frame 0 from the vote for that item and say so with evidence; never silently skip an item.
3. Keep the separate "cold first-draw" table (old first hash vs new first hash, per size) in the JSON as information only (`coldFirstDraw` section); it never sets `allIdentical`.
4. Proof: the GPU identity run (`node tools/phase3/engine-identity.mjs --gpu --out <scratch>.json`) gives `allIdentical: true`, 67/67, `skipped: []`, with **no false flag**, **twice in a row**, each run under the lock. The software run also stays 67/67. Regenerate `docs/phase3/engine-identity-result-gpu.json` and `engine-identity-result.json` from the final runs.

**Part 2: HyperFrames comments-panel diffs.**
1. Reproduce the diff: in scratch copies of the repository at three commits, **`c760509^`** (that is `88d4efa`), **`c760509`**, and **`7ba5f0c`**, plus the current `HEAD` of this worktree, capture the HyperFrames states with `tools/phase3/capture-hf.mjs` (and `capture-final.mjs` if the comments panel appears there) using the same fixtures and the same Chrome. Make the scratch copies with `git worktree add` into a path under this worktree's `tools/phase3/.scratch/` or under the scratch directory you are given (create `/tmp`-free locations only inside this worktree's `tools/phase3/.scratch/`, which you delete afterwards with `git worktree remove --force` and `rm -rf`), or with `git archive <commit> frontend tools/phase3 | tar -x -C <scratchdir>`; no `git checkout`, `git stash`, or `git reset` in this worktree. If the frontend needs `node_modules`, reuse `../VideoSaaS-engine/frontend/node_modules` by symlink inside the scratch copy only.
2. Compare each capture to the committed baseline (`hf-baseline`, `hf-final-baseline`) with `compare.mjs` and tabulate changed pixels and max delta per state. Run the capture of the same commit **three times** to show whether the diff is repeatable on a single commit (machine noise would also differ run to run or between machine states; a code change differs between commits but is stable within one).
3. State which commit first introduces the diff, and why (inspect the diff of the comments-panel component, CSS, borders/radii/shadows, fonts, `backdrop`/`transform`/`will-change` changes that move antialiasing at rounded corners). Confirm the cause by a one-line experiment in a scratch copy (e.g. revert only the suspected CSS lines there and re-capture: the diff must vanish).
4. Allowed outcomes (pick exactly one, with evidence): (a) the cause is a deliberate 4a change: recapture `tools/phase3/hf-after` (and `hf-final-after` if affected) at `HEAD`, leaving the baseline dirs alone, and list in the report exactly which image files changed and why; (b) the cause is a bug: describe it and the minimal fix as a proposal (frontend is forbidden here, so do not apply it) and do not recapture; (c) a tolerance, ONLY at the anti-alias level the other tools already use (count only pixels differing by more than 2 levels, as `compare.mjs`'s "Differing px (>2 levels)" column already does) and ONLY if that alone makes the files pass; `compare.mjs` gates every capture in the project, so it must NOT become a general loosening and no tolerance may be large enough to admit a max delta of 18. If the cause is machine or render state with a delta of 18, report it plainly and do not paper over it.

**Part 3: report** `docs/phase3/followups-tools-report.md` with: Part 1 evidence tables (10-page counts old/new, warm-up count chosen, the two final GPU runs and the software run, cold first-draw table summary), Part 2 table (commit x state x pixels x max delta x 3 runs), the cause, the action taken, and anything you could not do.

## Tests / exact commands (all from `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-followups-tools`)
```
node tools/phase3/engine-identity.mjs --out <scratch>/sw.json
node tools/phase3/engine-identity.mjs --gpu --out <scratch>/gpu1.json     # under .lock-timing
node tools/phase3/engine-identity.mjs --gpu --out <scratch>/gpu2.json     # under .lock-timing
node tools/phase3/capture-hf.mjs <outdir>
node tools/phase3/compare.mjs <baseline> <outdir> <diffdir>
```
Use the real flags/arguments the tools define; document them. The Chrome binary and `PLATE_BROWSER_PATH` handling are already in the tools; if the tools need `PLATE_BROWSER_PATH`, use the headless shell at `/Users/osamaehsaan/Code/Market_apps/VideoSaaS/experiments/anidoodle-try/pw-cache/chromium_headless_shell-1/chrome-headless-shell-mac-arm64/chrome-headless-shell` for engine tests and the same Chrome the existing tools default to for captures.

## Measurable acceptance criteria
1. Two consecutive GPU identity runs: `allIdentical: true`, 67/67, `skipped: []`, no row marked REAL DIFFERENCE, plus one software run 67/67; old-vs-old stability for the four known flip items over 10 fresh pages with the chosen warm-up count (or an evidenced exclusion).
2. `coldFirstDraw` information exists in the JSON and never affects `allIdentical`.
3. Part 2 names the introducing commit and the mechanism, with a confirming scratch experiment, and exactly one of the allowed outcomes (a), (b) or (c) from Part 2 step 4.
4. `git status` shows changes only under the allowed paths; scratch worktrees and `.scratch` removed; no engine/frontend source changes.

## Forbidden actions
- No `git commit`, push, reset, stash, checkout or branch changes in this worktree (the manager commits). `git worktree add/remove` only for your scratch copies as described. No deploys. No secrets, no `.env*`. No network except localhost servers on random free ports (never 3000, 4000, 4100, 8766, 55432, 58787, 59000). No staging/production/cloud/model calls. No Docker or plates-e2e stack. No other worktrees (do not write in them).
- **Timing lock for every Chrome run** (identity runs, captures). Create `/Users/osamaehsaan/Code/Market_apps/.lock-timing` atomically: `( set -C; echo "tools $(date -u +%FT%TZ)" > /Users/osamaehsaan/Code/Market_apps/.lock-timing )`; never check-then-create; never delete or overwrite a lock you did not create. If it is held by someone else, do non-Chrome work first (reading, writing the tool changes, report scaffolding), then retry every 30 seconds. Another track (an `opencode` lock waiter, pid file in the lock owner's note) may be waiting; take the lock only if the atomic create succeeds. If the lock is still held after 120 minutes in total, stop the Chrome part and say so in the report. Release your own lock immediately after each run, even on failure (use `trap`), and do not hold it while you only read or write files.
- Never change a tool's expectation or tolerance just to make it pass without evidence in the report.

## Report path
`docs/phase3/followups-tools-report.md`. End your final message with exactly: `DONE docs/phase3/followups-tools-report.md`
