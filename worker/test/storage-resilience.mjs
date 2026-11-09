// Storage & plate Chromium resilience unit tests (plain Node, offline, no network, no Docker, no DB):
//   1. S3 retry wrapper (connection reset, 5xx, throttling, timeouts up to 4 tries; S3Client maxAttempts: 5 + timeouts)
//   2. Upload size verification (uploadOutput / uploadPlateOutput) and partial download file deletion on failed pipeline
//   3. ENOSPC handling ("The render worker ran out of disk space.", code "worker_disk_full", cleans scratch dir)
//   4. Chromium crash/disconnect/"Target closed" in plates.mjs fails as retryable (not permanent), closes browser & kills process in finally, and bounds check (120 s default) and draw (10 min default) with watchdog timeouts
// Run: node test/storage-resilience.mjs
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  DISK_FULL_CODE,
  DISK_FULL_MESSAGE,
  S3_CONNECTION_TIMEOUT_MS,
  S3_MAX_ATTEMPTS,
  S3_REQUEST_TIMEOUT_MS,
  createS3Client,
  downloadAtomic,
  isDiskFullError,
  isTransientStorageError,
  uploadOutput,
  uploadPlateOutput,
  withStorageRetry
} from "../src/storage.mjs";
import {
  closeAndKillBrowser,
  getCheckTimeoutMs,
  getDrawTimeoutMs,
  handlePlateRender,
  isBrowserCrashOrTimeout,
  prepareManifestClips,
  probeRendererString
} from "../src/plates.mjs";

const unhandled = [];
process.on("uncaughtException", (err) => unhandled.push(err));
process.on("unhandledRejection", (err) => unhandled.push(err));

test("1. S3 retry wrapper & client config: retries transient failures up to 4 tries and verifies S3Client maxAttempts: 5 + timeouts", async () => {
  assert.equal(S3_MAX_ATTEMPTS, 5);
  assert.ok(S3_CONNECTION_TIMEOUT_MS > 0 && S3_REQUEST_TIMEOUT_MS > 0);
  const s3 = createS3Client({
    endpoint: "http://127.0.0.1:9000",
    accessKeyId: "test",
    secretAccessKey: "test-secret"
  });
  assert.equal(await s3.config.maxAttempts(), 5, "S3Client configured with maxAttempts: 5");
  s3.destroy();

  // Transient error classification
  for (const err of [
    Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    Object.assign(new Error("SlowDown"), { name: "SlowDown", $metadata: { httpStatusCode: 503 } }),
    Object.assign(new Error("Throttling"), { name: "ThrottlingException", $metadata: { httpStatusCode: 429 } }),
    Object.assign(new Error("RequestTimeout"), { name: "RequestTimeout", $metadata: { httpStatusCode: 408 } }),
    Object.assign(new Error("InternalError"), { $metadata: { httpStatusCode: 500 } })
  ]) {
    assert.equal(isTransientStorageError(err), true, `expected ${err.message} to be transient`);
  }
  assert.equal(isTransientStorageError(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } })), false);
  assert.equal(isTransientStorageError(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" })), false);

  // Retries 3 failures and succeeds on 4th try
  let tries = 0;
  const res = await withStorageRetry(
    async (attempt) => {
      tries = attempt;
      if (attempt < 4) throw Object.assign(new Error("ServiceUnavailable"), { $metadata: { httpStatusCode: 503 } });
      return "ok";
    },
    { tries: 4, baseDelayMs: 5, maxDelayMs: 20 }
  );
  assert.equal(res, "ok");
  assert.equal(tries, 4);

  // Exhausts at 4 tries and throws
  let failTries = 0;
  await assert.rejects(
    () =>
      withStorageRetry(
        async (attempt) => {
          failTries = attempt;
          throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
        },
        { tries: 4, baseDelayMs: 5, maxDelayMs: 20 }
      ),
    /ECONNRESET/
  );
  assert.equal(failTries, 4, "stops after 4 tries");
});

test("2. Upload size verification (uploadOutput / uploadPlateOutput) and failed pipeline download deletes partial local file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "storage-resil-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const localMp4 = join(dir, "out.mp4");
  const bytes = Buffer.from("rendered-video-bytes-0123456789");
  await writeFile(localMp4, bytes);

  let putCount = 0;
  const deletedKeys = [];
  const fakeS3 = {
    async send(cmd) {
      const name = cmd.constructor.name;
      if (name === "PutObjectCommand") {
        putCount += 1;
        cmd.input.Body?.resume?.();
        if (putCount === 1) {
          throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
        }
        return {};
      }
      if (name === "HeadObjectCommand") {
        // Attempt 2: simulate corrupted/partial upload with wrong ContentLength
        if (putCount === 2) return { ContentLength: 4 };
        return { ContentLength: bytes.length };
      }
      if (name === "DeleteObjectsCommand") {
        deletedKeys.push(...cmd.input.Delete.Objects.map((o) => o.Key));
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };

  const buckets = { uploads: "in-b", outputs: "out-b" };
  const retryOpts = { tries: 4, baseDelayMs: 5, maxDelayMs: 20 };
  const size = await uploadOutput(localMp4, "renders/job-1/a1.mp4", { s3Client: fakeS3, buckets, retryOpts });
  assert.equal(size, bytes.length);
  assert.equal(putCount, 3, "retried ECONNRESET and ContentLength mismatch");
  assert.deepEqual(deletedKeys, ["renders/job-1/a1.mp4"], "deleted partial object when HeadObject size mismatched");

  const plateSize = await uploadPlateOutput(localMp4, "plates/p/clip.mp4", "video/mp4", { s3Client: fakeS3, buckets, retryOpts });
  assert.equal(plateSize, bytes.length);

  // Failed pipeline download mid-stream deletes the partial local file and does not emit unhandled stream error
  const targetDownload = join(dir, "partial-download.bin");
  const failingDownloadS3 = {
    async send(cmd) {
      if (cmd.constructor.name === "GetObjectCommand") {
        let pushed = false;
        const brokenStream = new Readable({
          read() {
            if (!pushed) {
              pushed = true;
              this.push(Buffer.from("partial-bytes-before-reset"));
            } else {
              this.destroy(Object.assign(new Error("Non-retryable stream failure"), { code: "EACCES" }));
            }
          }
        });
        return { ContentLength: 1000, Body: brokenStream };
      }
      throw new Error("unexpected");
    }
  };

  await assert.rejects(
    () => downloadAtomic(failingDownloadS3, "in-b", "bad-key", targetDownload, { retryOpts: { tries: 1, baseDelayMs: 5, maxDelayMs: 10 } }),
    /Non-retryable stream failure/
  );
  await assert.rejects(
    () => access(targetDownload),
    "partial local file must be deleted when pipeline download fails"
  );
});

test("3. ENOSPC handling: fails with 'The render worker ran out of disk space.' (code worker_disk_full) and cleans scratch dir", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "enospc-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.equal(DISK_FULL_MESSAGE, "The render worker ran out of disk space.");
  assert.equal(DISK_FULL_CODE, "worker_disk_full");
  assert.equal(isDiskFullError(Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" })), true);

  const variantId = randomUUID();
  const projectId = randomUUID();
  const ops = [];
  const fakeControl = {
    async op(name, args) {
      ops.push({ name, args });
      if (name === "plate.claim") {
        return {
          row: {
            id: variantId,
            project_id: projectId,
            scene_index: 0,
            aspect: "16:9",
            gen: 1,
            render_attempt: 1,
            width: 1920,
            height: 1080,
            fps: 30,
            frames: 60,
            bundle_key: `plates/${projectId}/16x9/0/g1/bundle.html`
          }
        };
      }
      return { ok: true };
    }
  };

  await handlePlateRender(
    { data: { variantId, gen: 1 }, retryCount: 0, signal: new AbortController().signal },
    {
      control: fakeControl,
      probeRenderer: async () => "Google SwiftShader",
      storageImpl: {
        downloadPlateInput: async () => {
          throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
        },
        uploadPlateOutput: async () => 10,
        deleteOutputs: async () => {}
      }
    }
  );

  const failedOp = ops.find((o) => o.name === "plate.failed");
  assert.ok(failedOp, "ENOSPC marks plate.failed");
  assert.equal(failedOp.args.error.code, "worker_disk_full");
  assert.equal(failedOp.args.error.message, "The render worker ran out of disk space.");
  await assert.rejects(
    () => access(join("/tmp", `plate-${variantId}-a1`)),
    "scratch directory is cleaned up after ENOSPC"
  );
});

test("4. Chromium crash/hang in plates.mjs: crash/disconnect/'Target closed' is retryable (not permanent), browser closed + process killed in finally, and watchdogs bound check (120 s) and draw (10 min)", async () => {
  // Verify default watchdog timeouts and env overrides
  assert.equal(getCheckTimeoutMs(), 120_000, "default check watchdog timeout is 120 s");
  assert.equal(getDrawTimeoutMs(), 600_000, "default draw watchdog timeout is 10 min (600 s)");

  // Verify crash/disconnect/Target closed classification
  for (const msg of ["Page crashed", "Browser disconnected", "Target closed", "Target page, context or browser has been closed"]) {
    assert.equal(isBrowserCrashOrTimeout(new Error(msg)), true, `expected '${msg}' to be recognized as browser crash/close`);
  }

  // Verify probeRendererString with fake browser/page:
  // (a) page emits 'crash' -> rejects as retryable (permanent: false), calls browser.close() and kills browser process in finally
  let closeCalls = 0;
  let killSignals = [];
  const fakeChromium = {
    async launch() {
      const browser = new EventEmitter();
      browser.close = async () => { closeCalls += 1; };
      browser.process = () => ({
        pid: 999999,
        kill(sig) { killSignals.push(sig); }
      });
      browser.newPage = async () => {
        const page = new EventEmitter();
        page.setDefaultTimeout = () => {};
        page.evaluate = () =>
          new Promise(() => {
            setTimeout(() => page.emit("crash"), 15);
          });
        return page;
      };
      return browser;
    }
  };

  await assert.rejects(
    () => probeRendererString({ force: true, timeoutMs: 500, chromiumImpl: fakeChromium }),
    (err) => {
      assert.match(err.message, /Page crashed/i);
      assert.equal(err.permanent, false, "page crash is retryable, not permanent");
      assert.equal(err.kind, "infra");
      return true;
    }
  );
  assert.equal(closeCalls, 1, "browser.close() called in finally");
  assert.deepEqual(killSignals, ["SIGKILL"], "browser process killed with SIGKILL in finally");

  // (b) In handlePlateRender, even if verifyScene throws a crash error marked kind="code" (e.g. "Scene failed to start: Browser disconnected"),
  //     plates.mjs treats it as a retryable infra failure (calls plate.retry and throws), NEVER plate.sendBackForRepair or permanent failure.
  const variantId = randomUUID();
  const projectId = randomUUID();
  const ops = [];
  const fakeControl = {
    async op(name, args) {
      ops.push({ name, args });
      if (name === "plate.claim") {
        return {
          row: {
            id: variantId,
            project_id: projectId,
            scene_index: 1,
            aspect: "16:9",
            gen: 1,
            render_attempt: 1,
            width: 1920,
            height: 1080,
            fps: 30,
            frames: 60,
            bundle_key: `plates/${projectId}/16x9/1/g1/bundle.html`
          }
        };
      }
      return { ok: true };
    }
  };

  for (const crashMsg of ["Page crashed", "Browser disconnected", "Target closed"]) {
    ops.length = 0;
    await assert.rejects(
      () =>
        handlePlateRender(
          { data: { variantId, gen: 1 }, retryCount: 0, signal: new AbortController().signal },
          {
            control: fakeControl,
            probeRenderer: async () => "Google SwiftShader",
            storageImpl: {
              downloadPlateInput: async (_k, file) => writeFile(file, "<html></html>"),
              uploadPlateOutput: async () => 10,
              deleteOutputs: async () => {}
            },
            engineImpl: {
              classifyFailure: (e) => (e?.kind === "code" ? "code" : "infra"),
              verifyScene: async () => {
                throw Object.assign(new Error(`Scene failed to start: ${crashMsg}`), { kind: "code" });
              },
              renderScene: async () => {},
              probeVideo: async () => ({ width: 1920, height: 1080, fps: 30, frames: 60 })
            }
          }
        ),
      (err) => err.permanent === false && err.kind === "infra"
    );
    assert.equal(ops.some((o) => o.name === "plate.sendBackForRepair"), false, `crash '${crashMsg}' must not trigger model repair`);
    assert.equal(ops.some((o) => o.name === "plate.failed"), false, `crash '${crashMsg}' on attempt 1 must not permanently fail`);
    assert.equal(ops.some((o) => o.name === "plate.retry"), true, `crash '${crashMsg}' triggers plate.retry`);
  }

  // (c) Watchdog bounds a hung scene check and a hung scene draw (even if verifyScene/renderScene ignores signal)
  ops.length = 0;
  await assert.rejects(
    () =>
      handlePlateRender(
        { data: { variantId, gen: 1 }, retryCount: 0, signal: new AbortController().signal },
        {
          control: fakeControl,
          probeRenderer: async () => "Google SwiftShader",
          checkTimeoutMs: 60,
          storageImpl: {
            downloadPlateInput: async (_k, file) => writeFile(file, "<html></html>"),
            uploadPlateOutput: async () => 10,
            deleteOutputs: async () => {}
          },
          engineImpl: {
            classifyFailure: () => "infra",
            verifyScene: () => new Promise(() => {}), // hangs forever ignoring signal
            renderScene: async () => {},
            probeVideo: async () => ({ width: 1920, height: 1080, fps: 30, frames: 60 })
          }
        }
      ),
    (err) => err.code === "plate_watchdog_timeout" && err.permanent === false
  );
  assert.equal(ops.some((o) => o.name === "plate.retry"), true, "watchdog timeout on check triggers plate.retry");

  assert.equal(unhandled.length, 0, "zero unhandled exceptions or rejections");
});
