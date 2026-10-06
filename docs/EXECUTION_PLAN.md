# VideoSaaS execution plan

Date: 2026-10-02

## 1. Product and initial customer

Build a tool for SaaS founders and small marketing teams that turns 3–6 screenshots and approved feature copy into a polished 20-second product video. The customer supplies facts; the system organizes and animates them. Screenshots remain the source of truth for product UI.

Initial promise: upload screenshots, select a brand, approve a storyboard, preview a draft, make a targeted revision, and export an MP4.

The working hypothesis is that reusable branding and dependable revisions save enough time to earn repeat usage. Technical feasibility, customer value, and commercial viability are separate gates. A successful render proves only technical feasibility.

## 2. Scope boundaries

### First local release

- One 20-second product-demo template with five scenes: hook, three feature moments, CTA.
- One clean visual style; second style only after the first passes validation.
- Landscape 1920×1080 at 30 fps first; vertical 1080×1920 uses a distinct layout.
- PNG/JPEG screenshots and logo, approved copy, supplied brand colors, bundled licensed font.
- Explicit focal region per screenshot; user or operator can adjust it.
- Draft and final MP4, poster frames, editable source, input manifest, run report.
- Scene-level changes to copy, crop, timing, and emphasis.
- Silent video initially. Sound effects and voiceover follow core visual validation.
- Local filesystem storage and one render at a time.

### First hosted release

The same workflow plus login, workspace ownership, project persistence, private uploads, asynchronous jobs, downloads, usage limits, and support diagnostics. Start with one owner per workspace; schema supports future members.

### Deferred

Full timeline editor, arbitrary generated executable code, cinematic footage generation, avatars, URL scraping, direct social publishing, localization, live collaboration, complex permissions, mobile apps, 4K/120 fps, and enterprise integrations. Voice and talking-head overlays are separate workflows with their own acceptance tests.

## 3. Implementation principles

1. Stabilize the rendering contract before building a dashboard.
2. AI outputs schema-validated scene data. Trusted code compiles scenes into HTML and animation timelines.
3. Use the same compiler and renderer adapter locally and in hosted workers.
4. Save immutable revisions and render from an explicit revision ID.
5. Record costs and operator time, including failed attempts.
6. Review actual video output as well as still frames; metadata checks alone cannot establish visual quality.
7. Keep approval attached to a revision so editing invalidates previous approval.

## 4. Milestones and decision gates

Estimates assume one experienced engineer, working assets, and timely feedback. They are effort ranges, not calendar commitments. Recruitment and customer decisions can extend elapsed time.

| Milestone | Effort | Deliverable | Required exit evidence |
| --- | --- | --- | --- |
| M0: environment and smoke render | 0.5–1 day | Pinned renderer, 6-second animation, environment report | Valid MP4, expected dimensions/fps/duration, observed animation |
| M1: local vertical slice | 3–5 days | Brief → validated storyboard → 20-second demo → targeted revision | Real screenshots; complete run report; repeatable outputs |
| M2: technical and customer validation | 5–8 engineering days plus recruitment | Fixture matrix, benchmark report, five customer trials | Technical gate and customer gate below |
| M3: local browser app | 4–6 days | Next.js web, Fastify API, renderer worker on local Postgres + pg-boss: asset upload, storyboard editor, job status, preview/download | Complete workflow from browser with restart recovery |
| M4: hosted private beta | 8–12 days | Vercel web; Railway `backend` and `worker`; Supabase Auth and Postgres; R2 storage | Tenant isolation, retry/cancel/recovery across deploys, cost and access checks |
| M5: paid pilot | 4–6 days plus customer observation | Entitlements, usage ledger, payments, support workflow | Paid usage and margins measured |

Planning envelope: roughly 26–38 engineering days to paid-pilot readiness; re-estimate after M2. Do not treat four styles and four video workflows as prerequisites for validation.

The selected stack shifts effort between milestones without changing the envelope: M3 now builds on Postgres and pg-boss directly (more upfront than SQLite), which removes the SQLite-to-Postgres migration and second queue implementation from M4. Managed auth and backups reduce M4 work; multi-vendor setup and the Supabase lockdown add some back. See [Stack decisions](STACK_DECISIONS.md).

### Gate A: local technical feasibility

- Render a 6-second smoke composition and a 20-second screenshot demo locally.
- Successful output uses H.264 MP4, requested dimensions, 30 fps, and expected frame count within one frame.
- No blank frames, clipped copy, unintended UI crop, missing images/fonts, or broken scene transitions in review.
- Three rerenders of the same revision have consistent layout and timing. Byte-identical output across hardware is not required.
- Record total authoring time separately from render time; record machine, renderer, browser, template, and font versions.
- Proposed performance target: p95 render time under 120 seconds for a 20-second 1080p video on the measured machine. Treat this as a target until benchmarked.

### Gate B: local product quality and reliability

- At least 20 automated render jobs across five input sets; count failures before retries as well as final outcomes.
- At least 19/20 jobs finish without manual code repair, with no critical quality defects in accepted outputs.
- Test long copy, varied screenshot shapes, missing assets, an interrupted render, repeated submissions, and a vertical export.
- A change to scene 3 leaves scene definitions and input assets for scenes 1, 2, 4, and 5 unchanged; compare representative output frames outside transitions.
- First publishable draft within 15 minutes of operator effort and at most two revision rounds on at least four of five normal briefs.
- Benchmark report includes peak worker memory, output size, draft/final timing, failures, and revision effort.

### Gate C: customer value

- Five target users provide or approve actual product assets and briefs.
- At least three rate the result publishable after no more than two revisions.
- At least two agree to a paid pilot or pay for delivery; praise alone is insufficient evidence.
- Record what they currently use, baseline production time/cost, next video need, and how often that need repeats.
- Require permission before sharing their screenshots or clips outside their project.

### Gate D: private beta readiness

- Browser creation-to-download flow works across a reload and worker restart.
- Cross-workspace access tests fail for projects, uploads, job IDs, revisions, and downloads.
- Duplicate requests and queue redelivery cannot create double charges or multiple active jobs for the same request.
- Failed/expired jobs release reservations; cancellation terminates the render process tree.
- Restore a database backup and reconnect the referenced assets in staging.
- Cloud workers pass the local fixture suite before onboarding external customers.

### Decision after M2

Proceed if technical and customer gates pass. If quality fails, narrow the scene library and fix crops/copy fitting. If demand fails, test a repeatable feature-release use case with agencies or product marketing teams before increasing product scope. If performance fails, profile rendering and retry costs before selecting worker infrastructure.

## 5. Local execution sequence

1. Record tool versions; pin HyperFrames in a local package and save a lockfile. Avoid depending on a moving `latest` version in automation.
2. Create a small composition with visible animation and render it; inspect MP4 metadata and several frames, then play it.
3. Add fixture inputs and versioned brief/storyboard schemas.
4. Hand-author one good storyboard and scene template. This establishes the quality baseline before introducing model variability.
5. Compile it into a composition with local assets and fonts; validate, render, and collect results.
6. Add an AI planner behind an adapter: it proposes scene content and crops, receives schema errors, and gets at most one repair attempt.
7. Add revision commands that patch approved fields of a specified scene and create a new revision.
8. Run failure cases and benchmarks. Save evidence for every attempt.
9. Conduct customer trials using this local pipeline. Human delivery is sufficient for learning.
10. Build M3 only after the pipeline works; move to hosted infrastructure after the M2 decision.

## 6. Frontend work packages

| Area | Required behavior | Completion evidence |
| --- | --- | --- |
| Projects | Create, list, rename, reopen, archive | Reload preserves project and latest revision |
| Brand kit | Logo, colors, approved fonts, default CTA | Preview and export use the saved version |
| Assets | Drag/drop, thumbnails, dimensions, errors, reorder | Wrong type/oversize file rejected; missing asset recoverable |
| Brief | Product promise, audience, feature copy, CTA, format | Missing claims/assets flagged before planning |
| Storyboard | Five scene cards with copy, duration, screenshot, focal crop | Manual edits persist and invalidate old approval |
| Preview | Draft playback, scene seek, muted/paused defaults, progress | Video ready/error states are distinct and accessible |
| Revisions | Edit scene fields or request a scoped change | New revision, comparison, rollback; unaffected scenes preserved |
| Export | Size/style choices, cost/quota, approve final, download | Download belongs to selected revision and export format |
| Account | Sign-in, usage, retention controls, billing later | Session and quota states recover correctly |

Design for desktop creation first and usable mobile viewing. Include keyboard navigation, form labels, visible focus, progress announcements, responsive layout, and useful empty/error states. Avoid showing raw compiler logs to customers; offer a diagnostic ID.

## 7. Backend work packages

- Versioned API contracts and shared validation schemas.
- Project, brand, asset, storyboard-revision, approval, and render persistence.
- Upload intent and completion checks; local filesystem adapter first, private object storage later.
- Planning service with validated outputs, model/version capture, token usage, and limits.
- Deterministic scene compiler and renderer adapter with structured errors.
- Durable queue, worker leases, progress, cancellation, retry limits, and restart recovery. Status 2026-10-04: queue, fenced attempts, real progress, retries, dead letters, and restart/crash recovery are done locally ([Render queue](RENDER_QUEUE.md)). Open: cancellation (JOB-03), least-privilege worker role (DB-03), and R2 for outputs and render inputs (MEDIA-02, BRAND-02), which hosted rendering with more than one worker depends on.
- Tenant-aware authorization and download signing.
- Quotas, idempotent usage reservations, and payment webhook reconciliation.
- Diagnostics, retention jobs, cleanup, backup/restore, CI and deployment procedures.

Hosting: the API and planner run in the Railway `backend` service, rendering in the Railway `worker` service, auth and Postgres on Supabase, media on Cloudflare R2, and the frontend on Vercel.

See [Architecture](ARCHITECTURE.md) for contracts, [Stack decisions](STACK_DECISIONS.md) for the reasoning behind each vendor, [Frontend plan](WEB_APP_IMPLEMENTATION.md) for the UI, and [Backlog](BACKLOG.md) for dependency order.

## 8. Economics and pricing experiment

Measure cost per accepted video, including all drafts, failed jobs, model calls, CPU time, storage/egress, and operator minutes. Report cash infrastructure cost and labor cost separately.

`accepted-video cost = total measured production cost / number of customer-accepted videos`

Test a fixed-price pilot with a small number of exports and clearly stated revision limits. Quote after measured costs and interviews; the earlier 10–20 videos/month suggestion is a hypothesis, not an approved plan. Avoid unlimited rendering. Evaluate recurring subscriptions only when customers return for a second production need.

## 9. Risks and mitigation work

| Risk | Detection | Planned response |
| --- | --- | --- |
| Attractive demo but low repeat need | Customers do not request a second video | Test release updates and campaigns |
| Generic or unreadable output | Blind ratings and phone-size review | Better scene direction, focal crops, copy limits |
| False product claims | Compare storyboard copy with approved input | Claim provenance; explicit review before approval |
| Unreliable AI edits | Unrelated scenes change | Patch scene data, immutable revisions |
| Slow or memory-heavy renders | Per-job metrics and fixture benchmark | Bounded concurrency; simplify effects; cache staged assets |
| Cross-platform differences | macOS vs Linux fixture outputs | Pin browser/runtime/fonts; toleranced image comparisons |
| Queue duplicates and worker crashes | Redelivery/restart tests | Idempotency, leases, fencing, bounded retries |
| User media exposed | Authorization and signed URL tests | Private storage, scoped object keys, retention policy |
| Runtime changes upstream | Lockfile/version update CI | Adapter boundary; run fixture suite on upgrades |
| Tenant data exposed through Supabase Data API | Anon-key access test in QA-02 | App tables in unexposed `app` schema; privileges revoked; RLS deny-all |
| Renders killed during deploys | Redeploy-during-render test | Draining time set; heartbeats, fencing, and retries make a kill safe |
| Railway ↔ Supabase latency or connection limits | API and queue timing; connection counts | Same region; session pooler; small pools; move to Railway Postgres if needed |
| Render compute cost on Railway | Per-job CPU/RAM metrics from benchmarks | Renderer is a portable Docker image; move to dedicated or spot compute |
| Multi-vendor misconfiguration | Staging checks per environment | `.env.example` per app; preview deploys point only at staging |

## 10. What is validated today

The supplied PDF describes a technically plausible workflow. Official HyperFrames documentation confirms HTML video rendering and related CLI capabilities. We also installed a pinned renderer and successfully exported a six-second animation on this machine: 1920×1080, H.264, 30 fps, 180 frames, 18.335-second render-command time. Metadata and three extracted frames were checked. Full playback, screenshot-demo quality, repeatability, customer demand, and margins remain unproven. The live evidence and outstanding tests are recorded in [Local validation](LOCAL_VALIDATION.md).

## References

- Input: `Motion-Graphics-with-Claude-Code.pdf` in the project root. Its examples are inspiration, not benchmark evidence for this product.
- [HyperFrames CLI guide](https://github.com/heygen-com/hyperframes/blob/main/docs/developers/cli.mdx), checked 2026-10-02. Installed CLI help is authoritative for exact flags.
- [HyperFrames quickstart](https://github.com/heygen-com/hyperframes/blob/main/docs/quickstart.mdx), checked 2026-10-02. Local renderer and model/hosted-service costs are separate.
- [HyperFrames CLI reference](https://github.com/heygen-com/hyperframes/blob/main/docs/packages/cli.mdx), checked 2026-10-02. Pin dependencies and verify commands against the installed release.
