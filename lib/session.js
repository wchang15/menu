'use client';

const CURRENT_USER_KEY = 'CURRENT_USER_ID';

export function setCurrentUser(id) {
  if (typeof window === 'undefined') return;
  const nextId = id?.trim();
  if (nextId) {
    window.localStorage.setItem(CURRENT_USER_KEY, nextId);
  } else {
    window.localStorage.removeItem(CURRENT_USER_KEY);
  }
}

export function getCurrentUser() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(CURRENT_USER_KEY);
}

export function clearCurrentUser() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CURRENT_USER_KEY);
}