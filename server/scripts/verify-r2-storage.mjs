#!/usr/bin/env node
/**
 * Non-destructive R2/S3 smoke test for Plethora production storage.
 * Requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 *
 * Usage: cd server && npm run verify:r2
 */
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const region = process.env.S3_REGION || 'auto';

const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
  (k) => !process.env[k],
);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new S3Client({
  region,
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

const testKey = `__plethora_smoke__/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`;
const payload = Buffer.from(`plethora-r2-smoke-${Date.now()}`);
const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');

function redactEndpoint(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return '(invalid endpoint)';
  }
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

try {
  console.log('endpoint:', redactEndpoint(endpoint));
  console.log('bucket:', bucket);
  console.log('region:', region);
  console.log('test_key:', testKey);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: payload,
      ContentType: 'text/plain',
    }),
  );
  console.log('put: ok');

  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: testKey }));
  const body = await streamToBuffer(got.Body);
  const gotHash = crypto.createHash('sha256').update(body).digest('hex');
  if (gotHash !== payloadHash) throw new Error('hash mismatch after read');
  console.log('get: ok (hash verified)');

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
  console.log('delete: ok');

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: testKey }));
    throw new Error('object still exists after delete');
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      console.log('head_after_delete: not found (expected)');
    } else {
      throw err;
    }
  }

  console.log('R2 smoke test: PASS');
} catch (err) {
  console.error('R2 smoke test: FAIL');
  console.error(err?.message || err);
  process.exit(1);
}
