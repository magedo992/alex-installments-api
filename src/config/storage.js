const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');

const storage = new S3Client({
  forcePathStyle: true,
  maxAttempts: 1,
  requestHandler: { requestTimeout: 5000, throwOnRequestTimeout: true },
});

async function verifyStorage() {
  if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.AWS_REGION ||
      !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return { ok: false, message: 'Neon Object Storage environment variables are missing' };
  }
  try {
    await storage.send(new HeadBucketCommand({ Bucket: 'assets' }));
    return { ok: true, message: 'Neon Object Storage assets bucket is accessible' };
  } catch {
    return { ok: false, message: 'Neon Object Storage assets bucket is unavailable' };
  }
}

module.exports = { verifyStorage };
