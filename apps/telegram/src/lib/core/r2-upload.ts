import "server-only";

import {
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";

import { serverEnv } from "./config/server";
import { joinObjectPaths } from "./object-path";

export type CloudflareR2UploadClientConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint?: string;
  uploadPrefix?: string;
};

export type R2UploadImageInput = {
  key: string;
  body: NonNullable<PutObjectCommandInput["Body"]>;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
};

export type R2UploadResult = {
  key: string;
  bucket: string;
  etag?: string;
  versionId?: string;
};

export type CloudflareR2UploadClient = {
  uploadImage: (input: R2UploadImageInput) => Promise<R2UploadResult>;
};

let uploadClientFromEnv: CloudflareR2UploadClient | null = null;

function createS3Client(config: CloudflareR2UploadClientConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint:
      config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Ensures requests target the account endpoint format documented by Cloudflare.
    forcePathStyle: true,
  });
}

export function isCloudflareR2UploadConfigured(): boolean {
  return serverEnv.isCloudflareR2UploadConfigured;
}

export function getCloudflareR2UploadClientConfigFromEnv(): CloudflareR2UploadClientConfig {
  return {
    accountId: serverEnv.cloudflareR2AccountId,
    accessKeyId: serverEnv.cloudflareR2AccessKeyId,
    secretAccessKey: serverEnv.cloudflareR2SecretAccessKey,
    bucketName: serverEnv.cloudflareR2BucketName,
    endpoint: serverEnv.cloudflareR2S3Endpoint,
    uploadPrefix: serverEnv.cloudflareR2UploadPrefix,
  };
}

export function createCloudflareR2UploadClient(
  config: CloudflareR2UploadClientConfig
): CloudflareR2UploadClient {
  const s3Client = createS3Client(config);

  const uploadImage = async (
    input: R2UploadImageInput
  ): Promise<R2UploadResult> => {
    const key = joinObjectPaths(
      config.uploadPrefix,
      input.key,
      "R2 object key"
    );

    const response = await s3Client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl:
          input.cacheControl ?? "public, max-age=31536000, immutable",
        Metadata: input.metadata,
      })
    );

    return {
      key,
      bucket: config.bucketName,
      etag: response.ETag,
      versionId: response.VersionId,
    };
  };

  return { uploadImage };
}

export function getCloudflareR2UploadClientFromEnv(): CloudflareR2UploadClient {
  if (uploadClientFromEnv) {
    return uploadClientFromEnv;
  }

  uploadClientFromEnv = createCloudflareR2UploadClient(
    getCloudflareR2UploadClientConfigFromEnv()
  );

  return uploadClientFromEnv;
}
