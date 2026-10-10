# MEDIA-03 production setup

Prepared 2026-10-09. This is a repo preparation record, not evidence of a new deployment or provisioned bucket.

**No backfill is required for this rollout.** The owner confirmed there is no released user media to preserve. Treat the October 8 release-test uploads as disposable; start with new production media in R2. The [release record](MVP_RELEASE_STATUS.md) describes a technical deployment and smoke tests, not a requirement to migrate those test files. Existing test records may reference old volume files; recreate smoke projects when testing recovery. This procedure does not delete old files, objects, accounts or records.

## Existing implementation and staging evidence

- `backend/src/media.ts` writes project screenshots/site snapshots, brand files and generated audio to `media/projects/`, `media/brands/` and `media/audio/`. IDs and relative paths are retained; there is no owner prefix. API ownership checks provide tenant isolation.
- Local media directories remain a read cache. `ensureMedia` fetches missing files, and `ensureMediaDir` hydrates missing directory contents. Templates remain in Git. Prepared render inputs use the uploads bucket; rendered MP4s use the outputs bucket.
- Media tokens and ownership checks are implemented. `MEDIA_URL_SECRET` is required for authenticated backends and must be stable across deployments and replicas.
- Recorded staging evidence: `greedymotion-staging-media`, scoped backend credentials, seven files backfilled with MD5 checks, and recovery through public routes after local file loss (October 8). These are historical results, not fresh checks performed for this preparation.
- Staging's two-replica, no-volume gate remains open. Existing cached files are never revalidated against R2; mutable brand/editor files and deletions can remain stale on another replica. Directory listings also have a 60-second process-local cache. Resolve and test these cases before claiming replica safety.

## External setup required

| Location / access needed | Production action | Verification |
| --- | --- | --- |
| Cloudflare account with R2 bucket administration | Create private `greedymotion-production-media`; leave public development access and custom domains disabled | Read back bucket name and private access settings |
| Cloudflare R2 token administration | Create or update a **backend** S3 credential with Object Read & Write on production uploads, outputs and media buckets only | Use the backend credential for the recovery test below; confirm its bucket scope in the dashboard |
| Cloudflare lifecycle administration | Reuse staging rule `expire-pending-brand-uploads`: expire objects with prefix `media/brands/_staging/` after one day | Read back the rule and preserve any other rules; do not expire all `media/` |
| Railway project `lively-presence`, environment `production`, service `backend` | Set the variables below before deploying the MEDIA-03 release; retain one replica and the existing `/data` mount | Confirm variable names/non-secret values, deployment success and `/readyz` |
| Railway deployment/SSH access and a production test login | Run recovery and authenticated browser smoke checks on the deployed release | Record deployment commit/ID, smoke output and API results |

R2's S3 access key/secret are runtime credentials; the Cloudflare administrative API token is a different credential. Store runtime secrets in Railway, never in the frontend or Git. The ECS worker only needs the existing render uploads/outputs credentials; it does not read the media bucket directly. No worker credential expansion is required.

Cloudflare documents [bucket-scoped Object Read & Write credentials](https://developers.cloudflare.com/r2/api/tokens/) and [prefix-specific lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/). User media is proxied by the backend, so this migration does not require browser CORS on the media bucket. Existing output-bucket playback configuration is separate.

Required backend settings (actual secret values supplied through Railway):

```dotenv
STORAGE_DRIVER=r2
R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
R2_UPLOADS_BUCKET=greedymotion-production-uploads
R2_OUTPUTS_BUCKET=greedymotion-production-outputs
R2_MEDIA_BUCKET=greedymotion-production-media
R2_ACCESS_KEY_ID=<production-backend-S3-access-key>
R2_SECRET_ACCESS_KEY=<production-backend-S3-secret>
MEDIA_URL_SECRET=<stable-production-secret-at-least-32-random-characters>
PROJECTS_DIR=/data/projects
BRANDS_DIR=/data/brands
AUDIO_DIR=/data/audio
RENDER_OUTPUT_DIR=/data/renders
```

Keep existing working auth, database, provider and origin settings. Set `R2_MEDIA_BUCKET` explicitly: the current runtime otherwise falls back to `R2_UPLOADS_BUCKET`. `R2_ACCOUNT_ID` alone is insufficient; the code requires `R2_ENDPOINT`. Keep an existing valid `MEDIA_URL_SECRET`; use a new environment-specific secret only if absent. Changing it invalidates outstanding media links.

## Rollout and verification

1. Complete Cloudflare setup and stage Railway variables with deployment deferred until the intended release is ready. Confirm the selected release includes `media.ts`, media-token routes, their frontend consumers, and the expanded smoke test. This workspace contains other in-progress changes; choose the release through the normal reviewed staging promotion.
2. Deploy the selected release to staging and run its smoke command below. After the production deployment in step 3 succeeds, run the production command using that backend's credentials. Resolve `lively-presence` to its project ID and substitute it for `<project-id>`. Absolute container paths avoid dependence on SSH's working directory. `railway run` runs locally and cannot prove anything about the mounted production volume; use SSH.

   ```sh
   railway ssh --project <project-id> --environment staging --service backend -- node /app/backend/test/media.mjs
   railway ssh --project <project-id> --environment production --service backend -- node /app/backend/test/media.mjs
   ```

   Require the output to say **R2**, not filesystem. The test creates random project/brand/audio prefixes, writes fixtures, deletes only its temporary local cache, restores bytes from R2, verifies remote deletion and cleans up those prefixes even after an assertion failure. It never removes `/data`. Fixtures exercise storage, not image/font/audio decoding. A successful filesystem run in CI does not prove hosted credentials or recovery.
3. Deploy production with one backend replica and the volume retained. Require deployment success, `/readyz` and `/healthz`. A successful deployment alone does not test R2 access: now run the production R2 smoke command from step 2.
4. With a fresh production test project, upload a screenshot and brand/logo/font, capture a site snapshot, and generate a voice/music take if provider credentials are available. Open their previews using authenticated media links, then complete a render and play/download it. Check a second user's access is denied and forged/expired media tokens fail. Record any provider-dependent check not exercised.
5. Before removing volumes or adding replicas, prove the staging gate separately: new media readable from a different replica with an empty cache, valid tokens on both, updates visible after both replicas have cached the old file, deletions unavailable from either replica, successful preview/render with brand/audio, and recovery after restart. Use writable ephemeral cache paths for the non-root backend and retain a recovery copy of the old volume. The current stale-cache behavior needs resolution before this gate can pass.

Keep the production rollout incomplete until fresh R2 recovery and browser checks pass. No production bucket, credentials, lifecycle, variables, deployment or hosted smoke checks were changed/executed by this repo preparation.

## Optional legacy-data exception and rollback

If retained media is discovered later, stop before removing its volume and plan a migration. The existing `backend/scripts/backfill-media.ts` is the historical staging copier, **not part of this rollout**. It suppresses directory/HEAD errors and overwrites differing remote files; do not run it against retained production data without hardening it, taking a recovery copy, pausing writers and independently verifying the results. Its `--dry-run` is not proof that migration completed. No backfill hardening or migration is needed for the current fresh-start scope.

For a failed rollout, retain the bucket and volume, restore the last working deployment/configuration, and verify media access. New objects written after R2 activation may exist only in R2 after a cache loss; a rollback to volume-only code is not automatically data-complete. Do not delete either copy or broaden lifecycle expiry as a rollback step.

## Evidence to record when executed

Record the production bucket/privacy/scope/lifecycle read-back, deployed commit and Railway deployment ID, R2 smoke output, browser smoke project IDs and outcomes, and any skipped audio/provider checks. Record **backfill: intentionally skipped; no retained user media**. Keep the two-replica gate open until its own evidence exists. Never include credentials or signed media URLs in the record.
