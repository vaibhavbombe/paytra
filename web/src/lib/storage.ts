import "server-only";

import { Storage } from "@google-cloud/storage";

// Private bucket for uploaded statements. Credentials come from Application
// Default Credentials: on Cloud Run there's no key file, so signing goes
// through the IAM signBlob API as the paytra-web service account.
const bucketName = process.env.STATEMENTS_BUCKET;

let storage: Storage | undefined;

const UPLOAD_URL_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * A V4 signed URL that allows exactly one thing: PUT of one object, with this
 * content type, up to maxBytes, within 10 minutes. The browser uploads
 * straight to Cloud Storage; the file never passes through our server.
 */
export async function signedUploadUrl(objectPath: string, contentType: string, maxBytes: number) {
  if (!bucketName) throw new Error("STATEMENTS_BUCKET is not set");
  storage ??= new Storage();
  const lengthRange = `0,${maxBytes}`;
  const [url] = await storage
    .bucket(bucketName)
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + UPLOAD_URL_TTL_MS,
      contentType,
      // Cloud Storage rejects the upload if the body is outside this range.
      extensionHeaders: { "x-goog-content-length-range": lengthRange },
    });
  return { url, headers: { "Content-Type": contentType, "x-goog-content-length-range": lengthRange } };
}
