"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";

// These values are public identifiers, not secrets: Firebase protects the
// project with "Authorized domains" and API key restrictions instead.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let auth: Auth | undefined;

export function getClientApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

// In-memory persistence: the Firebase SDK keeps nothing in localStorage or
// IndexedDB. The browser only ever holds our httpOnly session cookie.
export function getClientAuth(): Auth {
  if (!auth) {
    auth = initializeAuth(getClientApp(), {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  }
  return auth;
}
