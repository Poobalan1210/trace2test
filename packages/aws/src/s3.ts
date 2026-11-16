import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from './stores.js';

export function s3ObjectStore(bucket: string, s3 = new S3Client({})): ObjectStore {
  return {
    async getText(key) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await out.Body!.transformToString('utf8');
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return undefined;
        throw err;
      }
    },
    async putText(key, text, contentType = 'application/json') {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: text, ContentType: contentType }));
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
