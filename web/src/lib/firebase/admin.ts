import "server-only";

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Application Default Credentials:
// - dev: GOOGLE_APPLICATION_CREDENTIALS points to a service-account JSON kept
//   OUTSIDE the repo.
// - Cloud Run: the service's attached service account; no key file at all.
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID is not set");
}

const app =
  getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });

export const adminAuth = getAuth(app);
