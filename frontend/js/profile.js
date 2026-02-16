/**
 * profile.js - Emoji Avatar Module (frontend-only).
 *
 * Stores avatar in localStorage so it works in both anon + account modes
 * without any database sync.
 */
const AVATAR_KEY = "bloom_avatar";

export async function getAvatar() {
  return localStorage.getItem(AVATAR_KEY) || "🌸";
}

export async function saveAvatar(emoji) {
  localStorage.setItem(AVATAR_KEY, emoji);
  return emoji;
}
