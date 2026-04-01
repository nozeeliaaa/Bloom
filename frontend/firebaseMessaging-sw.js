/**
 * firebase-messaging-sw.js
 * Service worker for background FCM push notifications.
 * Must be placed in the PUBLIC root of the project (e.g. /public/firebase-messaging-sw.js)
 * so it is served at https://yourdomain/firebase-messaging-sw.js
 */

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Must match your firebaseConfig values exactly
firebase.initializeApp({
  apiKey:            self.FIREBASE_API_KEY      || "AIzaSyCoY7010ONRgfc9ic6orCefKgSFAbAaOtg",
  authDomain:        self.FIREBASE_AUTH_DOMAIN  || "bloom-8401a.firebaseapp.com",
  projectId:         self.FIREBASE_PROJECT_ID   || "bloom-8401a",
  storageBucket:     self.FIREBASE_STORAGE      || "bloom-8401a.firebasestorage.app",
  messagingSenderId: self.FIREBASE_SENDER_ID    || "538005116995",
  appId:             self.FIREBASE_APP_ID       || "1:538005116995:web:09eb9bb0e066ddbfd91cf6",
});

const messaging = firebase.messaging();

// Handle background messages (app is closed or in background tab)
messaging.onBackgroundMessage((payload) => {
  console.log("[Bloom SW] Background message received:", payload);

  const title = payload.notification?.title || "Bloom";
  const body  = payload.notification?.body  || "";

  self.registration.showNotification(title, {
    body,
    icon: "/apple-touch-icon.png",
    badge: "/apple-touch-icon.png",
    tag: payload.data?.tag || "bloom-notification",
  });
});