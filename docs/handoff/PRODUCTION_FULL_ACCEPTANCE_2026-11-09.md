# Production End-to-End Acceptance Report (2026-11-09)

## 1. Executive Summary & Release Identity

- **Overall Verdict**: **PASS — Production Release `64570b64c338375b06d3ca1c8c8c4cb4612036e5` Passed End-to-End Across All 3 Representative Films (4 Final MP4 Exports across `16:9`, `9:16`, and `1:1`) and All Automated/Live Acceptance Suites**.
- **Production Release Identity**:
  - **Git Commit SHA (`origin/production` & `origin/staging`)**: `64570b64c338375b06d3ca1c8c8c4cb4612036e5` (`64570b6`)
  - **Railway Production Backend (`lively-presence / production / backend`)**:
    - Project ID: `5298f20e-3531-44a5-a32e-7b99b0cb5b09`
    - Environment ID: `2f57bf5f-a2db-4b65-98bc-c8d12d120149`
    - Service ID: `df6c5746-6c6e-4275-897d-75bb0cd6370b`
    - Deployment ID: `8b126a59-1283-44c8-8e50-91a359e05441` (`SUCCESS`, `https://backend-production-1e413.up.railway.app`)
  - **Vercel Production Frontend (`greddy-motion/greedy-motion`, `prj_ujsBrhqMWMk0XfBQXaJrEXbqOh2i`)**:
    - Deployment ID: `dpl_8876aYyp8wWQYuW27TteiALQka8v` (`https://greedy-motion-b49jmnyoo-greddy-motion.vercel.app`, `READY`, aliased to `https://app.greedymotion.com`, `https://www.greedymotion.com`, `https://greedymotion.com`)
  - **AWS ECS Production Render Worker (`us-east-1`, Cluster `greedymotion-production`)**:
    - ECR Image: `369904858685.dkr.ecr.us-east-1.amazonaws.com/greedymotion-production-worker:64570b6-180129`
    - Image Digest: `sha256:5096e88ce9c3e1e0dbd2c884790cdf8f404443361121fb3c9d990206260f367d`
    - Task Definition: `arn:aws:ecs:us-east-1:369904858685:task-definition/greedymotion-production-worker:2`
  - **Supabase Production (`pylqstxqvucrrzpcjkem`, `us-east-1`)**:
    - Migration `031_before_user_created_hook.sql` applied; `[auth.hook.before_user_created]` enabled (`pg-functions://postgres/app/before_user_created_hook`).

---

## 2. Three Representative Fresh Production QA Films (0 to 100)

All 3 representative films were created from scratch in the authenticated production browser session (`tab_d7d9f07b-352c-4a83-9566-f2105318e6ed` on `https://app.greedymotion.com`, Free-tier test account `46084fef-ae02-4544-b7e0-0bf1e3601d51`), preserving the pre-existing project `4270b083-fbb5-407b-9a5a-31d61062201c` and completing within the account's natural 3-film lifetime preview allowance and 33-token grant (`33.0 -> 21.9 -> 9.9` tokens remaining).

### Film 1: Starter-Template `stat-highlight` Planner + Screenshot Upload + `gm-velocity-sting` Format Render
- **Project ID**: `ce8ec7ec-051d-4106-b9d4-a53c0eec29f0` (`QA Film 1 - Stat Highlight Planner & Screenshot`, `template: "stat-highlight"`)
- **Screenshot Upload (`POST /v1/projects/:id/screenshots`)**:
  - Screenshot ID: `27ba2162-678c-49b1-a1d0-76d9f3c430c1` (`dashboard-metrics.png`, `640x360`, `201 Created` in `1,262ms`).
- **Gemini Starter-Template Planner (`POST /v1/projects/:id/script` -> `planner` step on `gemini:gemini-3.8-flash`)**:
  - Status: `201 Created` in `10,587ms`.
  - Generated 5 structured scenes: `Setup` (`"Cut launch video production from six hours."`), `Count-up` (`"4min Total production time"`), `Why it matters` (`"Capture live browser plates with deterministic frame accuracy."`), `Source` (`"Source: internal customer survey, Q3"`), `Call to action` (`"Greedy Motion · Create your next video"`).
- **Format Fill & HyperFrames Render (`POST /v1/formats/gm-velocity-sting/render` -> `formatFill` step on `gemini:gemini-3.8-flash`)**:
  - Render Job ID: `5f230ab9-f439-415a-b955-d1248b5e2e36` (`gm-velocity-sting@1.1.2`, `fillMs: 17,546ms`, `202 Accepted`).
  - Worker Completion & `ffprobe` Verification:
    - `state: "ready"`, `stage: "done"`, `progress: 100`, `frames_done: 358 / 358`.
    - Downloaded MP4 (`1,967,208 bytes`): `h264 (High)`, `1080x1080` (`1:1`), `358 frames`, `11.933333 s`, `aac` stereo audio (`561 frames`).
    - Verified in browser `<video>` element (`readyState: 4`, `1080x1080`, `duration: 11.933333`).

### Film 2: Illustrated/Plate `Blueprint` (`illus-blueprint`) in English — Multi-Ratio `16:9` + `9:16`
- **Project ID**: `d2e62bb8-d2e7-4127-816c-ab3f84b86c58` (`A brass pocket watch and a digital stopwatch on a workbench debate precision`, `look: "illus-blueprint"`, `aspects: ["16:9", "9:16"]`)
- **Brief & Script Generation (`script/stream` on `gemini:gemini-4-argon`)**:
  - Generated 3 beats (`sb-1-abvclxe: Split one second?`, `sb-2-kxl5kjp: Continuous sweep`, `sb-3-l9bjw83: Thousand splits`) and 3 SVG reference frames (`script/frames` on `gemini:gemini-3.8-flash`).
- **Storyboard Scene Editing & Refresh Persistence**:
  - **Insert Scene (`POST /v1/projects/:id/script/scenes/insert` at index 1)**: Inserted `"A magnifying loupe zooms in on the brass escapement gear ticking."` (`beats.length: 3 -> 4`); verified neighbor IDs (`sb-1-abvclxe` at index 0 and `sb-2-kxl5kjp` at index 2) remained 100% stable.
  - **Remove Scene (`POST /v1/projects/:id/script/scenes/remove` at index 1)**: Removed the test scene (`beats.length: 4 -> 3`), restoring the exact original beat IDs (`["sb-1-abvclxe", "sb-2-kxl5kjp", "sb-3-l9bjw83"]`), and verified persistence across page reload.
- **Voiceover, Animation & Storyboard Sketch Playback While Processing**:
  - Built voiceover + music (`Build voiceover` -> `Keep 15s` -> `Create animation →`).
  - Verified that while Scene 1 was still being written (`"Scene 1 is being written · under a minute"`), `button.aw-play` was **enabled (`playDisabled: false`)**, `.aw-wait-sketch` was visible on stage, clicking Play played the storyboard sketch with voiceover while keeping `.aw-film-toast` visible above, and seamlessly advanced from Scene 1 (`0:00 -> 0:02`) into Scene 2 (`0:03 -> 0:07`, `Scene 2 · Continuous sweep`).
- **Live Browser Checks (`16:9` and `9:16`), Playback, Seek & Comment Redraw**:
  - All 3 `16:9` variants and all 3 `9:16` variants passed browser Worker verification (`checksRun: 3`, `mode: "live", reason: "ok", state: "checked"`, `drawnAspects: ["16:9", "9:16"]`, `drawingAspects: []`) with zero stuck `Checking`.
  - Verified live playback, seek to Scene 2/3, pause (`labelPaused: "Play"`), and resume (`labelResumed: "Pause"`).
  - **Comment Redraw (`POST /v1/projects/:id/plates/comments` + `/plates/fix`)**: Added comment at `0.5s` (`"Make the highlight bracket pulse brighter cyan"`) on Scene 1 (`index: 0`). Verified ONLY Scene 1 incremented `rev` (`0 -> 1`) and queued for redraw while Scene 2 (`index: 1`) and Scene 3 (`index: 2`) remained untouched at `rev: 0, state: "checked"`. Scene 1 (`rev: 1`) completed authoring and browser check in both `16:9` and `9:16`.
- **Billing Idempotency & Multi-Ratio Final Exports (`16:9` + `9:16`)**:
  - Sent 3 concurrent `POST /v1/projects/:id/render` requests with the same `Idempotency-Key`: all 3 returned the **single** render job `d673339f-2ab4-485b-ac00-87401e9271bf` (`allSameJobId: true`), charging **once** (`33.0 -> 21.9`, `11.1` tokens, matching the exact `Render · 11.1 tokens` UI quote).
  - **`16:9` Final Render (`d673339f-2ab4-485b-ac00-87401e9271bf`)**: `state: "ready"`, `495 / 495 frames`, `3,309,951 bytes`, `h264 (High)`, `1920x1080`, `16.500000 s`, `aac` stereo (`775 frames`), `readyState: 4` in `FinalView`.
  - **`9:16` Companion Export (`fbeb2456-800d-431b-9368-0629d17d8cf8`, signature `x3:3034a4a183415f92e99b98b3`)**: `state: "ready"`, `495 / 495 frames`, `3,455,000 bytes`, `h264 (High)`, `1080x1920` (native portrait layout, not cropped), `16.500000 s`, `aac` stereo (`775 frames`), `readyState: 4` in `FinalView`.
  - **Free-Tier 4-Second Alternating Stacked Watermark Visual Verification**: Extracted frames at `t=1s`, `t=5s`, and `t=9s` from `d673339f-2ab4-485b-ac00-87401e9271bf` (`16:9`) and `t=5s` from `fbeb2456-800d-431b-9368-0629d17d8cf8` (`9:16`), visually confirming the narrow centered stacked watermark (`[Greedy Motion logo] / Greedy / Motion`) on the **LEFT** (`~40%` height) at `t=1s`, **RIGHT** (`~60%` height) at `t=5s`, and **LEFT** (`~40%` height) at `t=9s`.

### Film 3: Folk-Tale Painted/Storybook Style (`illus-folk-tale`) with Hindi (`hi`) Character Voices
- **Project ID**: `cc471b4d-d6a1-4f2c-8e6b-ad81c49d4a22` (`QA Film 3 - Hindi Folk Tale Character Voices`, `look: "illus-folk-tale"`, `language: "hi"`, `cast: "characters"`, `voices: { Kavi: "Puck", Tara: "Aoede" }`, narrator default `Kore`)
- **Hindi Script Streaming (`script/stream` on `gemini:gemini-4-argon`, `10,018ms`)**:
  - Beat 1 (`A glass stone`, `speaker: "Kavi"`): Hindi voice line `"तारा, देखो मुझे क्या मिला। यह काँच का टुकड़ा तो बिल्कुल सादा और बेरंग है।"` + English on-screen caption `"Under the banyan tree at dusk"`.
  - Beat 2 (`Catch the sunbeam`, `speaker: "Tara"`): Hindi voice line `"इसे ढलते सूरज की उस किरण के सामने रखो, कवि। फिर देखना यह क्या छुपाए बैठा है।"` + English on-screen caption `"Hold it to the evening sun"`.
  - Beat 3 (`Hidden colours wake`, `speaker: "Kavi"`): Hindi voice line `"अरे वाह, सफेद रोशनी के अंदर तो पूरा इंद्रधनुष छुपा था, और काँच ने उसे बाहर बुला लिया।"` + English on-screen caption `"White light splits into a rainbow"`.
- **Hindi TTS & Word Alignment (`script/voice` + `voiceAlign` on `gemini:gemini-2.5-flash` + Lyria music)**:
  - Synthesized all 3 Hindi character voice takes (`b1: 4.85s, 15 words`, `b2: 5.04s, 17 words`, `b3: 7.85s, 18 words`) and a 30.015s Lyria music bed (`music/bdec6d0e08d81652cfad.mp3`).
- **Step 3 Browser Check, Automatic Slow-Draw Clip Demotion & Playback**:
  - Browser ran `checksRun: 3`: Scene 1 (`index: 0`) was automatically identified as a heavy painted scene and demoted to `mode: "clip", reason: "slow-draw"` (`"Scene 1 is being prepared as a video for smooth playback"`), while Scene 2 and Scene 3 passed as `mode: "live"`.
  - Verified that while Scene 1's clip was being drawn by the worker, clicking Play played Scene 1's storyboard sketch with Kavi's Hindi voiceover (`0:00 -> 0:05`) and seamlessly transitioned into live Scene 2 (`0:05 -> 0:06`, `Scene 2 · Catch the sunbeam`).
- **Step 4 Final Render & `ffprobe` / Visual Verification (`993a8e56-9c57-42ab-9629-a0e40968d237`)**:
  - Charged `12.0` tokens (`21.9 -> 9.9` tokens remaining).
  - Worker (`worker/worker/76d5bee595134be08775648f7f82358b` on `greedymotion-production-worker:2` in `us-east-1`) verified software GL (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 16.0.0)))`), drew all 3 scenes (`585 frames`), and assembled the final film with 7 audio tracks in `231s`.
  - Downloaded MP4 (`3,948,636 bytes`): `h264 (High)`, `1920x1080`, `585 frames`, `19.500000 s`, `aac` stereo (`916 frames`), `readyState: 4` in `FinalView`.
  - Extracted frame at `t=2s` (`film3-hindi-t2s.png`), visually confirming Kavi the red fox holding the glass prism under the banyan tree with Tara the owl watching from the branch, English storybook subtitle `"Under the banyan tree at dusk"`, and the Free-tier stacked watermark on the left.

---

## 3. Compact Acceptance Matrix

| Category / Check | Mode | Verdict | Evidence |
|---|---|---|---|
| **Health, Readiness & Boot Model Routing** | Live Prod API + Logs | **PASS** | `/healthz` -> `200`, `/readyz` -> `200`, 24 gallery templates, 8 voice preview WAVs (`200`), 6 SFX MP3s (`200`). Boot log confirmed all 17 steps route to `gemini-4-argon`, `gemini-3.8-flash`, or `gemini-2.5-flash`. |
| **Auth: Valid Session Continuity & Public Redirects** | Live Prod Browser | **PASS** | Signed-in session on `https://app.greedymotion.com/studio` (`test@example.com`, `Free` tier); unauthenticated `/studio` redirects cleanly to `/auth?next=%2Fstudio` with zero redirect loops. |
| **Auth: Email Local-Part Validation (`+` & `>2` Dots)** | Live Prod UI + Automated | **PASS** | Production `/auth` Sign-in and Sign-up forms reject `user+tag@example.invalid` and `a.b.c.d@example.invalid` with exact messages; `0`, `1`, and `2` local dots (`nodots@example.com`, `one.dot@example.com`, `two.dots.ok@example.co.uk`) accepted. |
| **Auth: Provider-Side `Before User Created` Hook** | Live Prod Supabase (`pylqstxqvucrrzpcjkem`) | **PASS** | `POST https://pylqstxqvucrrzpcjkem.supabase.co/auth/v1/signup` rejected `verify+plus@example.invalid` (`400`) and `a.b.c.d.verify@example.invalid` (`400`) with **`0` rows** created in `auth.users`. `supabase db advisors` reported 0 issues on `app.before_user_created_hook`. |
| **Film 1: Starter-Template `stat-highlight` Planner + `screenshot` + `gm-velocity-sting` `formatFill` Render** | Live Prod Browser + API + Worker | **PASS** | Project `ce8ec7ec-051d-4106-b9d4-a53c0eec29f0` (`screenshot` `27ba2162-678c-49b1-a1d0-76d9f3c430c1`, `planner` 5 scenes in `10.6s`) + Format Job `5f230ab9-f439-415a-b955-d1248b5e2e36` (`1080x1080`, `11.933s`, `358 frames`, `1.97 MB` MP4). |
| **Film 2: `illus-blueprint` (`16:9` + `9:16`), Scene Insert/Delete, Sketch Playback, Comment Redraw & Dual Export** | Live Prod Browser + Worker | **PASS** | Project `d2e62bb8-d2e7-4127-816c-ab3f84b86c58`: scene insert/delete preserved neighbor IDs; sketch played with audio while writing; comment redraw bumped only Scene 1 (`rev 0 -> 1`); `16:9` job `d673339f-2ab4-485b-ac00-87401e9271bf` (`1920x1080`, `16.5s`, `3.31 MB`) + `9:16` export `fbeb2456-800d-431b-9368-0629d17d8cf8` (`1080x1920`, `16.5s`, `3.46 MB`). |
| **Film 3: `illus-folk-tale` Hindi (`hi`) Character Voices (`Kavi -> Puck`, `Tara -> Aoede`) & Final Export** | Live Prod Browser + Worker | **PASS** | Project `cc471b4d-d6a1-4f2c-8e6b-ad81c49d4a22`, Job `993a8e56-9c57-42ab-9629-a0e40968d237` (`1920x1080`, `19.5s`, `585 frames`, `3.95 MB` MP4 with Hindi dialogue + English storybook captions). |
| **Free-Tier 4s Alternating Stacked Watermark (`t=1s, 5s, 9s`)** | Live Prod MP4 Frame Extraction | **PASS** | Visually verified on `d673339f-2ab4-485b-ac00-87401e9271bf` (`16:9`), `fbeb2456-800d-431b-9368-0629d17d8cf8` (`9:16`), and `993a8e56-9c57-42ab-9629-a0e40968d237` (`16:9`): left at `t=1s`, right at `t=5s`, left at `t=9s`. |
| **Billing Quote, Idempotent Retry & Free-Tier 3-Film Preview Gate** | Live Prod API | **PASS** | 3x concurrent `POST /render` with `Idempotency-Key` created 1 job (`d673339f-2ab4-485b-ac00-87401e9271bf`) and charged once (`11.1` tokens). 4th preview project attempt returned `402 preview_limit` (`used: 3, limit: 3`). |
| **Pro Assistant Entitlement Gate (`proEditor`)** | Live Prod API + Staging Pro Verify | **PASS** | On Free production test account, `POST /v1/projects/:id/pro/assist` truthfully returned `403 not_pro`; full `skillRouting` + `proAssistant` execution verified on Pro-entitled staging account (`da50b74c-a628-4b70-80dd-2221f99295fb`). |
| **Responsive UI & `<=860px` Stacked Workspace Scrolling** | Live Prod Browser + Automated Chromium | **PASS** | Verified on live production CSS/DOM and across `1280x800`, `1088x730`, `861x775`, `860x775`, `855x775`, `783x730`, `390x844`, and `855x500` (`24/24` layout assertions passing). |
| **Console, Network & Service Error Audit** | Live Prod Browser + Railway + CloudWatch | **PASS** | `0` browser console errors in `tab_d7d9f07b-352c-4a83-9566-f2105318e6ed`, `0` `@level:error` logs on Railway `production` (`8b126a59-1283-44c8-8e50-91a359e05441`), and clean software-GL completion in `/ecs/greedymotion-production-worker`. |
| **Isolated Automated Regression Suites (`64570b6`)** | Local Throwaway DB + Chromium | **PASS** | `npm run typecheck` (all workspaces), `email-validation.mjs` (FE + BE), `plate-check-fallback.mjs` (8/8), `plate-progress-logic.mjs` (30/30), `workspace-bar-layout-fixture.mjs` (24/24). |
