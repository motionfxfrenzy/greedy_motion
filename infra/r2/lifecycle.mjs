#!/usr/bin/env node
// Expires the per-render input folders (jobs/<jobId>/project/) in an R2 uploads bucket. They are built from the
// project row and media for one render and are only read by the worker during that render; the project can always
// rebuild them, so keeping them forever only costs storage. Everything a user needs to come back and keep iterating
// lives elsewhere and is NOT touched: the project row in Postgres, media/ (screenshots, brand files, voice and music
// takes, generated visuals, Pro Editor files) and every finished MP4 in the outputs bucket.
//
//   node infra/r2/lifecycle.mjs <bucket>            dry run: prints current rules and the merged result
//   node infra/r2/lifecycle.mjs <bucket> --apply    writes them (other rules on the bucket are kept)
//
// Credentials: R2_ENDPOINT plus an admin R2 token (the app's object-level token cannot change bucket settings),
// from the environment or else the repo-root .env.credentials (R2_ADMIN_ACCESS_KEY_ID / R2_ADMIN_SECRET_ACCESS_KEY).
import { GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand, S3Client } from "@aws-sdk/client-s3";

try { process.loadEnvFile(new URL("../../.env.credentials", import.meta.url)); } catch { /* no file: use the environment */ }
process.env.R2_ACCESS_KEY_ID ??= process.env.R2_ADMIN_ACCESS_KEY_ID;
process.env.R2_SECRET_ACCESS_KEY ??= process.env.R2_ADMIN_SECRET_ACCESS_KEY;

const [bucket, flag] = process.argv.slice(2);
if (!bucket) { console.error("usage: node infra/r2/lifecycle.mjs <bucket> [--apply]"); process.exit(2); }
for (const name of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) if (!process.env[name]) { console.error(`${name} is not set.`); process.exit(2); }

const DAYS = 7; // past any retry (renders time out in minutes) with room to debug a failed job
const rule = { ID: "expire-render-inputs", Status: "Enabled", Filter: { Prefix: "jobs/" }, Expiration: { Days: DAYS }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } };

const client = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })).then((r) => r.Rules ?? [], (error) => {
  if (error.name === "NoSuchLifecycleConfiguration") return [];
  throw error;
});
// Already covered (staging was set up by hand with a 3-day "expire-job-inputs" rule): keep it, add nothing.
const existing = current.find((r) => r.ID !== rule.ID && r.Status === "Enabled" && r.Filter?.Prefix === "jobs/" && r.Expiration?.Days);
if (existing) { console.log(`bucket ${bucket}: jobs/ already expires after ${existing.Expiration.Days} days (rule "${existing.ID}"). Nothing to do.`); process.exit(0); }
// R2 replaces the whole configuration on PUT, so keep every other rule.
const rules = [...current.filter((r) => r.ID !== rule.ID), rule];
if (rules.some((r) => r.ID !== rule.ID && (r.Filter?.Prefix ?? "") === "")) console.warn("warning: an existing rule applies to the whole bucket; check it does not expire media/.");
console.log(`bucket ${bucket}\ncurrent: ${JSON.stringify(current, null, 2)}\nmerged:  ${JSON.stringify(rules, null, 2)}`);
if (flag !== "--apply") { console.log("\ndry run; add --apply to write."); process.exit(0); }
await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: { Rules: rules } }));
console.log(`\napplied: jobs/ expires after ${DAYS} days.`);
