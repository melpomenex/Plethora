import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand as PutCmd } from '@aws-sdk/client-s3';
import type { StorageBackend } from './types.js';
import type { AppConfig } from '../config/env.js';

export function createS3Storage(config: NonNullable<AppConfig['s3']>): StorageBackend {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  const bucket = config.bucket;

  return {
    async putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
    },

    async getObject(key: string): Promise<Buffer> {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const stream = res.Body;
      if (!stream) throw new Error(`Object not found: ${key}`);
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async getSignedDownloadUrl(key: string, expiresSec = 3600): Promise<string> {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: expiresSec });
    },

    async getSignedUploadUrl(
      key: string,
      contentType: string,
      expiresSec = 3600,
      sizeBytes?: number
    ): Promise<string> {
      const command = new PutCmd({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ...(sizeBytes !== undefined ? { ContentLength: sizeBytes } : {}),
      });
      return getSignedUrl(client, command, { expiresIn: expiresSec });
    },

    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
