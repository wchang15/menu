
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  KEYS,
  loadLocalBlob,
  loadLocalJson,
  saveBlob,
  saveJson,
  syncBlobFromCloud,
  syncJsonFromCloud,
  removeKey,
} from '@/lib/storage';
import { clearCurrentUser, getCurrentUser, setCurrentUser } from '@/lib/session';
import { supabase } from '@/lib/supabaseClient';
import { getSignedAssetUrl } from '@/lib/cloudAssets';
import * as layoutMedia from '@/lib/layoutMedia';
import {
  menuReadyBundleIdentity,
  readMenuReadyBundle,
  readMenuReadyBundleAsync,
  writeMenuReadyBundleAsync,
} from '@/lib/menuReadyBundle';
import CustomCanvas from './CustomCanvas';
import TemplateCanvas from './TemplateCanvas';

const DEFAULT_LAYOUT = { mode: null, templateId: null, items: [], templateData: null, pageCount: 1 };
const menuLayoutKey = (language) => `${KEYS.MENU_LAYOUT}_${language || 'en'}`;
const PREMIUM_TEMPLATE_IDS = new Set(['T1A', 'T2A', 'T3A']);
const isPremiumTemplateId = (templateId) => PREMIUM_TEMPLATE_IDS.has(String(templateId || ''));
const PAIRED_TEMPLATE_SYNC_KEY = 'MENU_PAIRED_TEMPLATE_SYNC_V1';

// ✅ 옵션들
const SECRET_TAPS = 5;
const TAP_WINDOW_MS = 2500;
const AUTO_HIDE_MS = 5000;
const LONG_PRESS_MS = 3000;

// ✅ 비밀번호(핀) 설정
const PIN_KEY = 'MENU_EDITOR_PIN_V1';
const DEFAULT_PIN = '0000';

// ✅ Blob/File 체크 (createObjectURL 안전)
const isBlobLike = (v) =>
  v && (typeof Blob !== 'undefined') && (v instanceof Blob || v instanceof File);

const blobObjectUrlCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function getReusableBlobObjectUrl(blob) {
  if (!isBlobLike(blob) || typeof URL === 'undefined') return null;
  if (!blobObjectUrlCache) return URL.createObjectURL(blob);
  const cached = blobObjectUrlCache.get(blob);
  if (cached) return cached;
  const nextUrl = URL.createObjectURL(blob);
  blobObjectUrlCache.set(blob, nextUrl);
  return nextUrl;
}

function getPreparedBackgroundUrl(source) {
  return source?.bgObjectUrl ||
    getReusableBlobObjectUrl(source?.bgBlob) ||
    source?.bgSignedUrl ||
    null;
}

function getPreparedBackgroundOverrideUrls(source) {
  const urls = {
    ...(source?.bgOverrideSignedUrls || {}),
    ...(source?.bgOverrideObjectUrls || {}),
  };

  for (const [page, blob] of Object.entries(source?.bgOverrides || {})) {
    const objectUrl = getReusableBlobObjectUrl(blob);
    if (objectUrl) urls[page] = objectUrl;
  }

  return urls;
}


// ✅ 언어
const LANG_KEY = 'APP_LANG_V1';

// ✅ “페이지” 단위(편집용)
const PAGE_HEIGHT = 2200;
const PAGE_GAP = 40;
const MIN_CONTENT_HEIGHT = PAGE_HEIGHT;

// ✅ TemplateCanvas와 페이지 계산 "완전 동일"하게 만들기 위한 상수
const DEFAULT_ROW_H = 92;
const DEFAULT_HEADER_H = 210;
const DEFAULT_PAGE_PADDING_TOP = 70;
const DEFAULT_FOOTER_SPACE = 176;
const FEATURE_RIBBON_H = 168;
const FEATURE_RIBBON_GAP = 18;
const PAGE_WIDTH = 1080;

// ✅ T2 사진 슬롯과 동일
const MAX_PHOTOS = 8;

const hydrateLayoutMediaSafe = async (layout) => {
  const fn = layoutMedia?.hydrateLayoutMedia;
  return typeof fn === 'function' ? fn(layout) : layout;
};

const hydrateLayoutMediaForPagesSafe = async (layout, pages) => {
  const fn = layoutMedia?.hydrateLayoutMediaForPages;
  return typeof fn === 'function'
    ? fn(layout, pages, { pageHeight: PAGE_HEIGHT, pageGap: PAGE_GAP })
    : hydrateLayoutMediaSafe(layout);
};

const migrateLegacyInlineMediaSafe = async (layout) => {
  const fn = layoutMedia?.migrateLegacyInlineMedia;
  return typeof fn === 'function' ? fn(layout) : { layout, changed: false };
};

const sanitizeLayoutMediaSafe = (layout) => {
  const fn = layoutMedia?.sanitizeLayoutMedia;
  return typeof fn === 'function' ? fn(layout) : layout;
};

function isUsableMenuLayout(value) {
  return value?.mode === 'custom' || value?.mode === 'template';
}

function layoutConflictsWithSyncedTemplate(value, syncedTemplateId) {
  if (!syncedTemplateId || !isPremiumTemplateId(syncedTemplateId)) return false;
  if (!isUsableMenuLayout(value)) return false;
  if (value?.mode === 'custom') return true;
  if (value?.mode === 'template') {
    return getCanonicalTemplateId(value) !== syncedTemplateId;
  }
  return false;
}

function normalizeLanguageProbeText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\$?\s*\d+(?:[.,]\d+)?\s*$/.test(text)) return '';
  if (/^(음식\s*이름|음식명|가격|item\s*name|price)$/i.test(text)) return '';
  return text;
}

function getLayoutLanguageProfile(value) {
  const templateData = value?.templateData && typeof value.templateData === 'object'
    ? value.templateData
    : {};
  const templateRows = [
    ...(Array.isArray(templateData.rows) ? templateData.rows : []),
    ...(Array.isArray(templateData.cells) ? templateData.cells : []),
  ];
  const templateTexts = [
    templateData.restaurantName,
    templateData.title,
    templateData.tagline,
    templateData.footerText,
    ...templateRows.flatMap((row) => [row?.section, row?.name]),
  ];

  const texts = [
    ...(Array.isArray(value?.items) ? value.items : [])
      .filter((item) => item?.type === 'text')
      .map((item) => item.text),
    ...templateTexts,
  ]
    .map((text) => normalizeLanguageProbeText(text))
    .filter(Boolean);

  return texts.reduce((profile, text) => {
    const hangulChars = text.match(/[가-힣]/g)?.length || 0;
    const latinChars = text.match(/[A-Za-z]/g)?.length || 0;
    if (hangulChars > 0) {
      profile.koItems += 1;
      profile.koChars += hangulChars;
    }
    if (latinChars > 0) {
      profile.enItems += 1;
      profile.enChars += latinChars;
    }
    return profile;
  }, { koItems: 0, enItems: 0, koChars: 0, enChars: 0 });
}

function inferLayoutLanguage(value) {
  const profile = getLayoutLanguageProfile(value);
  const { koItems, enItems, koChars, enChars } = profile;

  if (!koItems && !enItems) return null;
  if (koItems >= 3 && koItems >= enItems * 1.35) return 'ko';
  if (enItems >= 3 && enItems >= koItems * 1.35) return 'en';
  if (koChars >= 12 && koChars >= enChars * 0.7) return 'ko';
  if (enChars >= 12 && enChars >= koChars * 1.15) return 'en';
  if (koItems > enItems) return 'ko';
  if (enItems > koItems) return 'en';
  return null;
}

function normalizeLayoutTextForLanguage(value, language) {
  if (!value || typeof value !== 'object') return value;
  const safeLang = language === 'ko' ? 'ko' : 'en';
  const inferredTemplateLang = value?.mode === 'template' && isPremiumTemplateId(value.templateId)
    ? inferLayoutLanguage(value)
    : null;
  const canonicalTemplateId = value?.mode === 'template' ? getCanonicalTemplateId(value) : null;
  const needsTemplateIdentityFix =
    value?.mode === 'template' &&
    isPremiumTemplateId(canonicalTemplateId) &&
    (value.templateId !== canonicalTemplateId || value.templateData?.style?.templateKey !== canonicalTemplateId);
  const baseValue = (inferredTemplateLang && inferredTemplateLang !== safeLang) || needsTemplateIdentityFix
    ? normalizePremiumTemplateLayoutForLanguage(value, safeLang)
    : value;
  const placeholderMap = safeLang === 'ko'
    ? { 'Item Name': '음식 이름', Price: '가격' }
    : { '음식 이름': 'Item Name', 음식명: 'Item Name', 가격: 'Price' };

  const items = Array.isArray(baseValue.items) ? baseValue.items : [];
  let changed = false;
  const nextItems = items.map((item) => {
    if (item?.type !== 'text') return item;
    const rawText = String(item.text || '');
    const trimmed = rawText.trim();
    const replacement = placeholderMap[trimmed];
    if (!replacement) return item;
    changed = true;
    const leading = rawText.match(/^\s*/)?.[0] || '';
    const trailing = rawText.match(/\s*$/)?.[0] || '';
    return { ...item, text: `${leading}${replacement}${trailing}` };
  });

  return changed ? { ...baseValue, items: nextItems } : baseValue;
}

function layoutMatchesLanguage(value, language) {
  if (!isUsableMenuLayout(value)) return false;
  const inferred = inferLayoutLanguage(value);
  return !inferred || inferred === (language === 'ko' ? 'ko' : 'en');
}

const WINDOW_READY_VIEW_STORE = '__MENU_READY_VIEW_STORE_V1__';

function readyViewKey(language, userId) {
  return `${userId || 'user'}:${language === 'ko' ? 'ko' : 'en'}`;
}

function getWindowReadyViewStore() {
  if (typeof window === 'undefined') return null;
  try {
    if (!window[WINDOW_READY_VIEW_STORE]) {
      window[WINDOW_READY_VIEW_STORE] = new Map();
    }
    return window[WINDOW_READY_VIEW_STORE];
  } catch {
    return null;
  }
}

function readWindowReadyView(language, userId) {
  const store = getWindowReadyViewStore();
  if (!store) return null;
  const key = readyViewKey(language, userId);
  const exact = store.get?.(key);
  if (exact?.userId && exact.userId !== userId) return null;
  if (layoutMatchesLanguage(exact?.layout, language) && !layoutNeedsMediaHydration(exact?.layout)) return exact;
  try {
    store.delete?.(key);
  } catch {}
  return null;
}

function windowReadyViewHasBackground(view) {
  return !!view?.bgBlob ||
    !!view?.bgObjectUrl ||
    !!view?.bgSignedUrl ||
    Object.keys(view?.bgOverrides || {}).length > 0 ||
    Object.keys(view?.bgOverrideObjectUrls || {}).length > 0 ||
    Object.keys(view?.bgOverrideSignedUrls || {}).length > 0;
}

function getInitialMenuLanguage() {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    return saved === 'ko' || saved === 'en' ? saved : 'en';
  } catch {
    return 'en';
  }
}

function getInitialReadyViewSnapshot() {
  const language = getInitialMenuLanguage();
  const userId = getCurrentUser();
  const view = readWindowReadyView(language, userId);
  return { language, userId, view };
}

function writeWindowReadyView({
  language,
  userId,
  layout,
  bgBlob = null,
  bgOverrides = {},
  bgObjectUrl = null,
  bgOverrideObjectUrls = {},
  bgSignedUrl = null,
  bgOverrideSignedUrls = {},
}) {
  if (!layoutMatchesLanguage(layout, language)) return;
  if (layoutNeedsMediaHydration(layout)) return;
  const store = getWindowReadyViewStore();
  if (!store) return;
  const safeLang = language === 'ko' ? 'ko' : 'en';
  const preparedBgObjectUrl = bgObjectUrl || getReusableBlobObjectUrl(bgBlob);
  const preparedBgOverrideObjectUrls = {
    ...(bgOverrideObjectUrls || {}),
    ...getPreparedBackgroundOverrideUrls({ bgOverrides }),
  };
  const view = {
    language: safeLang,
    userId: userId || null,
    layout,
    bgBlob: bgBlob || null,
    bgOverrides: bgOverrides || {},
    bgObjectUrl: preparedBgObjectUrl || null,
    bgOverrideObjectUrls: preparedBgOverrideObjectUrls || {},
    bgSignedUrl: bgSignedUrl || null,
    bgOverrideSignedUrls: bgOverrideSignedUrls || {},
    ts: Date.now(),
  };
  store.set?.(readyViewKey(safeLang, userId), view);
}

function isBlobUrlSrc(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function isMediaItem(item) {
  return item && (item.type === 'image' || item.type === 'video');
}

function mediaItemNeedsRepair(item) {
  if (!isMediaItem(item)) return false;
  return !item.src;
}

function repairMissingMediaItemsFromFallback(targetLayout, fallbackLayout) {
  const targetItems = Array.isArray(targetLayout?.items) ? targetLayout.items : [];
  const fallbackMediaItems = (Array.isArray(fallbackLayout?.items) ? fallbackLayout.items : [])
    .filter((item) => isMediaItem(item) && (item.assetPath || (item.src && !isBlobUrlSrc(item.src))));

  if (!targetItems.length || !fallbackMediaItems.length) {
    return { layout: targetLayout, changed: false };
  }

  let mediaIndex = 0;
  let changed = false;

  const repairedItems = targetItems.map((item) => {
    if (!isMediaItem(item)) return item;

    const fallbackItem = fallbackMediaItems[mediaIndex];
    mediaIndex += 1;

    if (!mediaItemNeedsRepair(item) || !fallbackItem) return item;

    const fallbackSrc = fallbackItem.src && !isBlobUrlSrc(fallbackItem.src) ? fallbackItem.src : null;
    const nextAssetPath = item.assetPath || fallbackItem.assetPath || null;
    const nextSrc = fallbackSrc || (item.src && !isBlobUrlSrc(item.src) ? item.src : null);

    if (!nextAssetPath && !nextSrc) return item;

    changed = true;
    return {
      ...item,
      ...(nextAssetPath ? { assetPath: nextAssetPath } : {}),
      src: nextSrc,
    };
  });

  return {
    layout: { ...targetLayout, items: repairedItems },
    changed,
  };
}

function layoutNeedsMediaHydration(targetLayout) {
  const items = Array.isArray(targetLayout?.items) ? targetLayout.items : [];
  return items.some((item) => {
    if (!item || item.type !== 'image') return false;
    const src = typeof item.src === 'string' ? item.src : '';
    return (item.assetPath && (!src || isBlobUrlSrc(src))) || (!item.assetPath && isBlobUrlSrc(src));
  });
}

// ✅✅ 페이지별 배경 오버라이드 저장 키 (언어별로 분리)
const LEGACY_BG_OVERRIDES_KEY = 'MENU_BG_OVERRIDES_V1';
const bgOverridesKey = (language) => `MENU_BG_OVERRIDES_V1_${language || 'en'}`;

// ✅ 기본 배경 키도 언어별로 분리
const menuBgKey = (language) => `${KEYS.MENU_BG}_${language || 'en'}`;

// 각 페이지 blob 키: `${menuBgKey(lang)}__P${page}`
const bgPageKey = (page, language) => `${menuBgKey(language)}__P${page}`;
const legacyBgPageKey = (page) => `${KEYS.MENU_BG}__P${page}`;
const fallbackLanguageFor = (language) => (language === 'ko' ? 'en' : 'ko');

function normalizePageList(pages) {
  if (!Array.isArray(pages)) return null;
  const out = pages
    .map((page) => Number(page))
    .filter((page) => Number.isFinite(page) && page >= 1)
    .map((page) => Math.floor(page));
  return out.length ? Array.from(new Set(out)) : null;
}

function getItemPageNumber(item) {
  const y = Number(item?.y || 0);
  const h = Number(item?.h || 0);
  const centerY = Math.max(0, y + h / 2);
  return Math.floor(centerY / (PAGE_HEIGHT + PAGE_GAP)) + 1;
}

function getLayoutImageUrlsForPage(targetLayout, page = 1) {
  const items = Array.isArray(targetLayout?.items) ? targetLayout.items : [];
  return items
    .filter((item) => item?.type === 'image' && item?.src && getItemPageNumber(item) === page)
    .map((item) => item.src)
    .filter(Boolean)
    .slice(0, 24);
}

function getAllLayoutImageUrls(targetLayout) {
  const items = Array.isArray(targetLayout?.items) ? targetLayout.items : [];
  const templateData = targetLayout?.templateData && typeof targetLayout.templateData === 'object'
    ? targetLayout.templateData
    : {};
  const templateUrls = [
    templateData.logoSrc,
    templateData.qrSrc,
    templateData.photoSrc,
    ...(Array.isArray(templateData.photos) ? templateData.photos : []),
  ];

  return Array.from(new Set([
    ...items
      .filter((item) => item?.type === 'image' && item?.src)
      .map((item) => item.src),
    ...templateUrls,
  ].filter(Boolean)));
}

function imagePreloadStatsComplete(targetLayout, stats) {
  const imageCount = getAllLayoutImageUrls(targetLayout).length;
  if (!imageCount) return true;

  const total = Number(stats?.total || 0);
  const loaded = Number(stats?.loaded || 0);
  const failed = Number(stats?.failed || 0);
  return total >= imageCount && loaded >= total && failed === 0;
}

function readyBundleImagesComplete(bundle) {
  return !!bundle?.layout && imagePreloadStatsComplete(bundle.layout, bundle.imagePreloadStats);
}

function preloadImageUrl(url, timeoutMs = 1600) {
  if (!url || typeof Image === 'undefined') return Promise.resolve({ url, loaded: false });

  return new Promise((resolve) => {
    let done = false;
    const finish = (loaded) => {
      if (done) return;
      done = true;
      resolve({ url, loaded: !!loaded });
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    const img = new Image();
    img.onload = () => {
      window.clearTimeout(timer);
      finish(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };
    img.src = url;
  });
}

async function preloadImageUrls(urls, timeoutMs = 1800) {
  const uniqueUrls = Array.from(new Set((urls || []).filter(Boolean)));
  if (!uniqueUrls.length || typeof window === 'undefined') {
    return { total: 0, loaded: 0, failed: 0, failedUrls: [] };
  }

  const results = [];
  let nextIndex = 0;
  const workerCount = Math.min(MENU_IMAGE_PRELOAD_CONCURRENCY, uniqueUrls.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < uniqueUrls.length) {
      const url = uniqueUrls[nextIndex];
      nextIndex += 1;
      results.push(await preloadImageUrl(url, timeoutMs));
    }
  }));

  const failedUrls = results.filter((result) => !result.loaded).map((result) => result.url).filter(Boolean);
  return {
    total: uniqueUrls.length,
    loaded: results.filter((result) => result.loaded).length,
    failed: failedUrls.length,
    failedUrls,
  };
}

async function preloadImageUrlsUntilReady(urls, timeoutMs = 7000, attempts = 3) {
  let remaining = Array.from(new Set((urls || []).filter(Boolean)));
  const total = remaining.length;
  let loaded = 0;

  for (let attempt = 0; attempt < attempts && remaining.length; attempt += 1) {
    const stats = await preloadImageUrls(remaining, timeoutMs);
    loaded += Number(stats?.loaded || 0);
    remaining = stats?.failedUrls || [];
  }

  return { total, loaded, failed: remaining.length, failedUrls: remaining };
}

function withTimeout(promise, timeoutMs, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

// ✅ 보기모드 페이지 전환 튜닝
const VIEW_GUTTER_X = 0;
const VIEW_GUTTER_Y = 0;
const TEMPLATE_VIEW_GUTTER_Y = 0;
const EDIT_ACTION_BAR_SPACE = 0;
const MIN_VIEW_SCALE = 0.22;
const VIEW_PAGE_RENDER_RADIUS = 1;
const LIVE_MENU_REFRESH_ENABLED = false;
const MENU_IMAGE_PRELOAD_CONCURRENCY = 16;

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function estimateRowH(style) {
  const ls = clampNum(style?.lineSpacing ?? 1.12, 0.9, 1.6);
  return Math.round(DEFAULT_ROW_H * (0.9 + (ls - 0.9) * 0.8));
}
function estimateHeaderH(style) {
  const ls = clampNum(style?.lineSpacing ?? 1.12, 0.9, 1.6);
  return Math.round(DEFAULT_HEADER_H * (0.95 + (ls - 0.9) * 0.35));
}

function normalizeTemplateDataForMeasure(templateId, data, lang) {
  if (!data) return { style: {}, rows: [], cells: [], columns: 2 };

  const baseStyle = {
    lineSpacing: 1.12,
    rowGap: 14,
    minPages: 3,
  };
  const style = { ...baseStyle, ...(data.style || {}) };

  const group = (templateId || '').slice(0, 2);

  if (group === 'T1') {
    return { style, rows: Array.isArray(data.rows) ? data.rows : [] };
  }
  if (group === 'T2') {
    let photos = Array.isArray(data.photos)
      ? [...data.photos]
      : data.photoSrc
      ? [data.photoSrc]
      : [];
    while (photos.length < MAX_PHOTOS) photos.push(null);
    photos = photos.slice(0, MAX_PHOTOS);

    return { style, rows: Array.isArray(data.rows) ? data.rows : [], photos };
  }

  return {
    style,
    columns: clampNum(data.columns ?? 2, 2, 3),
    cells: Array.isArray(data.cells) ? data.cells : [],
  };
}

/**
 * ✅ template 페이지수 계산을 TemplateCanvas와 동일하게 맞춤.
 */
function computeTemplatePages(templateId, templateData, lang) {
  const id = templateId || '';
  const group = id.slice(0, 2); // T1/T2/T3
  const variant = id.slice(2, 3) || 'A';
  if (['T1A', 'T2A', 'T3A'].includes(id)) return 3;

  const td = normalizeTemplateDataForMeasure(id, templateData, lang);
  const style = td?.style || {};
  const headerH = estimateHeaderH(style);

  if (group === 'T1') {
    const rows = Array.isArray(td.rows) ? td.rows : [];
    const rowH = estimateRowH(style);

    const paddingTop = DEFAULT_PAGE_PADDING_TOP;
    const usableH = PAGE_HEIGHT - paddingTop - DEFAULT_FOOTER_SPACE;

    const perPage = Math.max(
      1,
      Math.floor((usableH - headerH - FEATURE_RIBBON_H - FEATURE_RIBBON_GAP) / (rowH + (style.rowGap || 14)))
    );
    return Math.max(getMinTemplatePages(style), Math.ceil((rows.length || 0) / perPage) || 1);
  }

  if (group === 'T2') {
    const rows = Array.isArray(td.rows) ? td.rows : [];

    const paddingTop = 70;
    const usableH = PAGE_HEIGHT - paddingTop - DEFAULT_FOOTER_SPACE;

    const ITEMS_PER_BLOCK = variant === 'B' ? 3 : 4;

    const targetBlocksPerPage = 3.5; // 3~4
    const available = Math.max(400, usableH - headerH - 24);
    const blockGap = variant === 'A' ? 18 : variant === 'B' ? 16 : 20;

    const blockH = Math.floor(
      (available - FEATURE_RIBBON_H - FEATURE_RIBBON_GAP - blockGap * (Math.ceil(targetBlocksPerPage) - 1)) / targetBlocksPerPage
    );
    const blocksPerPage = clampNum(
      Math.floor((available + blockGap) / (blockH + blockGap)),
      3,
      4
    );

    const blocks = Math.max(1, Math.ceil((rows.length || 0) / ITEMS_PER_BLOCK));
    return Math.max(getMinTemplatePages(style), Math.ceil(blocks / blocksPerPage));
  }

  // T3
  const cells = Array.isArray(td.cells) ? td.cells : [];
  const col = Math.max(2, Math.min(3, Number(td.columns) || 2));

  const paddingTop = 70;
  const usableH = PAGE_HEIGHT - paddingTop - DEFAULT_FOOTER_SPACE;

  const cardH = variant === 'A' ? 172 : variant === 'B' ? 160 : 188;
  const gap = variant === 'A' ? 18 : variant === 'B' ? 14 : 22;

  const rowsPerPage = Math.max(1, Math.floor((usableH - headerH - FEATURE_RIBBON_H - FEATURE_RIBBON_GAP) / (cardH + gap)));
  const perPage = rowsPerPage * col;

  return Math.max(getMinTemplatePages(style), Math.ceil((cells.length || 0) / perPage) || 1);
}

function getMinTemplatePages(style) {
  return clampNum(style?.minPages ?? 1, 1, 12);
}

function cloneLayoutForCancel(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(sanitizeLayoutMediaSafe(value)));
  } catch {
    return null;
  }
}

function hasUsableTemplateMedia(value) {
  if (!value) return false;
  if (typeof value !== 'string') return true;
  return value.trim().length > 0;
}

function getTemplateDataKey(templateData) {
  const key = String(templateData?.style?.templateKey || '').slice(0, 3);
  return isPremiumTemplateId(key) ? key : null;
}

function getCanonicalTemplateId(layoutLike) {
  const styleKey = getTemplateDataKey(layoutLike?.templateData);
  return styleKey || layoutLike?.templateId || null;
}

function mergeSharedTemplateData(baseData, sourceData) {
  const base = baseData && typeof baseData === 'object' ? baseData : {};
  const source = sourceData && typeof sourceData === 'object' ? sourceData : {};
  const next = { ...base };

  ['logoSrc', 'qrSrc', 'orderUrl', 'phone', 'website', 'currency'].forEach((key) => {
    if (hasUsableTemplateMedia(source[key])) next[key] = source[key];
  });

  if (source.style && typeof source.style === 'object') {
    const baseTemplateKey = base?.style?.templateKey;
    const sourceTemplateKey = source?.style?.templateKey;
    const canCarryStyle = !baseTemplateKey || !sourceTemplateKey || baseTemplateKey === sourceTemplateKey;
    next.style = {
      ...(base.style || {}),
      ...(canCarryStyle ? source.style : {}),
      templateKey: base?.style?.templateKey || source.style.templateKey || next?.style?.templateKey,
    };
  }

  if (Array.isArray(source.photos) && source.photos.some(Boolean)) {
    next.photos = [...source.photos];
    next.photoSrc = source.photoSrc || source.photos.find(Boolean) || null;
  } else if (source.photoSrc) {
    next.photoSrc = source.photoSrc;
    next.photos = Array.isArray(base.photos) && base.photos.length ? [...base.photos] : [source.photoSrc];
    if (!next.photos[0]) next.photos[0] = source.photoSrc;
  }

  return next;
}

function forceTemplateDataIdentity(templateId, templateData) {
  const safeTemplateId = String(templateId || '');
  if (!safeTemplateId || !templateData || typeof templateData !== 'object') return templateData;
  const variant = safeTemplateId.slice(2, 3) || templateData?.style?.variant || 'A';
  return {
    ...templateData,
    style: {
      ...(templateData.style || {}),
      templateKey: safeTemplateId,
      variant,
      minPages: isPremiumTemplateId(safeTemplateId) ? 3 : templateData.style?.minPages,
    },
  };
}

function makeTemplateLayout(templateId, templateData, overrides = {}) {
  return {
    mode: 'template',
    templateId,
    templateData: forceTemplateDataIdentity(templateId, templateData),
    items: [],
    pageCount: isPremiumTemplateId(templateId) ? 3 : 1,
    ...overrides,
  };
}

function makeTemplateLayoutForLanguage(templateId, language, sharedSource = null) {
  const safeLang = language === 'ko' ? 'ko' : 'en';
  const baseData = makeInitialTemplateData(templateId, safeLang);
  return makeTemplateLayout(templateId, mergeSharedTemplateData(baseData, sharedSource));
}

function mergePairedTemplateItems(targetItems, sourceItems) {
  const target = Array.isArray(targetItems) ? targetItems : [];
  const source = Array.isArray(sourceItems) ? sourceItems : [];

  return source.map((sourceItem, index) => {
    const targetItem = target[index] && typeof target[index] === 'object' ? target[index] : {};
    return {
      ...targetItem,
      section: targetItem.section || sourceItem?.section || '',
      name: targetItem.name || sourceItem?.name || '',
      price: sourceItem?.price ?? targetItem.price ?? '',
    };
  });
}

function mergePairedTemplateEditData(targetData, sourceData) {
  const target = targetData && typeof targetData === 'object' ? targetData : {};
  const source = sourceData && typeof sourceData === 'object' ? sourceData : {};
  const next = mergeSharedTemplateData(target, source);

  if (Array.isArray(source.rows)) {
    next.rows = mergePairedTemplateItems(target.rows, source.rows);
  }
  if (Array.isArray(source.cells)) {
    next.cells = mergePairedTemplateItems(target.cells, source.cells);
  }
  if (Number.isFinite(Number(source.columns))) {
    next.columns = source.columns;
  }

  return next;
}

function normalizePremiumTemplateLayoutForLanguage(value, language) {
  if (!value || typeof value !== 'object') return value;
  const canonicalTemplateId = getCanonicalTemplateId(value);
  if (value.mode !== 'template' || !isPremiumTemplateId(canonicalTemplateId)) return value;

  const safeLang = language === 'ko' ? 'ko' : 'en';
  const languageBaseData = makeInitialTemplateData(canonicalTemplateId, safeLang);

  return {
    ...value,
    mode: 'template',
    templateId: canonicalTemplateId,
    items: [],
    pageCount: 3,
    templateData: forceTemplateDataIdentity(
      canonicalTemplateId,
      mergePairedTemplateEditData(languageBaseData, value.templateData)
    ),
  };
}

function cacheOptionsForLayout(targetLayout) {
  const hydrated = !layoutNeedsMediaHydration(targetLayout);
  return {
    layout: targetLayout,
    hasLayoutCache: true,
    hasFullMediaCache: hydrated,
  };
}

function makePremiumTemplateRows(templateKey, lang) {
  const ko = lang === 'ko';
  const sets = {
    T1A: [
      ['APPETIZERS', ko ? '버라타 토마토' : 'Burrata & Tomato', '14.00'],
      ['APPETIZERS', ko ? '크리스피 칼라마리' : 'Crispy Calamari', '15.00'],
      ['APPETIZERS', ko ? '와규 미트볼' : 'Wagyu Meatballs', '16.00'],
      ['APPETIZERS', ko ? '하우스 시저' : 'House Caesar', '11.00'],
      ['STEAK', ko ? '프라임 립아이 12oz' : 'Prime Ribeye 12oz', '36.00'],
      ['STEAK', ko ? '뉴욕 스트립' : 'New York Strip', '34.00'],
      ['STEAK', ko ? '필레 미뇽' : 'Filet Mignon', '39.00'],
      ['STEAK', ko ? '본인 립아이' : 'Bone-In Ribeye', '49.00'],
      ['STEAK', ko ? '브레이즈드 쇼트립' : 'Braised Short Rib', '32.00'],
      ['SEAFOOD', ko ? '갈릭 버터 살몬' : 'Garlic Butter Salmon', '28.00'],
      ['SEAFOOD', ko ? '랍스터 링귀니' : 'Lobster Linguine', '35.00'],
      ['SEAFOOD', ko ? '스캘럽 리조또' : 'Scallop Risotto', '29.00'],
      ['PASTA', ko ? '머쉬룸 리조또' : 'Wild Mushroom Risotto', '22.00'],
      ['PASTA', ko ? '트러플 파스타' : 'Truffle Pasta', '24.00'],
      ['SIDES', ko ? '트러플 맥앤치즈' : 'Truffle Mac & Cheese', '12.00'],
      ['SIDES', ko ? '크림드 스피니치' : 'Creamed Spinach', '9.00'],
      ['SIDES', ko ? '유콘 매쉬' : 'Yukon Mash', '8.00'],
      ['SIDES', ko ? '그릴드 아스파라거스' : 'Grilled Asparagus', '10.00'],
      ['SOUP & SALAD', ko ? '프렌치 어니언 수프' : 'French Onion Soup', '9.00'],
      ['SOUP & SALAD', ko ? '비트 고트치즈 샐러드' : 'Beet & Goat Cheese', '11.00'],
      ['DESSERT', ko ? '초콜릿 라바 케이크' : 'Chocolate Lava Cake', '11.00'],
      ['DESSERT', ko ? '티라미수' : 'Tiramisu', '10.00'],
      ['DESSERT', ko ? '크렘 브륄레' : 'Creme Brulee', '10.00'],
      ['WINE', ko ? '레드 와인 플라이트' : 'Red Wine Flight', '16.00'],
      ['WINE', ko ? '카베르네 글라스' : 'Cabernet Glass', '15.00'],
      ['WINE', ko ? '에스프레소 마티니' : 'Espresso Martini', '14.00'],
      ['BEVERAGE', ko ? '스파클링 워터' : 'Sparkling Water', '4.00'],
      ['BEVERAGE', ko ? '콜드 브루' : 'Cold Brew', '5.00'],
    ],
    T2A: [
      ['SIGNATURE', ko ? '갈비 BBQ 플래터' : 'Galbi BBQ Platter', '29.99'],
      ['SIGNATURE', ko ? '돌솥비빔밥' : 'Stone Pot Bibimbap', '15.99'],
      ['SIGNATURE', ko ? '불고기 라이스볼' : 'Bulgogi Rice Bowl', '15.99'],
      ['SIGNATURE', ko ? '보쌈 플래터' : 'Bossam Platter', '29.99'],
      ['BBQ', ko ? '삼겹살 세트' : 'Pork Belly Set', '24.99'],
      ['BBQ', ko ? 'LA 갈비' : 'LA Galbi', '27.99'],
      ['BBQ', ko ? '제육볶음' : 'Spicy Pork Bulgogi', '16.99'],
      ['BBQ', ko ? '양념치킨' : 'Korean Fried Chicken', '18.99'],
      ['SOUP', ko ? '김치찌개' : 'Kimchi Stew', '13.99'],
      ['SOUP', ko ? '순두부찌개' : 'Soft Tofu Stew', '12.99'],
      ['SOUP', ko ? '된장찌개' : 'Soybean Stew', '12.99'],
      ['SOUP', ko ? '육개장' : 'Spicy Beef Soup', '14.99'],
      ['SOUP', ko ? '설렁탕' : 'Ox Bone Soup', '13.99'],
      ['NOODLES', ko ? '해물칼국수' : 'Seafood Knife Noodles', '16.99'],
      ['NOODLES', ko ? '비빔냉면' : 'Spicy Cold Noodles', '14.99'],
      ['NOODLES', ko ? '물냉면' : 'Cold Noodles', '13.99'],
      ['NOODLES', ko ? '짬뽕' : 'Spicy Seafood Noodles', '14.99'],
      ['SHAREABLES', ko ? '왕만두' : 'King Dumplings', '9.99'],
      ['SHAREABLES', ko ? '해물파전' : 'Seafood Pancake', '16.99'],
      ['SHAREABLES', ko ? '잡채' : 'Japchae', '15.99'],
      ['SHAREABLES', ko ? '떡볶이' : 'Tteokbokki', '12.99'],
      ['SHAREABLES', ko ? '두부김치' : 'Tofu Kimchi', '15.99'],
      ['SIDES', ko ? '계란찜' : 'Steamed Egg', '8.99'],
      ['SIDES', ko ? '콘치즈' : 'Corn Cheese', '8.99'],
      ['DESSERT', ko ? '호떡' : 'Hotteok', '6.99'],
      ['DESSERT', ko ? '빙수' : 'Bingsu', '12.99'],
      ['BEVERAGE', ko ? '식혜' : 'Sweet Rice Punch', '4.99'],
      ['BEVERAGE', ko ? '수정과' : 'Cinnamon Punch', '4.99'],
    ],
    T3A: [
      ['SUSHI', ko ? '오마카세 롤' : 'Omakase Roll', '18.00'],
      ['SUSHI', ko ? '스파이시 튜나 크리스피' : 'Spicy Tuna Crispy', '16.00'],
      ['SUSHI', ko ? '연어 유즈 사시미' : 'Salmon Yuzu Sashimi', '19.00'],
      ['SUSHI', ko ? '드래곤 롤' : 'Dragon Roll', '17.00'],
      ['SUSHI', ko ? '스캘럽 니기리' : 'Scallop Nigiri', '16.00'],
      ['RAMEN', ko ? '블랙마늘 라멘' : 'Black Garlic Ramen', '17.00'],
      ['RAMEN', ko ? '탄탄멘' : 'Tantanmen', '16.00'],
      ['RAMEN', ko ? '쇼유 치킨 라멘' : 'Shoyu Chicken Ramen', '15.00'],
      ['RAMEN', ko ? '해산물 우동' : 'Seafood Udon', '18.00'],
      ['RAMEN', ko ? '야키소바' : 'Yakisoba', '15.00'],
      ['IZAKAYA', ko ? '가라아게 바오' : 'Karaage Bao', '12.00'],
      ['IZAKAYA', ko ? '와규 고추장 타코' : 'Wagyu Gochujang Taco', '15.00'],
      ['IZAKAYA', ko ? '김치 프라이즈' : 'Kimchi Fries', '11.00'],
      ['IZAKAYA', ko ? '트러플 교자' : 'Truffle Gyoza', '13.00'],
      ['IZAKAYA', ko ? '칠리 새우 바오' : 'Chili Shrimp Bao', '13.00'],
      ['MAIN', ko ? '비프 타다키' : 'Beef Tataki', '22.00'],
      ['MAIN', ko ? '칠리 크랩 누들' : 'Chili Crab Noodles', '24.00'],
      ['MAIN', ko ? '연어 포케볼' : 'Salmon Poke Bowl', '18.00'],
      ['MAIN', ko ? '타이 바질 누들' : 'Thai Basil Noodles', '16.00'],
      ['MAIN', ko ? '포크 카츠 산도' : 'Pork Katsu Sando', '14.00'],
      ['COCKTAILS', ko ? '유자 하이볼' : 'Yuzu Highball', '12.00'],
      ['COCKTAILS', ko ? '시소 칵테일' : 'Shiso Spritz', '13.00'],
      ['COCKTAILS', ko ? '매실 마티니' : 'Plum Martini', '14.00'],
      ['COCKTAILS', ko ? '셰프 사케 플라이트' : 'Chef Sake Flight', '19.00'],
      ['DESSERT', ko ? '말차 티라미수' : 'Matcha Tiramisu', '11.00'],
      ['DESSERT', ko ? '모찌 아이스크림' : 'Mochi Ice Cream', '9.00'],
      ['DESSERT', ko ? '흑임자 판나코타' : 'Black Sesame Panna Cotta', '10.00'],
      ['BEVERAGE', ko ? '망고 유자 에이드' : 'Mango Yuzu Ade', '7.00'],
      ['BEVERAGE', ko ? '라임 소다' : 'Lime Soda', '6.00'],
      ['SUSHI', ko ? '토치드 살몬 롤' : 'Torched Salmon Roll', '18.00'],
    ],
  };

  return (sets[templateKey] || []).map(([section, name, price]) => ({ section, name, price }));
}

function getTemplateCards(lang) {
  const ko = lang === 'ko';
  return [
    {
      id: 'T1A',
      group: ko ? 'Template A' : 'Template A',
      name: ko ? '프리미엄 스테이크하우스' : 'Premium Steakhouse',
      desc: ko ? '다크 호텔 레스토랑 무드, 대형 스테이크 사진, 골드 포인트, 와인/디저트까지 한 화면에 보이는 태블릿 메뉴판' : 'Dark hotel dining mood with large steak photography, gold accents, wine, dessert, and QR ordering guidance.',
      tags: ko ? ['다크', '골드', '스테이크'] : ['Dark', 'Gold', 'Steak'],
      accent: '#d7b46a',
      tone: '#080604',
    },
    {
      id: 'T2A',
      group: ko ? 'Template B' : 'Template B',
      name: ko ? '현대적인 한식 레스토랑' : 'Modern Korean Restaurant',
      desc: ko ? '밝은 우드톤, 감성적인 미니멀 구성, 한식 사진 콜라주와 큼직한 메뉴 리스트가 결합된 메뉴판' : 'Warm wood tone, minimal editorial layout, Korean food collage, clear menu columns, and QR ordering guidance.',
      tags: ko ? ['우드톤', '한식', '미니멀'] : ['Wood', 'Korean', 'Minimal'],
      accent: '#7a4b25',
      tone: '#efe3cf',
    },
    {
      id: 'T3A',
      group: ko ? 'Template C' : 'Template C',
      name: ko ? '트렌디 아시안 퓨전' : 'Trendy Asian Fusion',
      desc: ko ? '강한 비주얼, 네온 포인트, 스시/라멘/이자카야 메뉴를 SNS 감성으로 보여주는 프리미엄 메뉴판' : 'Bold visual-first Asian fusion menu with neon accents, sushi, ramen, izakaya plates, drinks, and QR ordering guidance.',
      tags: ko ? ['퓨전', '네온', '비주얼'] : ['Fusion', 'Neon', 'Visual'],
      accent: '#ff3d9a',
      tone: '#080816',
    },
  ];
}

function previewBackground(card) {
  const patterns = {
    T1A: `radial-gradient(circle at 84% 12%, ${card.accent}44, transparent 30%), repeating-linear-gradient(95deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 28px), linear-gradient(145deg, ${card.tone}, #050505)`,
    T1B: `radial-gradient(circle at 78% 14%, ${card.accent}55, transparent 28%), repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 34px), linear-gradient(145deg, ${card.tone}, #050505)`,
    T1C: `radial-gradient(circle at 18% 16%, ${card.accent}44, transparent 30%), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(145deg, ${card.tone}, #f7f3e9)`,
    T2A: `radial-gradient(circle at 82% 14%, ${card.accent}44, transparent 30%), linear-gradient(115deg, transparent 0 43%, rgba(255,255,255,0.08) 43% 44%, transparent 44% 100%), linear-gradient(145deg, ${card.tone}, #050505)`,
    T2B: `radial-gradient(circle at 80% 18%, ${card.accent}66, transparent 28%), repeating-linear-gradient(135deg, rgba(239,68,68,0.22) 0 4px, transparent 4px 42px), linear-gradient(145deg, ${card.tone}, #4b1111)`,
    T2C: `radial-gradient(circle at 20% 18%, ${card.accent}55, transparent 30%), repeating-linear-gradient(110deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 32px), linear-gradient(145deg, ${card.tone}, #3b2432)`,
    T3A: `radial-gradient(circle at 78% 12%, ${card.accent}44, transparent 30%), radial-gradient(circle, rgba(255,255,255,0.10) 0 1px, transparent 2px), linear-gradient(145deg, ${card.tone}, #101827)`,
    T3B: `radial-gradient(circle at 18% 16%, ${card.accent}44, transparent 30%), linear-gradient(90deg, rgba(134,239,172,0.12) 1px, transparent 1px), linear-gradient(145deg, ${card.tone}, #172554)`,
    T3C: `radial-gradient(circle at 82% 18%, ${card.accent}44, transparent 30%), linear-gradient(115deg, transparent 0 46%, rgba(244,114,182,0.18) 46% 47%, transparent 47% 100%), linear-gradient(145deg, ${card.tone}, #050505)`,
  };
  return patterns[card.id] || `linear-gradient(145deg, ${card.tone}, #050505)`;
}

function previewPhotoBackground(card) {
  return `radial-gradient(circle at 42% 36%, #fff 0 16%, ${card.accent} 17% 34%, transparent 35%), radial-gradient(circle at 60% 54%, rgba(255,255,255,0.78), transparent 22%), ${card.tone}`;
}

function TemplatePreview({ card }) {
  const group = card.id.slice(0, 2);
  const variant = card.id.slice(2);
  const dense = card.id === 'T3B';
  const photoHeavy = group === 'T2';
  const tileHeavy = group === 'T3';
  const rows = dense ? 9 : tileHeavy ? 6 : photoHeavy ? 3 : 5;

  return (
    <div style={{ ...tp.preview, background: previewBackground(card) }}>
      <div style={{ ...tp.previewAccentGlow, background: card.accent }} />
      <div style={tp.previewHeader}>
        <div style={{ ...tp.previewLogo, borderColor: card.accent }} />
        <div style={tp.previewTitleBlock}>
          <div style={{ ...tp.previewBrand, background: card.accent }} />
          <div style={tp.previewSub} />
        </div>
        <div style={{ ...tp.previewQr, borderColor: card.accent }}>
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} style={{ ...tp.previewQrCell, background: index % 2 || index === 4 ? '#111827' : 'transparent' }} />
          ))}
        </div>
      </div>

      <div style={tp.previewFeature}>
        <div style={{ ...tp.previewHeroPhoto, background: previewPhotoBackground(card) }} />
        <div style={tp.previewHeroText}>
          <div style={{ ...tp.previewCategory, background: card.accent }} />
          <div style={tp.previewMiniLine} />
          <div style={tp.previewMiniLineShort} />
        </div>
      </div>

      {group === 'T1' && (
        <div style={tp.previewRows}>
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} style={{ ...tp.previewLine, borderLeft: `3px solid ${index % 3 === 0 ? card.accent : 'rgba(255,255,255,0.18)'}` }}>
              <div style={{ ...tp.previewName, width: `${56 + (index % 3) * 9}%` }} />
              <div style={{ ...tp.previewPrice, background: card.accent }} />
            </div>
          ))}
        </div>
      )}

      {group === 'T2' && (
        <div style={tp.previewPhotoBlocks}>
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} style={{ ...tp.previewPhotoBlock, gridTemplateColumns: variant === 'B' ? '1fr 64px' : '64px 1fr' }}>
              {variant === 'B' ? null : <div style={{ ...tp.previewPhoto, background: `radial-gradient(circle at 35% 30%, #fff, ${card.accent})` }} />}
              <div style={tp.previewMiniRows}>
                <div style={{ ...tp.previewCategory, background: card.accent }} />
                <div style={tp.previewMiniLine} />
                <div style={tp.previewMiniLineShort} />
              </div>
              {variant === 'B' ? <div style={{ ...tp.previewPhoto, background: `radial-gradient(circle at 35% 30%, #fff, ${card.accent})` }} /> : null}
            </div>
          ))}
        </div>
      )}

      {group === 'T3' && (
        <div style={{ ...tp.previewGrid, gridTemplateColumns: dense ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)' }}>
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} style={{ ...tp.previewTile, minHeight: dense ? 31 : 40 }}>
              <div style={{ ...tp.previewTileTitle, width: index % 2 ? '58%' : '74%' }} />
              <div style={{ ...tp.previewTilePrice, background: card.accent }} />
            </div>
          ))}
        </div>
      )}

      <div style={tp.previewFooter}>
        <div style={tp.previewFooterLine} />
        <div style={{ ...tp.previewFooterCta, background: card.accent }} />
      </div>
    </div>
  );
}

function TemplatePicker({ onPick, lang }) {
  const ko = lang === 'ko';
  const cards = getTemplateCards(lang);

  return (
    <div style={tp.wrap}>
      <div style={tp.top}>
        <div>
          <div style={tp.kicker}>{ko ? '레스토랑 바로 사용 템플릿' : 'Ready-to-use restaurant templates'}</div>
          <div style={tp.title}>{ko ? '로고, 사진, 메뉴명, 가격만 바꾸면 됩니다' : 'Replace logo, photos, menu names, and prices'}</div>
        </div>
        <div style={tp.count}>{ko ? `${cards.length}개 · 각 3페이지 세트` : `${cards.length} templates · 3 pages each`}</div>
      </div>

      <div style={tp.grid}>
        {cards.map((card) => (
          <button key={card.id} type="button" style={tp.card} onClick={() => onPick(card.id)}>
            <TemplatePreview card={card} />
            <div style={tp.cardBody}>
              <div style={tp.cardTop}>
                <div style={tp.group}>{card.group}</div>
                <div style={tp.id}>{ko ? '3페이지 완성형' : '3-page set'}</div>
              </div>
              <div style={tp.name}>{card.name}</div>
              <div style={tp.desc}>{card.desc}</div>
              <div style={tp.tags}>
                {card.tags.map((tag) => (
                  <span key={tag} style={tp.tag}>{tag}</span>
                ))}
              </div>
              <div style={{ ...tp.choose, background: card.accent }}>
                {ko ? '이 템플릿 사용' : 'Use this template'}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div style={tp.note}>
        {ko
          ? '상인은 템플릿을 고른 뒤 메뉴판 위의 로고, 글자, 가격, 사진을 손으로 눌러 바로 바꾸면 됩니다.'
          : 'After choosing a template, merchants can tap the logo, text, prices, and photos directly on the board to edit them.'}
      </div>
    </div>
  );
}

const tp = {
  wrap: {
    display: 'grid',
    gap: 10,
  },
  top: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  kicker: {
    fontSize: 13,
    fontWeight: 950,
    color: '#0f766e',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 3,
    fontSize: 19,
    fontWeight: 1000,
    color: '#111827',
    lineHeight: 1.15,
  },
  count: {
    padding: '8px 10px',
    borderRadius: 999,
    background: '#f1f5f9',
    color: '#334155',
    fontWeight: 900,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  card: {
    appearance: 'none',
    border: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: 12,
    padding: 0,
    overflow: 'hidden',
    cursor: 'pointer',
    textAlign: 'left',
    color: '#111827',
    boxShadow: '0 8px 20px rgba(15,23,42,0.08)',
  },
  preview: {
    position: 'relative',
    height: 132,
    padding: 9,
    boxSizing: 'border-box',
    display: 'grid',
    gap: 7,
    overflow: 'hidden',
  },
  previewAccentGlow: {
    position: 'absolute',
    right: -42,
    top: -46,
    width: 132,
    height: 132,
    borderRadius: 999,
    opacity: 0.28,
    filter: 'blur(1px)',
    pointerEvents: 'none',
  },
  previewHeader: {
    display: 'grid',
    gridTemplateColumns: '26px 1fr auto',
    gap: 6,
    alignItems: 'center',
  },
  previewLogo: {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: '2px solid',
    background: 'rgba(255,255,255,0.18)',
  },
  previewTitleBlock: {
    display: 'grid',
    gap: 5,
  },
  previewBrand: {
    height: 9,
    borderRadius: 999,
    width: '72%',
  },
  previewSub: {
    height: 6,
    borderRadius: 999,
    width: '46%',
    background: 'rgba(255,255,255,0.50)',
  },
  previewChip: {
    color: '#fff',
    border: '1px solid',
    borderRadius: 999,
    padding: '2px 6px',
    fontSize: 9,
    fontWeight: 1000,
    background: 'rgba(0,0,0,0.22)',
  },
  previewQr: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: '1px solid',
    background: 'rgba(255,255,255,0.92)',
    padding: 4,
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 2,
  },
  previewQrCell: {
    borderRadius: 1,
  },
  previewFeature: {
    display: 'grid',
    gridTemplateColumns: '42px 1fr',
    gap: 6,
    padding: 6,
    borderRadius: 9,
    background: 'rgba(255,255,255,0.11)',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 12px 26px rgba(0,0,0,0.14)',
  },
  previewHeroPhoto: {
    width: 42,
    height: 42,
    borderRadius: 9,
    border: '2px solid rgba(255,255,255,0.64)',
    boxShadow: '0 8px 18px rgba(0,0,0,0.28)',
  },
  previewHeroText: {
    display: 'grid',
    gap: 5,
    alignContent: 'center',
    minWidth: 0,
  },
  previewRows: {
    display: 'grid',
    gap: 5,
  },
  previewLine: {
    display: 'grid',
    gridTemplateColumns: '1fr 40px',
    gap: 10,
    alignItems: 'center',
    padding: '5px 7px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.10)',
    border: '1px solid rgba(255,255,255,0.12)',
  },
  previewName: {
    height: 8,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.72)',
  },
  previewPrice: {
    height: 9,
    borderRadius: 999,
  },
  previewPhotoBlocks: {
    display: 'grid',
    gap: 5,
  },
  previewPhotoBlock: {
    display: 'grid',
    gap: 5,
    alignItems: 'center',
    padding: 5,
    borderRadius: 9,
    background: 'rgba(255,255,255,0.10)',
    border: '1px solid rgba(255,255,255,0.12)',
  },
  previewPhoto: {
    width: 36,
    height: 36,
    borderRadius: 999,
    border: '2px solid rgba(255,255,255,0.76)',
    boxShadow: '0 8px 18px rgba(0,0,0,0.26)',
  },
  previewMiniRows: {
    display: 'grid',
    gap: 5,
  },
  previewCategory: {
    width: 58,
    height: 7,
    borderRadius: 999,
  },
  previewMiniLine: {
    height: 7,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.72)',
  },
  previewMiniLineShort: {
    height: 7,
    width: '64%',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.46)',
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 5,
  },
  previewTile: {
    minHeight: 32,
    borderRadius: 9,
    padding: 6,
    display: 'grid',
    alignContent: 'space-between',
    gap: 5,
    background: 'rgba(255,255,255,0.10)',
    border: '1px solid rgba(255,255,255,0.12)',
  },
  previewTileTitle: {
    height: 7,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.72)',
  },
  previewTilePrice: {
    height: 8,
    width: 34,
    borderRadius: 999,
  },
  previewFooter: {
    marginTop: 'auto',
    display: 'grid',
    gridTemplateColumns: '1fr 58px',
    gap: 8,
    alignItems: 'center',
    minHeight: 16,
  },
  previewFooterLine: {
    height: 7,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.52)',
    width: '76%',
  },
  previewFooterCta: {
    height: 14,
    borderRadius: 999,
  },
  cardBody: {
    padding: 10,
    display: 'grid',
    gap: 6,
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  group: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 950,
  },
  id: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: 1000,
    background: '#ecfdf5',
    border: '1px solid #bbf7d0',
    borderRadius: 999,
    padding: '3px 7px',
  },
  name: {
    fontSize: 15,
    fontWeight: 1000,
    lineHeight: 1.15,
  },
  desc: {
    minHeight: 0,
    maxHeight: 34,
    overflow: 'hidden',
    color: '#475569',
    fontSize: 11,
    fontWeight: 750,
    lineHeight: 1.35,
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    fontSize: 10,
    fontWeight: 900,
    color: '#334155',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 999,
    padding: '3px 6px',
  },
  choose: {
    marginTop: 2,
    borderRadius: 9,
    padding: '7px 8px',
    textAlign: 'center',
    color: '#111827',
    fontWeight: 1000,
  },
  note: {
    color: '#475569',
    fontWeight: 800,
    fontSize: 12,
    lineHeight: 1.4,
  },
};

export default function MenuEditor() {
  const router = useRouter();
  const initialReadyViewRef = useRef(undefined);
  if (initialReadyViewRef.current === undefined) {
    initialReadyViewRef.current = getInitialReadyViewSnapshot();
  }
  const initialReadyView = initialReadyViewRef.current;
  const initialWindowView = initialReadyView?.view || null;
  const hasInitialWindowView = !!initialWindowView?.layout;
  const initialPreparedBgUrl = getPreparedBackgroundUrl(initialWindowView);
  const initialPreparedBgOverrideUrls = getPreparedBackgroundOverrideUrls(initialWindowView);

  // ✅ 기본 배경(전체 페이지 default)
  const [bgBlob, setBgBlob] = useState(() => initialWindowView?.bgBlob || null);
  const [bgSignedUrl, setBgSignedUrl] = useState(() => initialWindowView?.bgSignedUrl || null);
  const [bgRuntimeUrl, setBgRuntimeUrl] = useState(() => initialPreparedBgUrl || null);

  // ✅ 페이지별 오버라이드 배경 blobs: { [pageNumber]: Blob }
  const [bgOverrides, setBgOverrides] = useState(() => initialWindowView?.bgOverrides || {});
  const [bgOverrideSignedUrls, setBgOverrideSignedUrls] = useState(() => initialWindowView?.bgOverrideSignedUrls || {});
  const [bgRuntimeOverrideUrls, setBgRuntimeOverrideUrls] = useState(() => initialPreparedBgOverrideUrls || {});

  const [layout, setLayout] = useState(() => initialWindowView?.layout || DEFAULT_LAYOUT);

  const [userReady, setUserReady] = useState(() => !!initialReadyView?.userId);
  const [userId, setUserId] = useState(() => initialReadyView?.userId || null);

  // ✅ “편집 모드”
  const [edit, setEdit] = useState(false);

  // ✅ MenuEditor 미리보기(단 하나)
  const [preview, setPreview] = useState(false);

  const [showEditorMenu, setShowEditorMenu] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [switchingLang, setSwitchingLang] = useState(null);
  const [templateNotice, setTemplateNotice] = useState('');
  const [freeLayoutOnboarding, setFreeLayoutOnboarding] = useState(false);
  const [onboardingRequested, setOnboardingRequested] = useState(false);

  const fileInputRef = useRef(null);
  const introVideoInputRef = useRef(null);
  const pageBgInputRef = useRef(null);
  const backupImportInputRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(() => !hasInitialWindowView);
  const [bgLoading, setBgLoading] = useState(() => !hasInitialWindowView);
  const [bgResolved, setBgResolved] = useState(() => hasInitialWindowView);
  const [bgAssetsReady, setBgAssetsReady] = useState(() => (
    hasInitialWindowView ? windowReadyViewHasBackground(initialWindowView) : false
  ));
  const [assetUploading, setAssetUploading] = useState(false);
  const [assetUploadMessage, setAssetUploadMessage] = useState('');

  const layoutSnapshotRef = useRef('');
  const bgSnapshotRef = useRef('');
  const editStartLayoutRef = useRef(null);
  const editStartLayoutsRef = useRef(new Map());
  const editStartLangRef = useRef(null);

  // ✅ 보기모드에서만 잠깐 보이는 “수정 버튼” 상태
  const [showEditBtn, setShowEditBtn] = useState(false);

  // ---- 5탭 카운터용 refs
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef(null);

  // ---- 자동 숨김 타이머
  const autoHideRef = useRef(null);
  const templateNoticeTimerRef = useRef(null);

  // ---- 길게 누르기 타이머
  const longPressRef = useRef(null);

  // ✅ stage 스크롤 ref
  const stageScrollRef = useRef(null);

  // ✅ 편집 방식 변경 모달
  const [editModeModalOpen, setEditModeModalOpen] = useState(false);

  // ✅ PIN 상태
  const [pin, setPin] = useState(DEFAULT_PIN);

  // ✅ PIN 입력 모달
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const pinStorageKey = useMemo(() => {
    return userId ? `${PIN_KEY}__${userId}` : PIN_KEY;
  }, [userId]);
  const pairedTemplateSyncStorageKey = useMemo(() => {
    return userId ? `${PAIRED_TEMPLATE_SYNC_KEY}__${userId}` : PAIRED_TEMPLATE_SYNC_KEY;
  }, [userId]);

  useEffect(() => {
    try {
      setOnboardingRequested(new URLSearchParams(window.location.search).get('onboarding') === '1');
    } catch {
      setOnboardingRequested(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let unsubscribe = null;
    let resolved = false;

    try {
      const cachedUserId = getCurrentUser();
      if (cachedUserId) {
        setUserId(cachedUserId);
        setUserReady(true);
      }
    } catch {}

    const finalize = (session) => {
      const uid = session?.user?.id;
      resolved = true;
      if (!uid) {
        clearCurrentUser();
        if (alive) {
          setUserReady(false);
          setLoading(false);
          setBgLoading(false);
          setBgResolved(true);
        }
        router.replace('/login');
        window.setTimeout(() => {
          if (window.location.pathname !== '/login') window.location.replace('/login');
        }, 100);
        return;
      }
      setCurrentUser(uid);
      if (!alive) return;
      setUserId(uid);
      setUserReady(true);
      setLoading(false);
    };

    const getSessionWithTimeout = (timeoutMs = 1200) =>
      Promise.race([
        supabase.auth.getSession(),
        new Promise((resolve) => {
          window.setTimeout(() => resolve({ data: { session: null } }), timeoutMs);
        }),
      ]);

    (async () => {
      const { data } = await getSessionWithTimeout();
      if (data?.session?.user?.id) {
        finalize(data.session);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (!alive) return;
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          finalize(session);
        }
        if (event === 'SIGNED_OUT') {
          finalize(null);
        }
      });
      unsubscribe = () => sub?.subscription?.unsubscribe?.();

      setTimeout(async () => {
        if (!alive || resolved) return;
        const { data: again } = await getSessionWithTimeout(800);
        finalize(again?.session || null);
      }, 1200);
    })();

    return () => {
      alive = false;
      if (unsubscribe) unsubscribe();
    };
  }, [router]);

  // ✅ 비밀번호 설정(변경) 모달
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [curPinInput, setCurPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  // ✅ 언어 상태 (hydration 이후에만 로컬 저장값을 반영해 초기 이중 로딩 방지)
  const [lang, setLang] = useState(() => initialReadyView?.language || 'en');
  const [langReady, setLangReady] = useState(false);
  const [hasInitialView, setHasInitialView] = useState(() => hasInitialWindowView);
  const [initialLanguageWarmupReady, setInitialLanguageWarmupReady] = useState(true);
  const initialLangRef = useRef(initialReadyView?.language || 'en');
  const layoutSyncedLangsRef = useRef(new Set());
  const backgroundSyncedLangsRef = useRef(new Set());
  const viewCacheRef = useRef(new Map());
  const templateDraftLayoutsRef = useRef(new Map());
  const pairedTemplateSyncRef = useRef(null);
  const editStartTemplateSyncRef = useRef(null);
  const warmingLangsRef = useRef(new Set());
  const warmingLanguagePromisesRef = useRef(new Map());
  const languageCacheRevisionRef = useRef(0);
  const pageHydrationRequestsRef = useRef(new Set());
  const backgroundImagePreloadRequestsRef = useRef(new Set());
  const visualsReadyLangsRef = useRef(new Set());
  const [visualsReadySignal, setVisualsReadySignal] = useState(0);
  const readyBundleWriteKeysRef = useRef(new Set());
  const readyBundleAppliedRef = useRef(null);
  const [readyBundleLookup, setReadyBundleLookup] = useState({
    identity: null,
    checked: false,
    hasBundle: false,
  });

  // ✅ 편집창 페이지 단위 보기
  const [pageView, setPageView] = useState(true);
  const [pageIndex, setPageIndex] = useState(1);
  const viewPageChangeSourceRef = useRef(null);

  // ✅ 템플릿 입력 패널 숨김/표시
  const [tplPanelOpen, setTplPanelOpen] = useState(true);

  // ✅ 페이지 배경 설정 모달
  const [pageBgModalOpen, setPageBgModalOpen] = useState(false);

  // ✅ viewport size (모바일/APK 보기모드 fit용)
  const [vw, setVw] = useState(1280);
  const [vh, setVh] = useState(900);

  useEffect(() => {
    const update = () => {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;

      const widthCandidates = [
        vv?.width,
        window.innerWidth,
        document.documentElement?.clientWidth,
      ]
        .map((v) => Number(v) || 0)
        .filter(Boolean);

      const heightCandidates = [
        vv?.height,
        window.innerHeight,
        document.documentElement?.clientHeight,
      ]
        .map((v) => Number(v) || 0)
        .filter(Boolean);

      setVw(widthCandidates.length ? Math.max(...widthCandidates) : 1280);
      setVh(heightCandidates.length ? Math.max(...heightCandidates) : 900);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', update);
    };
  }, []);

  // ✅ (핵심) 스크롤을 확실히 0으로 리셋하는 함수
  const hardResetScrollTop = (behavior = 'auto') => {
    const sc = stageScrollRef.current;
    if (sc) {
      sc.scrollTo({ top: 0, left: 0, behavior });
      sc.scrollTop = 0;
      sc.scrollLeft = 0;
    }

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior });
    }

    if (typeof document !== 'undefined') {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };

  useEffect(() => {
    try {
      layoutSnapshotRef.current = JSON.stringify(sanitizeLayoutMediaSafe(layout));
    } catch {
      layoutSnapshotRef.current = '';
    }
  }, [layout]);

  useEffect(() => {
    try {
      const bgMeta = {
        hasDefault: !!bgBlob,
        defaultSize: bgBlob?.size || 0,
        defaultType: bgBlob?.type || '',
        pages: Object.keys(bgOverrides || {})
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => [Number(key), bgOverrides[key]?.size || 0, bgOverrides[key]?.type || '']),
      };
      bgSnapshotRef.current = JSON.stringify(bgMeta);
    } catch {
      bgSnapshotRef.current = '';
    }
  }, [bgBlob, bgOverrides]);

  const rememberLanguageView = useCallback((language, patch = {}) => {
    const key = language === 'ko' ? 'ko' : 'en';
    const previous = viewCacheRef.current.get(key) || {};
    viewCacheRef.current.set(key, {
      ...previous,
      ...patch,
      updatedAt: Date.now(),
    });
  }, []);

  const loadLocalBackgroundBundle = useCallback(async (language, { migrateLegacy = false, pages = null, loadOverrides = true } = {}) => {
    let localBg = null;
    let localOverrides = {};

    try {
      const bgKey = menuBgKey(language);
      const localBgLang = await loadLocalBlob(bgKey);
      const localBgLegacy = localBgLang ? null : await loadLocalBlob(KEYS.MENU_BG);
      const bg = localBgLang || localBgLegacy || null;

      if (migrateLegacy && !localBgLang && localBgLegacy) {
        try {
          await saveBlob(bgKey, localBgLegacy);
        } catch {}
      }

      localBg = isBlobLike(bg) ? bg : null;

      try {
        const idxKey = bgOverridesKey(language);
        const overridesLang = await loadLocalJson(idxKey);
        const overridesLegacy = overridesLang ? null : await loadLocalJson(LEGACY_BG_OVERRIDES_KEY);
        const overrides = overridesLang || overridesLegacy || {};

        if (migrateLegacy && !overridesLang && overridesLegacy) {
          try {
            await saveJson(idxKey, overridesLegacy);
          } catch {}
        }

        const requestedPages = normalizePageList(pages);
        const overridePages = loadOverrides
          ? Object.keys(overrides || {})
          : (requestedPages || []).map(String).filter((page) => page in (overrides || {}));

        const map = {};
        for (const p of overridePages) {
          const pn = Number(p);
          if (!Number.isFinite(pn) || pn < 1) continue;

          const blobLang = await loadLocalBlob(bgPageKey(pn, language));
          const blobLegacy = blobLang ? null : await loadLocalBlob(legacyBgPageKey(pn));
          const blob = blobLang || blobLegacy || null;

          if (migrateLegacy && !blobLang && blobLegacy) {
            try {
              await saveBlob(bgPageKey(pn, language), blobLegacy);
            } catch {}
          }

          if (isBlobLike(blob)) map[pn] = blob;
        }
        localOverrides = map;
      } catch {}
    } catch {}

    return {
      bgBlob: localBg,
      bgOverrides: localOverrides,
      hasLocalBg: !!localBg || Object.keys(localOverrides).length > 0,
    };
  }, []);

  const loadRemoteBackgroundUrlBundle = useCallback(async (language, { loadOverrides = false, pages = null } = {}) => {
    let nextBgSignedUrl = null;
    let nextOverrideSignedUrls = {};

    try {
      nextBgSignedUrl = await getSignedAssetUrl(menuBgKey(language), { expiresInSec: 60 * 60 * 2 });

      const requestedPages = normalizePageList(pages);
      if (loadOverrides || requestedPages?.length) {
        const overrides =
          (await loadLocalJson(bgOverridesKey(language))) ||
          (await syncJsonFromCloud(bgOverridesKey(language)))?.data ||
          (await loadLocalJson(LEGACY_BG_OVERRIDES_KEY)) ||
          {};
        const overridePages = loadOverrides
          ? Object.keys(overrides || {})
          : requestedPages.map(String).filter((page) => page in (overrides || {}));

        const entries = await Promise.all(
          overridePages.map(async (page) => {
            const pn = Number(page);
            if (!Number.isFinite(pn) || pn < 1) return null;
            const signedUrl = await getSignedAssetUrl(bgPageKey(pn, language), { expiresInSec: 60 * 60 * 2 });
            return signedUrl ? [pn, signedUrl] : null;
          })
        );

        nextOverrideSignedUrls = Object.fromEntries(entries.filter(Boolean));
      }
    } catch {}

    return {
      bgSignedUrl: nextBgSignedUrl,
      bgOverrideSignedUrls: nextOverrideSignedUrls,
      hasAnyBg: !!nextBgSignedUrl || Object.keys(nextOverrideSignedUrls).length > 0,
    };
  }, []);

  const syncBackgroundBundleFromCloud = useCallback(async (language, { loadOverrides = true } = {}) => {
    let nextBg = null;
    let nextOverrides = {};

    try {
      const syncedBg = (await syncBlobFromCloud(menuBgKey(language)))?.data;
      const localBg = syncedBg || (await loadLocalBlob(menuBgKey(language))) || null;
      nextBg = isBlobLike(localBg) ? localBg : null;

      if (loadOverrides) {
        const overrides =
          (await syncJsonFromCloud(bgOverridesKey(language)))?.data ||
          (await loadLocalJson(bgOverridesKey(language))) ||
          (await loadLocalJson(LEGACY_BG_OVERRIDES_KEY)) ||
          {};

        const map = {};
        for (const p of Object.keys(overrides || {})) {
          const pn = Number(p);
          if (!Number.isFinite(pn) || pn < 1) continue;

          const blobSync = await syncBlobFromCloud(bgPageKey(pn, language));
          const blob = blobSync?.data || (await loadLocalBlob(bgPageKey(pn, language))) || null;
          if (isBlobLike(blob)) map[pn] = blob;
        }
        nextOverrides = map;
      }
    } catch {}

    return {
      bgBlob: nextBg,
      bgOverrides: nextOverrides,
      hasAnyBg: !!nextBg || Object.keys(nextOverrides).length > 0,
    };
  }, []);

  const loadBackgrounds = useCallback(async (isCancelled, { showLoading = false } = {}) => {
    let localBg = null;
    let localOverrides = {};
    let hasLocalBg = false;
    let hasTargetLocalBg = false;
    let fastSignedBgUrl = null;
    let fastSignedOverrideUrls = {};

    if (!isCancelled?.() && showLoading) {
      setBgResolved(false);
    }

    try {
      const localBundle = await withTimeout(
        loadLocalBackgroundBundle(lang, { migrateLegacy: true, pages: [1], loadOverrides: false }),
        900,
        { bgBlob: null, bgOverrides: {}, hasLocalBg: false }
      );
      localBg = localBundle.bgBlob;
      localOverrides = localBundle.bgOverrides;
      hasLocalBg = localBundle.hasLocalBg;
      hasTargetLocalBg = localBundle.hasLocalBg;

      if (!hasLocalBg) {
        const fallbackBundle = await withTimeout(
          loadLocalBackgroundBundle(fallbackLanguageFor(lang), { pages: [1], loadOverrides: false }),
          900,
          { bgBlob: null, bgOverrides: {}, hasLocalBg: false }
        );
        if (fallbackBundle.hasLocalBg) {
          localBg = fallbackBundle.bgBlob;
          localOverrides = fallbackBundle.bgOverrides;
          hasLocalBg = true;
        }
      }

      if (!isCancelled?.() && hasLocalBg) {
        setBgRuntimeUrl(getReusableBlobObjectUrl(localBg));
        setBgRuntimeOverrideUrls(getPreparedBackgroundOverrideUrls({ bgOverrides: localOverrides }));
        setBgBlob(localBg);
        setBgOverrides(localOverrides);
        setBgSignedUrl(null);
        setBgOverrideSignedUrls({});
        rememberLanguageView(lang, {
          bgBlob: localBg,
          bgOverrides: localOverrides,
          bgSignedUrl: null,
          bgOverrideSignedUrls: {},
          hasBackgroundCache: true,
        });
      }
    } catch {}

    if (!hasLocalBg && !isCancelled?.()) {
      const targetSignedBundle = await withTimeout(
        loadRemoteBackgroundUrlBundle(lang, { loadOverrides: false, pages: [1] }),
        1200,
        { hasAnyBg: false }
      );
      const signedBundle = targetSignedBundle.hasAnyBg
        ? targetSignedBundle
        : await withTimeout(
            loadRemoteBackgroundUrlBundle(fallbackLanguageFor(lang), { loadOverrides: false, pages: [1] }),
            1200,
            { hasAnyBg: false }
          );

      if (signedBundle.hasAnyBg && !isCancelled?.()) {
        hasLocalBg = true;
        hasTargetLocalBg = true;
        fastSignedBgUrl = signedBundle.bgSignedUrl || null;
        fastSignedOverrideUrls = signedBundle.bgOverrideSignedUrls || {};
        backgroundSyncedLangsRef.current.add(lang);
        setBgRuntimeUrl(null);
        setBgRuntimeOverrideUrls({});
        setBgBlob(null);
        setBgOverrides({});
        setBgSignedUrl(fastSignedBgUrl);
        setBgOverrideSignedUrls(fastSignedOverrideUrls);
        rememberLanguageView(lang, {
          bgBlob: null,
          bgOverrides: {},
          bgSignedUrl: fastSignedBgUrl,
          bgOverrideSignedUrls: fastSignedOverrideUrls,
          hasBackgroundCache: true,
        });
      }
    }

    const shouldBlock = showLoading && !hasLocalBg;
    if (!isCancelled?.()) {
      if (shouldBlock) {
        setBgLoading(true);
        setBgAssetsReady(false);
      } else {
        if (hasLocalBg) setBgResolved(true);
        setBgLoading(false);
      }
    }

    if (isCancelled?.()) return { hasLocalBg };

    const shouldRemoteSync =
      !backgroundSyncedLangsRef.current.has(lang) &&
      (lang === initialLangRef.current || !hasTargetLocalBg);

    if (!shouldRemoteSync) {
      if (!hasLocalBg && !isCancelled?.()) {
        setBgRuntimeUrl(null);
        setBgRuntimeOverrideUrls({});
        setBgBlob(null);
        setBgOverrides({});
        setBgSignedUrl(null);
        setBgOverrideSignedUrls({});
        rememberLanguageView(lang, {
          bgBlob: null,
          bgOverrides: {},
          bgSignedUrl: null,
          bgOverrideSignedUrls: {},
          hasBackgroundCache: true,
        });
      }
      if (!isCancelled?.()) setBgResolved(true);
      return { hasLocalBg };
    }

    backgroundSyncedLangsRef.current.add(lang);

    let finalBg = localBg;
    let finalOverrides = localOverrides;
    let hasAnyBg = hasLocalBg;

    try {
      const shouldLoadOverridesNow = !showLoading || hasLocalBg;
      const targetBundle = await withTimeout(
        syncBackgroundBundleFromCloud(lang, { loadOverrides: shouldLoadOverridesNow }),
        showLoading ? 1800 : 3000,
        { hasAnyBg: false, bgBlob: null, bgOverrides: {} }
      );
      if (targetBundle.hasAnyBg) {
        finalBg = targetBundle.bgBlob;
        finalOverrides = targetBundle.bgOverrides;
        hasAnyBg = true;
      }

      if (!hasAnyBg) {
        const fallbackBundle = await withTimeout(
          syncBackgroundBundleFromCloud(fallbackLanguageFor(lang), { loadOverrides: shouldLoadOverridesNow }),
          showLoading ? 1800 : 3000,
          { hasAnyBg: false, bgBlob: null, bgOverrides: {} }
        );
        if (fallbackBundle.hasAnyBg) {
          finalBg = fallbackBundle.bgBlob;
          finalOverrides = fallbackBundle.bgOverrides;
          hasAnyBg = true;
        }
      }
    } catch {} finally {
      if (!isCancelled?.()) {
        if (hasAnyBg) {
          const hasDownloadedBg = !!finalBg || Object.keys(finalOverrides || {}).length > 0;
          setBgRuntimeUrl(hasDownloadedBg ? getReusableBlobObjectUrl(finalBg) : null);
          setBgRuntimeOverrideUrls(hasDownloadedBg ? getPreparedBackgroundOverrideUrls({ bgOverrides: finalOverrides }) : {});
          setBgBlob(hasDownloadedBg ? finalBg || null : null);
          setBgOverrides(hasDownloadedBg ? finalOverrides || {} : {});
          setBgSignedUrl(hasDownloadedBg ? null : fastSignedBgUrl);
          setBgOverrideSignedUrls(hasDownloadedBg ? {} : fastSignedOverrideUrls);
        } else {
          setBgRuntimeUrl(null);
          setBgRuntimeOverrideUrls({});
          setBgBlob(null);
          setBgOverrides({});
          setBgSignedUrl(null);
          setBgOverrideSignedUrls({});
        }
        const hasDownloadedBg = !!finalBg || Object.keys(finalOverrides || {}).length > 0;
        rememberLanguageView(lang, {
          bgBlob: hasAnyBg && hasDownloadedBg ? finalBg || null : null,
          bgOverrides: hasAnyBg && hasDownloadedBg ? finalOverrides || {} : {},
          bgSignedUrl: hasAnyBg && !hasDownloadedBg ? fastSignedBgUrl : null,
          bgOverrideSignedUrls: hasAnyBg && !hasDownloadedBg ? fastSignedOverrideUrls : {},
          hasBackgroundCache: true,
        });
        setBgResolved(true);
        setBgLoading(false);
      }
    }

    if (showLoading && hasAnyBg && !hasLocalBg && !isCancelled?.()) {
      syncBackgroundBundleFromCloud(lang, { loadOverrides: true }).then((bundle) => {
        if (isCancelled?.() || !bundle?.hasAnyBg) return;
        const nextBg = bundle.bgBlob || finalBg || null;
        const nextOverrides = bundle.bgOverrides || {};
        setBgRuntimeUrl(getReusableBlobObjectUrl(nextBg));
        setBgRuntimeOverrideUrls(getPreparedBackgroundOverrideUrls({ bgOverrides: nextOverrides }));
        setBgBlob(nextBg);
        setBgOverrides(nextOverrides);
        setBgSignedUrl(null);
        setBgOverrideSignedUrls({});
        rememberLanguageView(lang, {
          bgBlob: nextBg,
          bgOverrides: nextOverrides,
          bgSignedUrl: null,
          bgOverrideSignedUrls: {},
          hasBackgroundCache: true,
        });
      });
    }

    return { hasLocalBg, hasAnyBg };
  }, [lang, loadLocalBackgroundBundle, loadRemoteBackgroundUrlBundle, rememberLanguageView, syncBackgroundBundleFromCloud]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      const nextLang = saved === 'ko' || saved === 'en' ? saved : 'en';
      initialLangRef.current = nextLang;
      setLang(nextLang);
    } catch {
      initialLangRef.current = 'en';
      setLang('en');
    } finally {
      setLangReady(true);
    }
  }, []);

  useEffect(() => {
    if (!userReady) return;
    // ✅ PIN 로드/초기화 (사용자별)
    try {
      const stored = localStorage.getItem(pinStorageKey);
      if (stored && typeof stored === 'string') {
        setPin(stored);
      } else {
        localStorage.setItem(pinStorageKey, DEFAULT_PIN);
        setPin(DEFAULT_PIN);
      }
    } catch {
      setPin(DEFAULT_PIN);
    }
  }, [userReady, pinStorageKey]);

  useEffect(() => {
    if (!userReady) return;
    try {
      const parsed = JSON.parse(localStorage.getItem(pairedTemplateSyncStorageKey) || 'null');
      pairedTemplateSyncRef.current = parsed?.templateId
        ? { templateId: String(parsed.templateId), ts: Number(parsed.ts || 0) || Date.now() }
        : null;
    } catch {
      pairedTemplateSyncRef.current = null;
    }
  }, [userReady, pairedTemplateSyncStorageKey]);

  const setPairedTemplateSync = useCallback((templateId) => {
    const safeTemplateId = isPremiumTemplateId(templateId) ? String(templateId) : null;
    const nextSync = safeTemplateId ? { templateId: safeTemplateId, ts: Date.now() } : null;
    pairedTemplateSyncRef.current = nextSync;
    try {
      if (nextSync) {
        localStorage.setItem(pairedTemplateSyncStorageKey, JSON.stringify(nextSync));
      } else {
        localStorage.removeItem(pairedTemplateSyncStorageKey);
      }
    } catch {}
  }, [pairedTemplateSyncStorageKey]);

  const normalizeLoadedLayout = useCallback((raw) => {
    const base = raw && typeof raw === 'object' ? raw : DEFAULT_LAYOUT;

    const safeItems = Array.isArray(base.items) ? base.items : [];
    const safePageBackgrounds =
      base.pageBackgrounds && typeof base.pageBackgrounds === 'object'
        ? base.pageBackgrounds
        : {};

    const pageCountFromItems = safeItems.reduce((max, item) => {
      const y = Number(item?.y || 0);
      const h = Number(item?.h || 0);
      const bottom = Math.max(0, y + h);
      const page = Math.floor(Math.max(0, bottom - 1) / (PAGE_HEIGHT + PAGE_GAP)) + 1;
      return Math.max(max, page);
    }, 1);

    const pageCountFromBackgrounds = Object.keys(safePageBackgrounds).reduce((max, key) => {
      const n = Number(key);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 1);
    const pageCountFromLayout = Number(base.pageCount) > 0 ? Math.floor(Number(base.pageCount)) : 1;
    const pageCountFromTemplate = isPremiumTemplateId(base.templateId) ? 3 : 1;

    const pageCount = Math.max(
      1,
      pageCountFromLayout,
      pageCountFromTemplate,
      pageCountFromItems,
      pageCountFromBackgrounds
    );

    return {
      mode: base.mode ?? null,
      templateId: base.templateId ?? null,
      items: safeItems,
      templateData: base.templateData ?? null,
      pageBackgrounds: safePageBackgrounds,
      pageCount,
    };
  }, []);

  const writeReadyLayoutBundle = useCallback((language, nextLayout) => {
    const safeLang = language === 'ko' ? 'ko' : 'en';
    const cached = viewCacheRef.current.get(safeLang) || {};
    const imageUrls = getAllLayoutImageUrls(nextLayout);
    const imagePreloadStats = {
      total: imageUrls.length,
      loaded: imageUrls.length,
      failed: 0,
      failedUrls: [],
    };

    writeWindowReadyView({
      language: safeLang,
      userId,
      layout: nextLayout,
      bgBlob: cached.bgBlob || null,
      bgOverrides: cached.bgOverrides || {},
      bgObjectUrl: cached.bgObjectUrl || null,
      bgOverrideObjectUrls: cached.bgOverrideObjectUrls || {},
      bgSignedUrl: cached.bgSignedUrl || null,
      bgOverrideSignedUrls: cached.bgOverrideSignedUrls || {},
    });

    return writeMenuReadyBundleAsync({
      language: safeLang,
      userId,
      layout: nextLayout,
      bgSignedUrl: cached.bgSignedUrl || null,
      bgOverrideSignedUrls: cached.bgOverrideSignedUrls || {},
      imagePreloadStats,
    });
  }, [userId]);

  const rememberReadyLayout = useCallback((language, nextLayout) => {
    const safeLang = language === 'ko' ? 'ko' : 'en';
    rememberLanguageView(safeLang, cacheOptionsForLayout(nextLayout));
    layoutSyncedLangsRef.current.add(safeLang);
    if (!layoutNeedsMediaHydration(nextLayout)) {
      visualsReadyLangsRef.current.add(safeLang);
    }
    writeReadyLayoutBundle(safeLang, nextLayout).catch(() => {});
  }, [rememberLanguageView, writeReadyLayoutBundle]);

  const applyPairedTemplate = useCallback(
    async (templateId) => {
      const sourceData = layout?.mode === 'template' ? layout.templateData : null;
      const koLayout = normalizeLoadedLayout(makeTemplateLayoutForLanguage(templateId, 'ko', sourceData));
      const enLayout = normalizeLoadedLayout(makeTemplateLayoutForLanguage(templateId, 'en', sourceData));
      const activeLayout = lang === 'ko' ? koLayout : enLayout;

      templateDraftLayoutsRef.current = new Map([
        ['ko', koLayout],
        ['en', enLayout],
      ]);
      setLayout(activeLayout);

      return activeLayout;
    },
    [lang, layout, normalizeLoadedLayout]
  );

  const updateTemplateDraftLayout = useCallback(
    (nextLayout, language = lang) => {
      const safeLang = language === 'ko' ? 'ko' : 'en';
      const normalized = normalizeLoadedLayout(nextLayout);

      const currentTemplateId = getCanonicalTemplateId(normalized);
      if (normalized?.mode !== 'template' || !isPremiumTemplateId(currentTemplateId)) {
        setLayout(normalized);
        return normalized;
      }

      const currentLayout = normalizeLoadedLayout(makeTemplateLayout(
        currentTemplateId,
        normalized.templateData
      ));
      const otherLang = safeLang === 'ko' ? 'en' : 'ko';
      const draftMap = templateDraftLayoutsRef.current instanceof Map
        ? templateDraftLayoutsRef.current
        : new Map();
      const otherDraft = draftMap.get(otherLang);
      const otherBase =
        otherDraft?.mode === 'template' && otherDraft?.templateId === currentLayout.templateId
          ? otherDraft
          : makeTemplateLayoutForLanguage(currentLayout.templateId, otherLang, currentLayout.templateData);
      const otherLayout = normalizeLoadedLayout(makeTemplateLayout(
        currentLayout.templateId,
        mergePairedTemplateEditData(
          otherBase.templateData || makeInitialTemplateData(currentLayout.templateId, otherLang),
          currentLayout.templateData
        )
      ));

      draftMap.set(safeLang, currentLayout);
      draftMap.set(otherLang, otherLayout);
      templateDraftLayoutsRef.current = draftMap;
      setLayout(currentLayout);
      return currentLayout;
    },
    [lang, normalizeLoadedLayout]
  );

  const persistLayout = useCallback(
    async (nextLayout) => {
      languageCacheRevisionRef.current += 1;
      warmingLangsRef.current.clear();
      warmingLanguagePromisesRef.current.clear();
      let normalized = normalizeLayoutTextForLanguage(normalizeLoadedLayout(nextLayout), lang) || DEFAULT_LAYOUT;

      const normalizedTemplateId = getCanonicalTemplateId(normalized);
      if (normalized?.mode === 'template' && isPremiumTemplateId(normalizedTemplateId)) {
        normalized = normalizeLoadedLayout(makeTemplateLayout(
          normalizedTemplateId,
          normalized.templateData
        ));
        const otherLang = lang === 'ko' ? 'en' : 'ko';
        const draftMap = templateDraftLayoutsRef.current instanceof Map
          ? templateDraftLayoutsRef.current
          : new Map();
        const otherDraft = draftMap.get(otherLang);
        const otherRaw = await withTimeout(loadLocalJson(menuLayoutKey(otherLang)), 900, null);
        const canReuseOther =
          otherRaw?.mode === 'template' &&
          otherRaw?.templateId === normalized.templateId;
        const canReuseDraft =
          otherDraft?.mode === 'template' &&
          otherDraft?.templateId === normalized.templateId;
        const otherBase = canReuseDraft
          ? otherDraft
          : canReuseOther
          ? normalizeLoadedLayout(otherRaw)
          : makeTemplateLayoutForLanguage(normalized.templateId, otherLang, normalized.templateData);
        const otherLayout = normalizeLoadedLayout(makeTemplateLayout(
          normalized.templateId,
          mergePairedTemplateEditData(
            otherBase.templateData || makeInitialTemplateData(normalized.templateId, otherLang),
            normalized.templateData
          )
        ));
        const sanitizedCurrent = sanitizeLayoutMediaSafe(normalized);
        const sanitizedOther = sanitizeLayoutMediaSafe(otherLayout);

        setPairedTemplateSync(normalized.templateId);
        setLayout(normalized);
        rememberReadyLayout(lang, normalized);
        rememberReadyLayout(otherLang, otherLayout);
        await Promise.all([
          saveJson(menuLayoutKey(lang), sanitizedCurrent),
          saveJson(menuLayoutKey(otherLang), sanitizedOther),
          writeReadyLayoutBundle(lang, normalized),
          writeReadyLayoutBundle(otherLang, otherLayout),
        ]);
        return sanitizedCurrent;
      }

      const sanitized = sanitizeLayoutMediaSafe(normalized);

      if (normalized?.mode === 'custom') {
        setPairedTemplateSync(null);
      }
      setLayout(normalized);
      rememberReadyLayout(lang, normalized);
      await Promise.all([
        saveJson(menuLayoutKey(lang), sanitized),
        writeReadyLayoutBundle(lang, normalized),
      ]);
      return sanitized;
    },
    [lang, normalizeLoadedLayout, rememberReadyLayout, setPairedTemplateSync, writeReadyLayoutBundle]
  );

  const repairLayoutMediaFromFallback = useCallback(
    async (targetLayout, targetLanguage) => {
      const safeTargetLang = targetLanguage === 'ko' ? 'ko' : 'en';
      if (!layoutNeedsMediaHydration(targetLayout)) return targetLayout;

      const fallbackLang = fallbackLanguageFor(safeTargetLang);
      let fallbackRaw = viewCacheRef.current.get(fallbackLang)?.layout || null;

      if (!fallbackRaw) {
        fallbackRaw = await withTimeout(loadLocalJson(menuLayoutKey(fallbackLang)), 1200, null);
      }

      if (!fallbackRaw) {
        const remote = await withTimeout(syncJsonFromCloud(menuLayoutKey(fallbackLang)), 3000, null);
        fallbackRaw = remote?.data || null;
      }

      if (!isUsableMenuLayout(fallbackRaw)) return targetLayout;

      let fallbackLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(fallbackRaw), fallbackLang);
      const migratedFallback = await migrateLegacyInlineMediaSafe(fallbackLayout);
      fallbackLayout = await withTimeout(hydrateLayoutMediaSafe(migratedFallback.layout), 5000, migratedFallback.layout);

      const repaired = repairMissingMediaItemsFromFallback(targetLayout, fallbackLayout);
      if (!repaired.changed) return targetLayout;

      const hydratedRepairedLayout = layoutNeedsMediaHydration(repaired.layout)
        ? await withTimeout(hydrateLayoutMediaSafe(repaired.layout), 5000, repaired.layout)
        : repaired.layout;

      await saveJson(menuLayoutKey(safeTargetLang), sanitizeLayoutMediaSafe(hydratedRepairedLayout));
      return hydratedRepairedLayout;
    },
    [normalizeLoadedLayout]
  );

  useEffect(() => {
    if (!userReady || !langReady) return;
    if (edit) return;

    const identity = menuReadyBundleIdentity(lang, userId);
    const syncedTemplateId = pairedTemplateSyncRef.current?.templateId || null;
    if (readyBundleAppliedRef.current === identity) {
      setReadyBundleLookup((prev) => (
        prev.identity === identity && prev.checked && prev.hasBundle
          ? prev
          : { identity, checked: true, hasBundle: true }
      ));
      return;
    }

    const windowReadyView = readWindowReadyView(lang, userId);
    if (windowReadyView?.layout) {
      const readyLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(windowReadyView.layout), lang);
      if (layoutConflictsWithSyncedTemplate(readyLayout, syncedTemplateId)) {
        setReadyBundleLookup({ identity, checked: true, hasBundle: false });
      } else {
        readyBundleAppliedRef.current = identity;
        layoutSyncedLangsRef.current.add(lang);
        const hasWindowBackground =
          !!windowReadyView.bgBlob ||
          !!windowReadyView.bgSignedUrl ||
          Object.keys(windowReadyView.bgOverrides || {}).length > 0 ||
          Object.keys(windowReadyView.bgOverrideSignedUrls || {}).length > 0;
        if (hasWindowBackground) backgroundSyncedLangsRef.current.add(lang);
        visualsReadyLangsRef.current.add(lang);

        setLayout(readyLayout);
        setBgRuntimeUrl(getPreparedBackgroundUrl(windowReadyView));
        setBgRuntimeOverrideUrls(getPreparedBackgroundOverrideUrls(windowReadyView));
        setBgBlob(windowReadyView.bgBlob || null);
        setBgOverrides(windowReadyView.bgOverrides || {});
        setBgSignedUrl(windowReadyView.bgSignedUrl || null);
        setBgOverrideSignedUrls(windowReadyView.bgOverrideSignedUrls || {});
        setBgAssetsReady(hasWindowBackground);
        setBgResolved(true);
        setBgLoading(false);
        setLoading(false);
        setHasInitialView(true);
        rememberLanguageView(lang, {
          layout: readyLayout,
          hasLayoutCache: true,
          hasFullMediaCache: !layoutNeedsMediaHydration(readyLayout),
          bgBlob: windowReadyView.bgBlob || null,
          bgOverrides: windowReadyView.bgOverrides || {},
          bgObjectUrl: windowReadyView.bgObjectUrl || null,
          bgOverrideObjectUrls: windowReadyView.bgOverrideObjectUrls || {},
          bgSignedUrl: windowReadyView.bgSignedUrl || null,
          bgOverrideSignedUrls: windowReadyView.bgOverrideSignedUrls || {},
          hasBackgroundCache: hasWindowBackground,
        });
        setReadyBundleLookup({ identity, checked: true, hasBundle: true });
        return;
      }
    }

    let cancelled = false;
    setReadyBundleLookup({ identity, checked: false, hasBundle: false });

    (async () => {
      const bundle =
        readMenuReadyBundle(lang, userId) ||
        await withTimeout(readMenuReadyBundleAsync(lang, userId), 900, null);
      if (cancelled) return;
      if (!bundle?.layout) {
        setReadyBundleLookup({ identity, checked: true, hasBundle: false });
        return;
      }

      const bundledLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(bundle.layout), lang);
      if (layoutConflictsWithSyncedTemplate(bundledLayout, syncedTemplateId)) {
        setReadyBundleLookup({ identity, checked: true, hasBundle: false });
        return;
      }
      if (!isUsableMenuLayout(bundledLayout)) {
        setReadyBundleLookup({ identity, checked: true, hasBundle: false });
        return;
      }

      readyBundleAppliedRef.current = identity;
      layoutSyncedLangsRef.current.add(lang);
      if (readyBundleImagesComplete(bundle)) {
        visualsReadyLangsRef.current.add(lang);
      }
      const hasBundleBackground =
        !!bundle.bgSignedUrl ||
        Object.keys(bundle.bgOverrideSignedUrls || {}).length > 0;
      if (hasBundleBackground) {
        backgroundSyncedLangsRef.current.add(lang);
      }

      setLayout(bundledLayout);
      setBgRuntimeUrl(null);
      setBgRuntimeOverrideUrls({});
      setBgBlob(null);
      setBgOverrides({});
      setBgSignedUrl(bundle.bgSignedUrl || null);
      setBgOverrideSignedUrls(bundle.bgOverrideSignedUrls || {});
      setBgAssetsReady(hasBundleBackground);
      setBgResolved(true);
      setBgLoading(false);
      setLoading(false);
      setHasInitialView(true);

      rememberLanguageView(lang, {
        layout: bundledLayout,
        hasLayoutCache: true,
        hasFullMediaCache: !layoutNeedsMediaHydration(bundledLayout),
        bgBlob: null,
        bgOverrides: {},
        bgSignedUrl: bundle.bgSignedUrl || null,
        bgOverrideSignedUrls: bundle.bgOverrideSignedUrls || {},
        hasBackgroundCache: hasBundleBackground,
      });
      setReadyBundleLookup({ identity, checked: true, hasBundle: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [userReady, userId, langReady, lang, edit, normalizeLoadedLayout, rememberLanguageView]);

  useEffect(() => {
    if (!userReady || !langReady) return;
    if (edit) return;
    const identity = menuReadyBundleIdentity(lang, userId);
    const cachedForLang = viewCacheRef.current.get(lang);
    if (readyBundleAppliedRef.current === identity && cachedForLang?.hasBackgroundCache) return;
    if (
      readyBundleLookup.identity === identity &&
      readyBundleLookup.checked &&
      readyBundleLookup.hasBundle &&
      cachedForLang?.hasBackgroundCache
    ) return;
    if (hasInitialView) {
      const cached = viewCacheRef.current.get(lang);
      if (cached?.hasBackgroundCache) {
        setBgResolved(true);
        setBgLoading(false);
        return;
      }
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    loadBackgrounds(isCancelled, { showLoading: true });
    return () => {
      cancelled = true;
    };
  }, [userReady, userId, langReady, lang, hasInitialView, loadBackgrounds, readyBundleLookup]);

  const preloadLanguageView = useCallback(
    async (language) => {
      if (!userReady || !langReady) return null;
      const targetLang = language === 'ko' ? 'ko' : 'en';
      const cacheRevision = languageCacheRevisionRef.current;
      const isCacheRevisionCurrent = () => languageCacheRevisionRef.current === cacheRevision;
      const rememberLanguageViewIfCurrent = (targetLanguage, patch) => {
        if (!isCacheRevisionCurrent()) return false;
        rememberLanguageView(targetLanguage, patch);
        return true;
      };
      const cached = viewCacheRef.current.get(targetLang);
      const cachedLayoutReady =
        cached?.hasLayoutCache &&
        cached?.hasFullMediaCache &&
        !layoutNeedsMediaHydration(cached.layout);
      if (cachedLayoutReady && cached?.hasBackgroundCache) return cached;

      const readyBundle =
        readMenuReadyBundle(targetLang, userId) ||
        await withTimeout(readMenuReadyBundleAsync(targetLang, userId), 900, null);
      if (readyBundle?.layout) {
        const bundledLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(readyBundle.layout), targetLang);
        if (isUsableMenuLayout(bundledLayout)) {
          const hasBundleBackground =
            !!readyBundle.bgSignedUrl ||
            Object.keys(readyBundle.bgOverrideSignedUrls || {}).length > 0;
          if (!rememberLanguageViewIfCurrent(targetLang, {
            layout: bundledLayout,
            hasLayoutCache: true,
            hasFullMediaCache: !layoutNeedsMediaHydration(bundledLayout),
            bgBlob: null,
            bgOverrides: {},
            bgSignedUrl: readyBundle.bgSignedUrl || null,
            bgOverrideSignedUrls: readyBundle.bgOverrideSignedUrls || {},
            hasBackgroundCache: hasBundleBackground,
          })) {
            return viewCacheRef.current.get(targetLang) || null;
          }
          if (readyBundleImagesComplete(readyBundle)) {
            visualsReadyLangsRef.current.add(targetLang);
          }
          layoutSyncedLangsRef.current.add(targetLang);
          if (hasBundleBackground) backgroundSyncedLangsRef.current.add(targetLang);
          return viewCacheRef.current.get(targetLang) || null;
        }
      }

      const pending = warmingLanguagePromisesRef.current.get(targetLang);
      if (pending) return pending;

      const work = (async () => {
        let nextCache = viewCacheRef.current.get(targetLang) || {};

        warmingLangsRef.current.add(targetLang);
        try {
          if (
            nextCache?.hasLayoutCache &&
            !nextCache?.hasFullMediaCache &&
            !layoutNeedsMediaHydration(nextCache.layout)
          ) {
            rememberLanguageViewIfCurrent(targetLang, { hasFullMediaCache: true });
            nextCache = viewCacheRef.current.get(targetLang) || nextCache;
          }

          if (!nextCache?.hasLayoutCache || layoutNeedsMediaHydration(nextCache.layout)) {
            const key = menuLayoutKey(targetLang);
            const saved = nextCache?.layout || await loadLocalJson(key);
            const remote = saved ? null : await syncJsonFromCloud(key);
            const rawLayout = saved || remote?.data || null;

            if (isUsableMenuLayout(rawLayout)) {
              let safeLay = normalizeLayoutTextForLanguage(normalizeLoadedLayout(rawLayout), targetLang);
              const migratedLocal = await migrateLegacyInlineMediaSafe(safeLay);
              safeLay = await withTimeout(hydrateLayoutMediaSafe(migratedLocal.layout), 15000, migratedLocal.layout);
              safeLay = await withTimeout(repairLayoutMediaFromFallback(safeLay, targetLang), 5000, safeLay);
              rememberLanguageViewIfCurrent(targetLang, {
                layout: safeLay,
                hasLayoutCache: true,
                hasFullMediaCache: !layoutNeedsMediaHydration(safeLay),
              });
              nextCache = viewCacheRef.current.get(targetLang) || nextCache;
            }
          }

          if (!nextCache?.hasBackgroundCache) {
            const localBundle = await loadLocalBackgroundBundle(targetLang, { loadOverrides: true });
            const fallbackBundle = localBundle.hasLocalBg
              ? null
              : await loadLocalBackgroundBundle(fallbackLanguageFor(targetLang), { loadOverrides: true });
            const bundle = localBundle.hasLocalBg ? localBundle : fallbackBundle || localBundle;

            if (bundle.hasLocalBg) {
              rememberLanguageViewIfCurrent(targetLang, {
                bgBlob: bundle.bgBlob,
                bgOverrides: bundle.bgOverrides,
                bgSignedUrl: null,
                bgOverrideSignedUrls: {},
                hasBackgroundCache: true,
              });
            } else {
              const signedBundle = await loadRemoteBackgroundUrlBundle(targetLang, { loadOverrides: true });
              rememberLanguageViewIfCurrent(targetLang, {
                bgBlob: null,
                bgOverrides: {},
                bgSignedUrl: signedBundle.bgSignedUrl || null,
                bgOverrideSignedUrls: signedBundle.bgOverrideSignedUrls || {},
                hasBackgroundCache: true,
              });
            }
          }
        } catch (error) {
          console.error('preloadLanguageView failed', error);
        } finally {
          if (isCacheRevisionCurrent()) {
            if (viewCacheRef.current.get(targetLang)?.hasLayoutCache) {
              layoutSyncedLangsRef.current.add(targetLang);
            }
            if (viewCacheRef.current.get(targetLang)?.hasBackgroundCache) {
              backgroundSyncedLangsRef.current.add(targetLang);
            }
            const finalCache = viewCacheRef.current.get(targetLang);
            if (finalCache?.layout && !layoutNeedsMediaHydration(finalCache.layout)) {
              const stats = await withTimeout(
                preloadImageUrlsUntilReady(getAllLayoutImageUrls(finalCache.layout), 6000, 2),
                10000,
                null
              );
              if (imagePreloadStatsComplete(finalCache.layout, stats) && isCacheRevisionCurrent()) {
                visualsReadyLangsRef.current.add(targetLang);
                writeWindowReadyView({
                  language: targetLang,
                  userId,
                  layout: finalCache.layout,
                  bgBlob: finalCache.bgBlob || null,
                  bgOverrides: finalCache.bgOverrides || {},
                  bgSignedUrl: finalCache.bgSignedUrl || null,
                  bgOverrideSignedUrls: finalCache.bgOverrideSignedUrls || {},
                });
                writeMenuReadyBundleAsync({
                  language: targetLang,
                  userId,
                  layout: finalCache.layout,
                  bgSignedUrl: finalCache.bgSignedUrl || null,
                  bgOverrideSignedUrls: finalCache.bgOverrideSignedUrls || {},
                  imagePreloadStats: stats,
                }).catch((error) => {
                  console.error('write preloaded language bundle failed', error);
                });
              }
            }
          }
          warmingLangsRef.current.delete(targetLang);
          warmingLanguagePromisesRef.current.delete(targetLang);
        }

        return viewCacheRef.current.get(targetLang) || null;
      })();

      warmingLanguagePromisesRef.current.set(targetLang, work);
      return work;
    },
    [userReady, userId, langReady, normalizeLoadedLayout, rememberLanguageView, loadLocalBackgroundBundle, loadRemoteBackgroundUrlBundle, repairLayoutMediaFromFallback]
  );


  const refreshLayoutFromCloud = useCallback(
    async ({ showLoading = false, force = false } = {}) => {
      if (!userReady) return null;
      if (showLoading) setLoading(true);
      try {
        const syncResult = await withTimeout(
          syncJsonFromCloud(menuLayoutKey(lang), {
            force,
            onRemoteDiff: () => {
              if (showLoading) setLoading(true);
            },
          }),
          5000,
          null
        );
        if (!syncResult?.data) return null;

        let safeLay = normalizeLayoutTextForLanguage(normalizeLoadedLayout(syncResult.data), lang);
        const migratedRemote = await migrateLegacyInlineMediaSafe(safeLay);
        safeLay = await withTimeout(hydrateLayoutMediaSafe(migratedRemote.layout), 15000, migratedRemote.layout);
        safeLay = await withTimeout(repairLayoutMediaFromFallback(safeLay, lang), 5000, safeLay);

        const nextSnapshot = JSON.stringify(sanitizeLayoutMediaSafe(safeLay));
        const changed = nextSnapshot !== layoutSnapshotRef.current;

        if (changed) {
          layoutSnapshotRef.current = nextSnapshot;
          setLayout(safeLay);
          if (migratedRemote.changed) {
            await persistLayout(safeLay);
          }
        }
        rememberLanguageView(lang, {
          layout: safeLay,
          hasLayoutCache: true,
          hasFullMediaCache: !layoutNeedsMediaHydration(safeLay),
        });

        return safeLay;
      } catch (error) {
        console.error('refreshLayoutFromCloud failed', error);
        return null;
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [userReady, lang, normalizeLoadedLayout, persistLayout, rememberLanguageView, repairLayoutMediaFromFallback]
  );

  const refreshBackgroundsFromCloud = useCallback(
    async ({ showLoading = false } = {}) => {
      if (!userReady) return;
      if (showLoading) {
        await loadBackgrounds(() => false, { showLoading: true });
        return;
      }

      try {
        const nextBg = (await syncBlobFromCloud(menuBgKey(lang)))?.data || (await loadLocalBlob(menuBgKey(lang))) || null;
        const overrides =
          (await syncJsonFromCloud(bgOverridesKey(lang)))?.data ||
          (await loadLocalJson(bgOverridesKey(lang))) ||
          (await loadLocalJson(LEGACY_BG_OVERRIDES_KEY)) ||
          {};

        const nextOverrides = {};
        for (const p of Object.keys(overrides || {})) {
          const pn = Number(p);
          if (!Number.isFinite(pn) || pn < 1) continue;
          const blobSync = await syncBlobFromCloud(bgPageKey(pn, lang));
          const blob = blobSync?.data || (await loadLocalBlob(bgPageKey(pn, lang))) || null;
          if (isBlobLike(blob)) nextOverrides[pn] = blob;
        }

        const nextMeta = JSON.stringify({
          hasDefault: !!nextBg,
          defaultSize: nextBg?.size || 0,
          defaultType: nextBg?.type || '',
          pages: Object.keys(nextOverrides)
            .sort((a, b) => Number(a) - Number(b))
            .map((key) => [Number(key), nextOverrides[key]?.size || 0, nextOverrides[key]?.type || '']),
        });

        if (nextMeta !== bgSnapshotRef.current) {
          bgSnapshotRef.current = nextMeta;
          setBgRuntimeUrl(getReusableBlobObjectUrl(nextBg));
          setBgRuntimeOverrideUrls(getPreparedBackgroundOverrideUrls({ bgOverrides: nextOverrides }));
          setBgBlob(nextBg);
          setBgOverrides(nextOverrides);
          setBgSignedUrl(null);
          setBgOverrideSignedUrls({});
        }
        rememberLanguageView(lang, {
          bgBlob: nextBg,
          bgOverrides: nextOverrides,
          bgSignedUrl: null,
          bgOverrideSignedUrls: {},
          hasBackgroundCache: true,
        });
      } catch (error) {
        console.error('refreshBackgroundsFromCloud failed', error);
      }
    },
    [userReady, lang, loadBackgrounds, rememberLanguageView]
  );

  useEffect(() => {
    if (!userReady || !langReady) return;
    if (edit) return;
    const identity = menuReadyBundleIdentity(lang, userId);
    if (readyBundleAppliedRef.current === identity) return;
    if (readyBundleLookup.identity === identity && readyBundleLookup.checked && readyBundleLookup.hasBundle) return;

    let cancelled = false;

    (async () => {
      let saved = null;
      let hasLocalLayout = false;
      let hasUsableLocalLayout = false;
      let hasTargetLocalLayout = false;
      let hasUsableTargetLocalLayout = false;
      let usingTargetLayout = false;

      try {
        const key = menuLayoutKey(lang);
        const targetSaved = await withTimeout(loadLocalJson(key), 1200, null);
        hasTargetLocalLayout = !!targetSaved;

        if (hasTargetLocalLayout) {
          const syncedTemplateId = pairedTemplateSyncRef.current?.templateId || null;
          if (layoutConflictsWithSyncedTemplate(targetSaved, syncedTemplateId)) {
            const cachedForLang = viewCacheRef.current.get(lang)?.layout;
            const fallbackLang = fallbackLanguageFor(lang);
            const cachedFallback = viewCacheRef.current.get(fallbackLang)?.layout;
            const sourceTemplate =
              cachedForLang?.mode === 'template' && getCanonicalTemplateId(cachedForLang) === syncedTemplateId
                ? cachedForLang
                : cachedFallback?.mode === 'template' && getCanonicalTemplateId(cachedFallback) === syncedTemplateId
                ? cachedFallback
                : layout?.mode === 'template' && getCanonicalTemplateId(layout) === syncedTemplateId
                ? layout
                : null;
            saved = normalizeLoadedLayout(
              makeTemplateLayoutForLanguage(syncedTemplateId, lang, sourceTemplate?.templateData)
            );
            await saveJson(menuLayoutKey(lang), sanitizeLayoutMediaSafe(saved));
          } else {
            saved = targetSaved;
          }
          usingTargetLayout = true;
        }

        hasLocalLayout = isUsableMenuLayout(saved);

        if (hasLocalLayout) {
          const lay = saved || DEFAULT_LAYOUT;

          let safeLay = normalizeLayoutTextForLanguage(normalizeLoadedLayout(lay), lang);
          const migratedLocal = await migrateLegacyInlineMediaSafe(safeLay);
          const hydratedLay = await withTimeout(
            hydrateLayoutMediaSafe(migratedLocal.layout),
            15000,
            migratedLocal.layout
          );
          safeLay = await withTimeout(
            repairLayoutMediaFromFallback(hydratedLay, lang),
            5000,
            hydratedLay
          );
          const allImageUrls = getAllLayoutImageUrls(safeLay);
          preloadImageUrlsUntilReady(allImageUrls, 6000, 2)
            .then((stats) => {
              visualsReadyLangsRef.current.add(lang);
              setVisualsReadySignal((value) => value + 1);
              if (!imagePreloadStatsComplete(safeLay, stats)) return;
              const writeKey = `initial:${lang}:${userId || 'user'}:${stats.total}:${safeLay.items?.length || 0}`;
              if (readyBundleWriteKeysRef.current.has(writeKey)) return;
              readyBundleWriteKeysRef.current.add(writeKey);
              writeWindowReadyView({
                language: lang,
                userId,
                layout: safeLay,
                bgBlob: bgBlob || null,
                bgOverrides: bgOverrides || {},
                bgObjectUrl: bgRuntimeUrl || null,
                bgOverrideObjectUrls: bgRuntimeOverrideUrls || {},
                bgSignedUrl: bgSignedUrl || null,
                bgOverrideSignedUrls: bgOverrideSignedUrls || {},
              });
              return writeMenuReadyBundleAsync({
                language: lang,
                userId,
                layout: safeLay,
                bgSignedUrl: bgSignedUrl || null,
                bgOverrideSignedUrls: bgOverrideSignedUrls || {},
                imagePreloadStats: stats,
              });
            })
            .catch((error) => {
              console.error('initial menu image preload failed', error);
            });

          if (!cancelled) {
            setLayout(safeLay);
            rememberLanguageView(lang, {
              layout: safeLay,
              hasLayoutCache: true,
              hasFullMediaCache: !layoutNeedsMediaHydration(safeLay),
            });
            setLoading(false);
          }

          rememberLanguageView(lang, {
            layout: safeLay,
            hasLayoutCache: true,
            hasFullMediaCache: !layoutNeedsMediaHydration(safeLay),
          });
          hasUsableLocalLayout = safeLay.mode === 'custom' || safeLay.mode === 'template';
          hasUsableTargetLocalLayout = usingTargetLayout && hasUsableLocalLayout;

          if (usingTargetLayout && migratedLocal.changed) {
            await persistLayout(safeLay);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }

      const shouldRemoteSync =
        !layoutSyncedLangsRef.current.has(lang) &&
        (lang === initialLangRef.current || !hasTargetLocalLayout || !hasUsableTargetLocalLayout);

      if (shouldRemoteSync && !cancelled) {
        layoutSyncedLangsRef.current.add(lang);
        const remoteLayout = await withTimeout(
          refreshLayoutFromCloud({
            showLoading: !hasLocalLayout || !hasUsableLocalLayout,
            force: !hasUsableLocalLayout,
          }),
          hasLocalLayout ? 6000 : 10000,
          null
        );
        if (!isUsableMenuLayout(remoteLayout) && !hasLocalLayout && !cancelled) {
          setLayout(DEFAULT_LAYOUT);
        }
      } else if (!hasLocalLayout && !cancelled) {
        setLayout(DEFAULT_LAYOUT);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userReady, userId, langReady, lang, edit, layout, normalizeLoadedLayout, persistLayout, refreshLayoutFromCloud, repairLayoutMediaFromFallback, readyBundleLookup]);

  useEffect(() => {
    if (!userReady || !langReady) return;
    if (layout?.mode !== 'custom') return;

    const items = Array.isArray(layout?.items) ? layout.items : [];
    const needsHydration = items.some((item) => {
      if (!item || (item.type !== 'image' && item.type !== 'video')) return false;
      return !!item.assetPath && (!item.src || isBlobUrlSrc(item.src));
    });
    if (!needsHydration) return;

    const requestKey = `${lang}:all-media`;
    if (pageHydrationRequestsRef.current.has(requestKey)) return;
    pageHydrationRequestsRef.current.add(requestKey);

    let cancelled = false;
    (async () => {
      try {
        const hydratedPageLayout = await hydrateLayoutMediaSafe(layout);
        if (cancelled) return;
        await preloadImageUrlsUntilReady(getAllLayoutImageUrls(hydratedPageLayout), 8000, 2);
        if (cancelled) return;

        setLayout(hydratedPageLayout);
        rememberLanguageView(lang, {
          layout: hydratedPageLayout,
          hasLayoutCache: true,
          hasFullMediaCache: !layoutNeedsMediaHydration(hydratedPageLayout),
        });
      } finally {
        pageHydrationRequestsRef.current.delete(requestKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userReady, langReady, lang, layout, rememberLanguageView]);


  useEffect(() => {
    if (!LIVE_MENU_REFRESH_ENABLED) return;
    if (!userReady || !langReady) return;

    const syncNow = async () => {
      if (edit) return;
      await refreshLayoutFromCloud();
      await refreshBackgroundsFromCloud();
    };

    const onFocus = () => {
      syncNow();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    const intervalId = window.setInterval(() => {
      syncNow();
    }, 5000);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userReady, langReady, edit, refreshLayoutFromCloud, refreshBackgroundsFromCloud]);

  // ✅ 보기 모드에서 텍스트 길게 눌러도 선택/터치 콜아웃이 뜨지 않도록 body 단위 차단
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const body = document.body;
    const html = document.documentElement;

    if (!body || !html) return;

    const prevBody = {
      userSelect: body.style.userSelect,
      webkitUserSelect: body.style.webkitUserSelect,
      webkitTouchCallout: body.style.webkitTouchCallout,
    };
    const prevHtml = {
      userSelect: html.style.userSelect,
      webkitUserSelect: html.style.webkitUserSelect,
      webkitTouchCallout: html.style.webkitTouchCallout,
    };

    if (!edit) {
      const applyNoSelect = (el) => {
        el.style.userSelect = 'none';
        el.style.webkitUserSelect = 'none';
        el.style.webkitTouchCallout = 'none';
      };

      applyNoSelect(body);
      applyNoSelect(html);
    } else {
      body.style.userSelect = prevBody.userSelect;
      body.style.webkitUserSelect = prevBody.webkitUserSelect;
      body.style.webkitTouchCallout = prevBody.webkitTouchCallout;

      html.style.userSelect = prevHtml.userSelect;
      html.style.webkitUserSelect = prevHtml.webkitUserSelect;
      html.style.webkitTouchCallout = prevHtml.webkitTouchCallout;
    }

    return () => {
      body.style.userSelect = prevBody.userSelect;
      body.style.webkitUserSelect = prevBody.webkitUserSelect;
      body.style.webkitTouchCallout = prevBody.webkitTouchCallout;

      html.style.userSelect = prevHtml.userSelect;
      html.style.webkitUserSelect = prevHtml.webkitUserSelect;
      html.style.webkitTouchCallout = prevHtml.webkitTouchCallout;
    };
  }, [edit]);

  // ✅ (백업) Shift+E 누르면 edit 버튼 강제 노출 (버튼만, 실제 편집은 PIN 필요)
  useEffect(() => {
    const onKey = (e) => {
      if (edit || preview) return;
      if (e.key?.toLowerCase() === 'e' && e.shiftKey) {
        revealEditButton();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, preview]);

  const applyCachedLanguageView = (cached) => {
    if (!cached) return;

    if (cached?.hasLayoutCache && cached.layout) {
      setLayout(cached.layout);
      try {
        layoutSnapshotRef.current = JSON.stringify(sanitizeLayoutMediaSafe(cached.layout));
      } catch {}
    }

    if (cached?.hasBackgroundCache) {
      setBgRuntimeUrl(getPreparedBackgroundUrl(cached));
      setBgRuntimeOverrideUrls(getPreparedBackgroundOverrideUrls(cached));
      setBgBlob(cached.bgBlob || null);
      setBgOverrides(cached.bgOverrides || {});
      setBgSignedUrl(cached.bgSignedUrl || null);
      setBgOverrideSignedUrls(cached.bgOverrideSignedUrls || {});
      setBgAssetsReady(true);
      setBgResolved(true);
      setBgLoading(false);
    }
  };

  const preloadCachedLanguageVisuals = async (language, cached) => {
    if (!cached) return;

    const backgroundUrls = [];

    try {
      const preparedDefaultBgUrl = getPreparedBackgroundUrl(cached);
      const preparedOverrideUrls = getPreparedBackgroundOverrideUrls(cached);
      if (preparedDefaultBgUrl) backgroundUrls.push(preparedDefaultBgUrl);
      backgroundUrls.push(...Object.values(preparedOverrideUrls || {}).filter(Boolean));

      const menuImageUrls = getAllLayoutImageUrls(cached.layout);
      const [menuStats] = await Promise.all([
        preloadImageUrlsUntilReady(menuImageUrls, 5000, 1),
        preloadImageUrls(backgroundUrls, 1800),
      ]);
      if (imagePreloadStatsComplete(cached.layout, menuStats)) {
        visualsReadyLangsRef.current.add(language);
      }
    } finally {
      // Persistent blob URLs are intentionally reused to avoid a visible background repaint.
    }
  };

  const releaseSwitchingLang = () => {
    if (typeof window === 'undefined') {
      setSwitchingLang(null);
      return;
    }
    window.setTimeout(() => setSwitchingLang(null), 120);
  };

  const setLanguage = async (nextLanguage) => {
    const next = nextLanguage === 'ko' ? 'ko' : 'en';
    if (switchingLang || next === lang) return;

    if (edit) {
      const currentLang = lang === 'ko' ? 'ko' : 'en';
      const draftMap = templateDraftLayoutsRef.current instanceof Map
        ? templateDraftLayoutsRef.current
        : new Map();
      const startSnapshots = editStartLayoutsRef.current instanceof Map
        ? editStartLayoutsRef.current
        : new Map();
      const currentDraft = normalizeLoadedLayout(layout);
      if (isUsableMenuLayout(currentDraft)) {
        draftMap.set(currentLang, currentDraft);
      }

      const targetDraft = draftMap.get(next) || startSnapshots.get(next) || null;
      if (currentDraft?.mode !== 'template') {
        if (!isUsableMenuLayout(targetDraft)) return;
        const targetLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(targetDraft), next);
        draftMap.set(next, targetLayout);
        templateDraftLayoutsRef.current = draftMap;
        setLayout(targetLayout);
        setLang(next);
        setPageIndex(1);
        hardResetScrollTop('auto');
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {}
        return;
      }

      if (targetDraft?.mode === 'custom') {
        const targetLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(targetDraft), next);
        draftMap.set(next, targetLayout);
        templateDraftLayoutsRef.current = draftMap;
        setLayout(targetLayout);
        setLang(next);
        setPageIndex(1);
        hardResetScrollTop('auto');
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {}
        return;
      }

      if (currentDraft?.mode === 'template') {
        const activeTemplateId = getCanonicalTemplateId(currentDraft);
        if (!isPremiumTemplateId(activeTemplateId)) {
          return;
        }
        setSwitchingLang(next);
        setPageIndex(1);
        hardResetScrollTop('auto');

        try {
          const currentLayout = normalizeLoadedLayout(makeTemplateLayout(
            activeTemplateId,
            currentDraft.templateData
          ));
          draftMap.set(currentLang, currentLayout);

          const targetBase =
            targetDraft?.mode === 'template' && targetDraft?.templateId === currentLayout.templateId
              ? targetDraft
              : makeTemplateLayoutForLanguage(currentLayout.templateId, next, currentLayout.templateData);
          const targetLayout = normalizeLoadedLayout(makeTemplateLayout(
            currentLayout.templateId,
            mergePairedTemplateEditData(
              targetBase.templateData || makeInitialTemplateData(currentLayout.templateId, next),
              currentLayout.templateData
            )
          ));

          draftMap.set(next, targetLayout);
          templateDraftLayoutsRef.current = draftMap;
          setLayout(targetLayout);
          setLang(next);
          try {
            localStorage.setItem(LANG_KEY, next);
          } catch {}
        } finally {
          releaseSwitchingLang();
        }
        return;
      }
    }

    const currentLayoutLang = lang === 'ko' ? 'ko' : 'en';
    const syncedTemplateId = pairedTemplateSyncRef.current?.templateId || null;
    const currentLayoutTemplateId = getCanonicalTemplateId(layout);
    const currentLayoutConflictsWithSync =
      syncedTemplateId &&
      layout?.mode === 'template' &&
      currentLayoutTemplateId &&
      currentLayoutTemplateId !== syncedTemplateId;

    if (!currentLayoutConflictsWithSync) {
      rememberLanguageView(currentLayoutLang, {
        layout,
        bgBlob,
        bgOverrides,
        bgSignedUrl,
        bgOverrideSignedUrls,
        hasLayoutCache: true,
        hasFullMediaCache: !layoutNeedsMediaHydration(layout),
        hasBackgroundCache: true,
      });
    }

    if (syncedTemplateId && isPremiumTemplateId(syncedTemplateId)) {
      setSwitchingLang(next);
      setPageIndex(1);
      hardResetScrollTop('auto');

      try {
        const currentCachedLayout = viewCacheRef.current.get(currentLayoutLang)?.layout || null;
        const targetCached = viewCacheRef.current.get(next) || null;
        const targetSavedRaw = await withTimeout(loadLocalJson(menuLayoutKey(next)), 700, null);
        const matchingCurrentSource = [layout, currentCachedLayout]
          .map((candidate) => normalizeLoadedLayout(candidate))
          .find((candidate) => (
            candidate?.mode === 'template' &&
            getCanonicalTemplateId(candidate) === syncedTemplateId
          ));
        const matchingTargetSource = [targetSavedRaw, targetCached?.layout]
          .map((candidate) => normalizeLoadedLayout(candidate))
          .find((candidate) => (
            candidate?.mode === 'template' &&
            getCanonicalTemplateId(candidate) === syncedTemplateId
          ));
        const targetSeed = matchingTargetSource ||
          normalizeLoadedLayout(makeTemplateLayoutForLanguage(
            syncedTemplateId,
            next,
            matchingCurrentSource?.templateData
          ));
        const targetTemplateData = matchingCurrentSource?.templateData
          ? mergePairedTemplateEditData(
              targetSeed.templateData || makeInitialTemplateData(syncedTemplateId, next),
              matchingCurrentSource.templateData
            )
          : (targetSeed.templateData || makeInitialTemplateData(syncedTemplateId, next));
        const targetLayout = normalizeLayoutTextForLanguage(
          normalizeLoadedLayout(makeTemplateLayout(syncedTemplateId, targetTemplateData)),
          next
        );

        rememberLanguageView(next, cacheOptionsForLayout(targetLayout));
        setLayout(targetLayout);
        setLang(next);
        layoutSyncedLangsRef.current.add(next);
        writeWindowReadyView({
          language: next,
          userId,
          layout: targetLayout,
          bgSignedUrl: targetCached?.bgSignedUrl || null,
          bgOverrideSignedUrls: targetCached?.bgOverrideSignedUrls || {},
        });
        saveJson(menuLayoutKey(next), sanitizeLayoutMediaSafe(targetLayout)).catch(() => {});
        writeReadyLayoutBundle(next, targetLayout).catch(() => {});
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {}
      } finally {
        releaseSwitchingLang();
      }
      return;
    }

    const activeViewTemplateId = currentLayoutTemplateId;
    if (layout?.mode === 'template' && isPremiumTemplateId(activeViewTemplateId)) {
      setSwitchingLang(next);
      setPageIndex(1);
      hardResetScrollTop('auto');

      try {
        let targetCustomLayout = null;
        const targetCached = viewCacheRef.current.get(next);
        const pairedTemplateSync = pairedTemplateSyncRef.current;
        const shouldPreferTargetCustom =
          pairedTemplateSync?.templateId !== activeViewTemplateId;
        if (shouldPreferTargetCustom) {
          const rawTargetLayout = await withTimeout(loadLocalJson(menuLayoutKey(next)), 900, null);
          if (rawTargetLayout?.mode === 'custom') {
            targetCustomLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(rawTargetLayout), next);
          } else if (!rawTargetLayout && targetCached?.layout?.mode === 'custom') {
            targetCustomLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(targetCached.layout), next);
          }
        }

        if (targetCustomLayout?.mode === 'custom') {
          let readyCustomLayout = targetCustomLayout;
          if (layoutNeedsMediaHydration(readyCustomLayout)) {
            readyCustomLayout = await withTimeout(
              hydrateLayoutMediaSafe(readyCustomLayout),
              9000,
              readyCustomLayout
            );
            readyCustomLayout = await withTimeout(
              repairLayoutMediaFromFallback(readyCustomLayout, next),
              4000,
              readyCustomLayout
            );
          }

          const nextCustomCache = {
            ...(targetCached || {}),
            layout: readyCustomLayout,
            hasLayoutCache: true,
            hasFullMediaCache: !layoutNeedsMediaHydration(readyCustomLayout),
          };
          rememberLanguageView(next, nextCustomCache);
          applyCachedLanguageView(nextCustomCache);
          if (!nextCustomCache.hasBackgroundCache) {
            setLayout(readyCustomLayout);
            setBgResolved(true);
            setBgLoading(false);
          }
          setLang(next);
          layoutSyncedLangsRef.current.add(next);
          try {
            localStorage.setItem(LANG_KEY, next);
          } catch {}
          return;
        }

        const currentLayout = normalizeLoadedLayout(makeTemplateLayout(
          activeViewTemplateId,
          layout.templateData
        ));
        const targetCachedLayout = viewCacheRef.current.get(next)?.layout;
        const targetBase =
          targetCachedLayout?.mode === 'template' &&
          getCanonicalTemplateId(targetCachedLayout) === currentLayout.templateId
            ? normalizeLoadedLayout(targetCachedLayout)
            : makeTemplateLayoutForLanguage(currentLayout.templateId, next, currentLayout.templateData);
        const targetLayout = normalizeLoadedLayout(makeTemplateLayout(
          currentLayout.templateId,
          mergePairedTemplateEditData(
            targetBase.templateData || makeInitialTemplateData(currentLayout.templateId, next),
            currentLayout.templateData
          )
        ));

        rememberLanguageView(currentLayoutLang, cacheOptionsForLayout(currentLayout));
        rememberLanguageView(next, cacheOptionsForLayout(targetLayout));
        setLayout(targetLayout);
        setLang(next);
        layoutSyncedLangsRef.current.add(next);
        writeWindowReadyView({
          language: next,
          userId,
          layout: targetLayout,
          bgSignedUrl: viewCacheRef.current.get(next)?.bgSignedUrl || null,
          bgOverrideSignedUrls: viewCacheRef.current.get(next)?.bgOverrideSignedUrls || {},
        });
        writeReadyLayoutBundle(next, targetLayout).catch(() => {});
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {}
      } finally {
        releaseSwitchingLang();
      }
      return;
    }

    setSwitchingLang(next);
    setPageIndex(1);
    hardResetScrollTop('auto');
    try {
      let cached = viewCacheRef.current.get(next);
      if (cached?.layout && !layoutMatchesLanguage(cached.layout, next)) {
        cached = null;
        rememberLanguageView(next, {
          layout: null,
          hasLayoutCache: false,
          hasFullMediaCache: false,
        });
      }
      if (
        !cached?.hasLayoutCache ||
        !cached?.hasFullMediaCache ||
        layoutNeedsMediaHydration(cached.layout) ||
        !cached?.hasBackgroundCache
      ) {
        cached = await withTimeout(
          preloadLanguageView(next),
          6500,
          viewCacheRef.current.get(next) || cached || null
        );
      }

      cached = viewCacheRef.current.get(next) || cached;

      if (!isUsableMenuLayout(cached?.layout) || layoutNeedsMediaHydration(cached.layout)) {
        let rawLayout =
          cached?.layout ||
          await withTimeout(loadLocalJson(menuLayoutKey(next)), 1600, null) ||
          null;

        if (rawLayout && !layoutMatchesLanguage(rawLayout, next)) {
          rawLayout = null;
        }

        if (!rawLayout) {
          rawLayout = (await withTimeout(
            syncJsonFromCloud(menuLayoutKey(next), { force: true }),
            7000,
            null
          ))?.data || null;
        }

        if (rawLayout && !layoutMatchesLanguage(rawLayout, next)) {
          rawLayout = null;
        }

        if (isUsableMenuLayout(rawLayout)) {
          let safeLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(rawLayout), next);
          const migrated = await migrateLegacyInlineMediaSafe(safeLayout);
          safeLayout = await withTimeout(hydrateLayoutMediaSafe(migrated.layout), 15000, migrated.layout);
          safeLayout = await withTimeout(repairLayoutMediaFromFallback(safeLayout, next), 5000, safeLayout);
          cached = {
            ...(cached || {}),
            layout: safeLayout,
            hasLayoutCache: true,
            hasFullMediaCache: !layoutNeedsMediaHydration(safeLayout),
          };
          rememberLanguageView(next, cached);
        }
      }

      if (cached?.layout && layoutNeedsMediaHydration(cached.layout)) {
        let hydratedLayout = await withTimeout(hydrateLayoutMediaSafe(cached.layout), 15000, cached.layout);
        hydratedLayout = await withTimeout(repairLayoutMediaFromFallback(hydratedLayout, next), 5000, hydratedLayout);
        cached = {
          ...cached,
          layout: hydratedLayout,
          hasLayoutCache: true,
          hasFullMediaCache: !layoutNeedsMediaHydration(hydratedLayout),
        };
        rememberLanguageView(next, cached);
      }

      if (cached?.layout) {
        const normalizedCachedLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(cached.layout), next);
        if (normalizedCachedLayout !== cached.layout) {
          cached = {
            ...cached,
            layout: normalizedCachedLayout,
            hasLayoutCache: true,
            hasFullMediaCache: !layoutNeedsMediaHydration(normalizedCachedLayout),
          };
          rememberLanguageView(next, cached);
        }
      }

      if (!cached?.hasLayoutCache || !isUsableMenuLayout(cached?.layout)) {
        throw new Error('Language view cache is not ready');
      }

      if (layoutNeedsMediaHydration(cached.layout)) {
        throw new Error('Language media is not ready');
      }

      const hasReadyVisuals =
        visualsReadyLangsRef.current.has(next) &&
        cached?.hasFullMediaCache &&
        !layoutNeedsMediaHydration(cached.layout);

      if (!hasReadyVisuals) {
        await withTimeout(preloadCachedLanguageVisuals(next, cached), 5500, null);
      }

      applyCachedLanguageView(cached);
      if (!cached?.hasBackgroundCache) {
        setLayout(cached.layout);
        try {
          layoutSnapshotRef.current = JSON.stringify(sanitizeLayoutMediaSafe(cached.layout));
        } catch {}
        setBgResolved(true);
        setBgLoading(false);
      }
      layoutSyncedLangsRef.current.add(next);
      writeWindowReadyView({
        language: next,
        userId,
        layout: cached.layout,
        bgBlob: cached.bgBlob || null,
        bgOverrides: cached.bgOverrides || {},
        bgObjectUrl: cached.bgObjectUrl || null,
        bgOverrideObjectUrls: cached.bgOverrideObjectUrls || {},
        bgSignedUrl: cached.bgSignedUrl || null,
        bgOverrideSignedUrls: cached.bgOverrideSignedUrls || {},
      });
      setLang(next);
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {}

      if (hasReadyVisuals) {
        preloadCachedLanguageVisuals(next, cached).catch((error) => {
          console.error('cached language visual refresh failed', error);
        });
      }
    } catch (error) {
      console.error('setLanguage failed', error);
    } finally {
      releaseSwitchingLang();
    }
  };


  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    if (!blob) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const dataUrlToBlob = async (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const res = await fetch(dataUrl);
    return await res.blob();
  };

  const sanitizeLayout = (value) => {
    if (!value || typeof value !== 'object') return DEFAULT_LAYOUT;
    return {
      mode: value.mode ?? null,
      templateId: value.templateId ?? null,
      items: Array.isArray(value.items) ? value.items : [],
      templateData: value.templateData ?? null,
      pageCount: Math.max(1, Number(value.pageCount || 1)),
    };
  };

  const openBackupImportPicker = () => backupImportInputRef.current?.click();

  const exportBackupFile = async () => {
    try {
      const backupLayout = sanitizeLayoutMediaSafe(sanitizeLayout(layout));

      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        language: lang,
        layout: backupLayout,
        backgrounds: {
          default: bgBlob ? await blobToDataUrl(bgBlob) : null,
          pages: Object.fromEntries(
            await Promise.all(
              Object.entries(bgOverrides || {}).map(async ([page, blob]) => [page, await blobToDataUrl(blob)])
            )
          ),
        },
      };

      const fileName = `menu-backup-${payload.language}-${payload.exportedAt.slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.alert(T.backupExportDone);
    } catch (error) {
      console.error(error);
      window.alert(T.backupExportFail);
    }
  };

  const importBackupFile = async (file) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const targetLang = parsed?.language === 'ko' || parsed?.language === 'en' ? parsed.language : lang;

      let importedLayout = normalizeLayoutTextForLanguage(normalizeLoadedLayout(sanitizeLayout(parsed?.layout)), targetLang);
      const backgroundPages = parsed?.backgrounds?.pages && typeof parsed.backgrounds.pages === 'object'
        ? parsed.backgrounds.pages
        : {};
      const highestImportedBgPage = Math.max(1, ...Object.keys(backgroundPages).map((key) => Number(key) || 1));
      importedLayout.pageCount = Math.max(1, Number(importedLayout.pageCount || 1), highestImportedBgPage);

      const migratedImported = await migrateLegacyInlineMediaSafe(importedLayout);
      const hydratedImported = await hydrateLayoutMediaSafe(migratedImported.layout);
      const persistedImported = sanitizeLayoutMediaSafe(hydratedImported);
      const nextBgBlob = await dataUrlToBlob(parsed?.backgrounds?.default || null);

      const existingIndex = (await loadLocalJson(bgOverridesKey(targetLang))) || {};
      for (const page of Object.keys(existingIndex)) {
        if (!(page in backgroundPages)) {
          await removeKey(bgPageKey(page, targetLang));
        }
      }

      if (nextBgBlob) {
        await saveBlob(menuBgKey(targetLang), nextBgBlob);
      } else {
        await removeKey(menuBgKey(targetLang));
      }

      const nextOverrideIndex = {};
      const nextOverrideBlobs = {};
      for (const [page, dataUrl] of Object.entries(backgroundPages)) {
        const blob = await dataUrlToBlob(dataUrl);
        if (!blob) continue;
        nextOverrideBlobs[page] = blob;
        nextOverrideIndex[page] = true;
        await saveBlob(bgPageKey(page, targetLang), blob);
      }

      await saveJson(bgOverridesKey(targetLang), nextOverrideIndex);
      await saveJson(menuLayoutKey(targetLang), persistedImported);

      if (targetLang === lang) {
        setLayout(hydratedImported);
        setBgRuntimeUrl(getReusableBlobObjectUrl(nextBgBlob));
        setBgRuntimeOverrideUrls(getPreparedBackgroundOverrideUrls({ bgOverrides: nextOverrideBlobs }));
        setBgBlob(nextBgBlob);
        setBgOverrides(nextOverrideBlobs);
        setBgSignedUrl(null);
        setBgOverrideSignedUrls({});
        setBgAssetsReady(true);
        setBgLoading(false);
      } else {
        setLang(targetLang);
        try { localStorage.setItem(LANG_KEY, targetLang); } catch {}
      }

      setPageIndex(1);
      setPreview(false);
      setEdit(false);
      setTimeout(() => hardResetScrollTop('auto'), 0);
      window.alert(T.backupImportDone);
    } catch (error) {
      console.error(error);
      window.alert(T.backupImportFail);
    }
  };

  // ✅ 영상으로 돌아가기
  const goIntro = (event) => {
    event?.preventDefault();
    router.push('/intro');
    window.setTimeout(() => {
      if (window.location.pathname !== '/intro') window.location.assign('/intro');
    }, 500);
  };

  // ✅ 로그아웃 처리
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    clearCurrentUser();
    router.replace('/login');
  };

  // ✅ 기본 배경 URL
  const bgObjectUrl = useMemo(() => {
    if (!isBlobLike(bgBlob)) return null;
    return getReusableBlobObjectUrl(bgBlob);
  }, [bgBlob]);
  const bgUrl = bgRuntimeUrl || bgObjectUrl || bgSignedUrl || null;

  const clearOnboardingUrl = useCallback(() => {
    try {
      if (window.location.search.includes('onboarding=')) {
        window.history.replaceState(null, '', '/menu');
      }
    } catch {
      // ignore URL cleanup failures
    }
  }, []);

  const beginFreeLayoutEdit = useCallback(() => {
    const next = normalizeLoadedLayout({ ...DEFAULT_LAYOUT, mode: 'custom', templateId: null, templateData: null, items: [], pageCount: 1 });
    const currentLang = lang === 'ko' ? 'ko' : 'en';
    const draftMap = templateDraftLayoutsRef.current instanceof Map
      ? templateDraftLayoutsRef.current
      : new Map();
    draftMap.set(currentLang, next);
    templateDraftLayoutsRef.current = draftMap;
    setLayout(next);
    setEdit(true);
    setPreview(false);
    setFreeLayoutOnboarding(false);
    setToolsVisible(false);
    setShowEditorMenu(false);
    setPageIndex(1);
    clearOnboardingUrl();
    setTimeout(() => hardResetScrollTop('auto'), 0);
  }, [clearOnboardingUrl, lang, normalizeLoadedLayout]);

  const startFreeLayoutOnboarding = useCallback(() => {
    setEditModeModalOpen(false);
    setPreview(false);
    setToolsVisible(false);
    setShowEditorMenu(false);
    if (bgUrl) {
      beginFreeLayoutEdit();
      return;
    }
    setEdit(false);
    setLayout(DEFAULT_LAYOUT);
    setFreeLayoutOnboarding(true);
    clearOnboardingUrl();
    setPageIndex(1);
    setTimeout(() => hardResetScrollTop('auto'), 0);
  }, [beginFreeLayoutEdit, bgUrl, clearOnboardingUrl]);

  const startTemplateOnboarding = useCallback(async (fullId) => {
    setEditModeModalOpen(false);
    await applyPairedTemplate(fullId);
    setEdit(true);
    setPreview(false);
    setFreeLayoutOnboarding(false);
    setTplPanelOpen(true);
    setToolsVisible(false);
    setShowEditorMenu(false);
    setPageIndex(1);
    clearOnboardingUrl();
    setTimeout(() => hardResetScrollTop('auto'), 0);
  }, [applyPairedTemplate, clearOnboardingUrl]);

  // ✅ 페이지별 배경 URL map
  const bgObjectOverrideUrls = useMemo(() => {
    const map = {};
    for (const [k, blob] of Object.entries(bgOverrides || {})) {
      if (isBlobLike(blob)) map[k] = getReusableBlobObjectUrl(blob);
    }
    return map;
  }, [bgOverrides]);
  const bgOverrideUrls = useMemo(
    () => ({
      ...(bgOverrideSignedUrls || {}),
      ...(bgObjectOverrideUrls || {}),
      ...(bgRuntimeOverrideUrls || {}),
    }),
    [bgObjectOverrideUrls, bgOverrideSignedUrls, bgRuntimeOverrideUrls]
  );

  // ✅ URL revoke cleanup
  useEffect(() => {
    return () => {};
  }, []);

  // ✅ 배경 이미지 로드 완료까지 대기(초기 표시용 현재 페이지만 선로딩)
  useEffect(() => {
    if (!bgUrl) {
      setBgAssetsReady(false);
      return;
    }

    let cancelled = false;
    const currentPageBgUrl =
      bgOverrideUrls?.[String(pageIndex)] ||
      bgOverrideUrls?.[pageIndex] ||
      bgUrl;
    const urls = [currentPageBgUrl].filter(Boolean);

    setBgAssetsReady(false);
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) setBgAssetsReady(true);
    }, 1800);

    Promise.all(
      urls.map(
        (url) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = resolve;
            img.src = url;
          })
      )
    ).then(() => {
      if (!cancelled) {
        window.clearTimeout(fallbackTimer);
        setBgAssetsReady(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [bgUrl, bgOverrideUrls, pageIndex]);

  useEffect(() => {
    if (!userReady || !langReady) return;
    if (initialLanguageWarmupReady) return;
    if (!isUsableMenuLayout(layout)) {
      if (!loading && (bgResolved || readyBundleLookup.checked)) {
        setInitialLanguageWarmupReady(true);
      }
      return;
    }

    let cancelled = false;
    (async () => {
      await withTimeout(preloadLanguageView(lang === 'en' ? 'ko' : 'en'), 10000, null);
      if (!cancelled) setInitialLanguageWarmupReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    userReady,
    langReady,
    lang,
    layout,
    loading,
    bgResolved,
    readyBundleLookup.checked,
    initialLanguageWarmupReady,
    preloadLanguageView,
  ]);

  useEffect(() => {
    if (hasInitialView) return;
    const hasMenuLayout = isUsableMenuLayout(layout);
    const imageCount = hasMenuLayout ? getAllLayoutImageUrls(layout).length : 0;
    const mediaHydrated = hasMenuLayout && !layoutNeedsMediaHydration(layout);
    const imagesReady = imageCount === 0 || visualsReadyLangsRef.current.has(lang);
    const customBackgroundReady =
      !hasMenuLayout ||
      layout?.mode !== 'custom' ||
      (bgResolved && (!bgUrl || bgAssetsReady));
    const readyToShowMenu =
      hasMenuLayout &&
      mediaHydrated &&
      customBackgroundReady &&
      (imagesReady || imageCount > 0);

    if (!loading && readyToShowMenu) {
      setHasInitialView(true);
    }
  }, [
    hasInitialView,
    loading,
    layout,
    lang,
    bgResolved,
    bgUrl,
    bgAssetsReady,
    readyBundleLookup.checked,
    visualsReadySignal,
  ]);

  useEffect(() => {
    if (!hasInitialView || !userReady || !langReady) return;
    preloadLanguageView(lang === 'en' ? 'ko' : 'en');
  }, [hasInitialView, userReady, langReady, lang, preloadLanguageView]);

  useEffect(() => {
    if (!hasInitialView || !userReady || !langReady) return;
    if (!isUsableMenuLayout(layout) || layoutNeedsMediaHydration(layout)) return;

    writeWindowReadyView({
      language: lang,
      userId,
      layout,
      bgBlob: bgBlob || null,
      bgOverrides: bgOverrides || {},
      bgObjectUrl: bgRuntimeUrl || null,
      bgOverrideObjectUrls: bgRuntimeOverrideUrls || {},
      bgSignedUrl: bgSignedUrl || null,
      bgOverrideSignedUrls: bgOverrideSignedUrls || {},
    });
  }, [hasInitialView, userReady, userId, langReady, lang, layout, bgBlob, bgOverrides, bgRuntimeUrl, bgRuntimeOverrideUrls, bgSignedUrl, bgOverrideSignedUrls]);

  useEffect(() => {
    if (!hasInitialView || !layout?.items?.length) return;

    const pageCount = Math.max(1, Number(layout.pageCount || 1));
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
    const urls = Array.from(new Set(
      pages.flatMap((page) => getLayoutImageUrlsForPage(layout, page))
    ));
    if (!urls.length) return;

    const requestKey = `${lang}:${urls.join('|')}`;
    if (backgroundImagePreloadRequestsRef.current.has(requestKey)) return;
    backgroundImagePreloadRequestsRef.current.add(requestKey);

    const timer = window.setTimeout(() => {
      preloadImageUrls(urls, 8000).then((stats) => {
        if (imagePreloadStatsComplete(layout, stats)) {
          visualsReadyLangsRef.current.add(lang);
          setVisualsReadySignal((value) => value + 1);
          const writeKey = `${lang}:${userId || 'user'}:${stats.total}:${layout.items?.length || 0}:${bgSignedUrl || ''}:${Object.keys(bgOverrideSignedUrls || {}).join(',')}`;
          if (!readyBundleWriteKeysRef.current.has(writeKey)) {
            readyBundleWriteKeysRef.current.add(writeKey);
            writeWindowReadyView({
              language: lang,
              userId,
              layout,
              bgBlob: bgBlob || null,
              bgOverrides: bgOverrides || {},
              bgObjectUrl: bgRuntimeUrl || null,
              bgOverrideObjectUrls: bgRuntimeOverrideUrls || {},
              bgSignedUrl: bgSignedUrl || null,
              bgOverrideSignedUrls: bgOverrideSignedUrls || {},
            });
            writeMenuReadyBundleAsync({
              language: lang,
              userId,
              layout,
              bgSignedUrl: bgSignedUrl || null,
              bgOverrideSignedUrls: bgOverrideSignedUrls || {},
              imagePreloadStats: stats,
            }).catch((error) => {
              console.error('write menu ready bundle failed', error);
            });
          }
        }
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [hasInitialView, lang, userId, layout, bgSignedUrl, bgOverrideSignedUrls]);

  // 초기 화면이 열리기 전에는 첫 페이지 위치를 맞추고, 이후 사용자 페이지 이동은 유지한다.
  useEffect(() => {
    if (!bgUrl || hasInitialView) return;
    setTimeout(() => hardResetScrollTop('auto'), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgUrl, hasInitialView]);

  const uploadAssetToCloud = async (file, assetKey, successMessage = '클라우드 업로드 완료!') => {
    setAssetUploading(true);
    setAssetUploadMessage('스토리지에 업로드 중...');

    try {
      await saveBlob(assetKey, file);
      setAssetUploadMessage(successMessage);
      return assetKey;
    } catch (error) {
      setAssetUploadMessage(error.message || '업로드 중 문제가 발생했습니다.');
      throw error;
    } finally {
      setAssetUploading(false);
    }
  };

  const uploadBg = async (file) => {
    if (!file) return;
    try {
      await uploadAssetToCloud(file, menuBgKey(lang));
    } catch (e) {
      console.error(e);
    }

    setBgRuntimeUrl(getReusableBlobObjectUrl(file));
    setBgRuntimeOverrideUrls({});
    setBgBlob(file);
    setBgSignedUrl(null);
    setBgResolved(true);
    setBgAssetsReady(true);

    // ✅ "배경(전체) 선택"은 페이지별 override보다 우선해서 전체 페이지에 바로 반영
    setBgOverrides({});
    setBgOverrideSignedUrls({});
    try {
      await saveJson(bgOverridesKey(lang), {});
    } catch (e) {
      console.error(e);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (freeLayoutOnboarding) {
      beginFreeLayoutEdit();
      return;
    }

    // ✅ 업로드 즉시 맨위로
    setTimeout(() => hardResetScrollTop('auto'), 0);
  };

  // ✅ 인트로 비디오 업로드
  const uploadIntroVideo = async (file) => {
    if (!file) return;

    try {
      await uploadAssetToCloud(
        file,
        KEYS.INTRO_VIDEO,
        lang === 'ko' ? '인트로 영상이 변경되었습니다.' : 'Intro video has been updated.'
      );
    } catch (e) {
      console.error(e);
    }

    if (introVideoInputRef.current) {
      introVideoInputRef.current.value = '';
    }
  };

  // ✅ 페이지 배경 업로드(현재 pageIndex)
  const uploadPageBg = async (file, pageNum) => {
    const p = Number(pageNum);
    if (!file || !Number.isFinite(p) || p < 1) return;

    try {
      await uploadAssetToCloud(file, bgPageKey(p, lang));
    } catch (e) {
      console.error(e);
    }

    setBgRuntimeOverrideUrls((prev) => ({ ...(prev || {}), [p]: getReusableBlobObjectUrl(file) }));
    setBgOverrides((prev) => ({ ...(prev || {}), [p]: file }));
    setBgOverrideSignedUrls((prev) => {
      const next = { ...(prev || {}) };
      delete next[p];
      delete next[String(p)];
      return next;
    });

    // overrides 인덱스 저장
    try {
      const idxKey = bgOverridesKey(lang);
      const nextIndex = { ...(await loadLocalJson(idxKey)) };
      nextIndex[p] = true;
      await saveJson(bgOverridesKey(lang), nextIndex);
    } catch {
      try {
        await saveJson(bgOverridesKey(lang), { [p]: true });
      } catch {}
    }
  };

  // ✅ 페이지 배경 오버라이드 해제(기본 배경으로 돌아감)
  const clearPageBgOverride = async (pageNum) => {
    const p = Number(pageNum);
    if (!Number.isFinite(p) || p < 1) return;

    setBgRuntimeOverrideUrls((prev) => {
      const next = { ...(prev || {}) };
      delete next[p];
      delete next[String(p)];
      return next;
    });
    setBgOverrides((prev) => {
      const next = { ...(prev || {}) };
      delete next[p];
      return next;
    });
    setBgOverrideSignedUrls((prev) => {
      const next = { ...(prev || {}) };
      delete next[p];
      delete next[String(p)];
      return next;
    });

    try {
      const idx = (await loadLocalJson(bgOverridesKey(lang))) || {};
      const nextIdx = { ...(idx || {}) };
      delete nextIdx[p];
      await saveJson(bgOverridesKey(lang), nextIdx);
    } catch {}
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadBg(file);
  };

  const openFilePicker = () => fileInputRef.current?.click();
  const openIntroVideoPicker = () => introVideoInputRef.current?.click();
  const openPageBgPicker = () => pageBgInputRef.current?.click();

  // ✅ 타이머 정리 + 보기모드에서 수정 버튼 숨김
  const hideEditButton = () => {
    if (autoHideRef.current) {
      clearTimeout(autoHideRef.current);
      autoHideRef.current = null;
    }
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    setShowEditBtn(false);
  };

  // ✅ 수정 버튼을 “보여주기”
  const revealEditButton = () => {
    if (edit) return;

    setShowEditBtn(true);

    if (autoHideRef.current) clearTimeout(autoHideRef.current);
    autoHideRef.current = setTimeout(() => {
      if (!edit) setShowEditBtn(false);
    }, AUTO_HIDE_MS);
  };

  // ✅ 5번 클릭 감지
  const onSecretCornerClick = () => {
    if (edit) return;

    if (!tapTimerRef.current) {
      tapTimerRef.current = setTimeout(() => {
        tapCountRef.current = 0;
        tapTimerRef.current = null;
      }, TAP_WINDOW_MS);
    }

    tapCountRef.current += 1;

    if (tapCountRef.current >= SECRET_TAPS) {
      revealEditButton();
      tapCountRef.current = 0;
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
  };

  // ✅ 길게 누르기 (3초)
  const startLongPress = (e) => {
    if (edit) return;
    if (String(e?.type || '').startsWith('touch')) {
      e.preventDefault();
    }

    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      revealEditButton();
      longPressRef.current = null;
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  // ✅ cleanup
  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
      if (longPressRef.current) clearTimeout(longPressRef.current);
      if (templateNoticeTimerRef.current) clearTimeout(templateNoticeTimerRef.current);
    };
  }, []);

  // ✅ “수정” 클릭 시: 비번 확인 후 edit 진입
  const requestEdit = () => {
    if (edit) return;
    setPinError('');
    setPinInput('');
    setPinModalOpen(true);
  };

  const submitPin = async () => {
    if (!(pinInput || '').trim()) {
      setPinError(lang === 'ko' ? '비밀번호를 입력해 주세요.' : 'Please enter your PIN.');
      return;
    }
    if ((pinInput || '').trim() === pin) {
      const currentLang = lang === 'ko' ? 'ko' : 'en';
      const otherLang = currentLang === 'ko' ? 'en' : 'ko';
      const currentSnapshot = cloneLayoutForCancel(layout);
      const startSnapshots = new Map();

      if (currentSnapshot) {
        startSnapshots.set(currentLang, currentSnapshot);
      }

      try {
        const otherCached = viewCacheRef.current.get(otherLang)?.layout || null;
        const otherRaw = otherCached || await withTimeout(loadLocalJson(menuLayoutKey(otherLang)), 900, null);
        if (isUsableMenuLayout(otherRaw)) {
          const otherSnapshot = cloneLayoutForCancel(
            normalizeLayoutTextForLanguage(normalizeLoadedLayout(otherRaw), otherLang)
          );
          if (otherSnapshot) startSnapshots.set(otherLang, otherSnapshot);
        }
      } catch {}

      editStartLayoutRef.current = currentSnapshot;
      editStartLayoutsRef.current = startSnapshots;
      editStartLangRef.current = currentLang;
      editStartTemplateSyncRef.current = pairedTemplateSyncRef.current
        ? { ...pairedTemplateSyncRef.current }
        : null;
      templateDraftLayoutsRef.current = new Map();
      setPinModalOpen(false);
      setEdit(true);
      setPreview(false);
      setToolsVisible(false);
      setPinInput('');
      setPinError('');
      // ✅ edit 진입 시 스크롤 맨위로
      setTimeout(() => hardResetScrollTop('auto'), 0);
      return;
    }
    setPinError(lang === 'ko' ? '비밀번호가 올바르지 않습니다.' : 'Incorrect PIN.');
  };

  // ✅ 비밀번호 변경
  const submitChangePin = () => {
    setSettingsError('');
    setSettingsMsg('');

    if ((curPinInput || '').trim() !== pin) {
      setSettingsError(lang === 'ko' ? '현재 비밀번호가 올바르지 않습니다.' : 'Current PIN is incorrect.');
      return;
    }
    const np = (newPinInput || '').trim();
    const cp = (newPinConfirm || '').trim();

    if (!/^\d{4}$/.test(np)) {
      setSettingsError(
        lang === 'ko'
          ? '새 비밀번호는 숫자 4자리(예: 1234)로 입력해 주세요.'
          : 'New PIN must be exactly 4 digits (e.g., 1234).'
      );
      return;
    }
    if (np !== cp) {
      setSettingsError(lang === 'ko' ? '새 비밀번호 확인이 일치하지 않습니다.' : 'New PIN confirmation does not match.');
      return;
    }

    try {
      localStorage.setItem(pinStorageKey, np);
    } catch {}
    setPin(np);
    setSettingsMsg(lang === 'ko' ? '비밀번호가 변경되었습니다.' : 'PIN has been updated.');
    setCurPinInput('');
    setNewPinInput('');
    setNewPinConfirm('');
  };

  const T = {
    ko: {
      pickBgTitle: '백그라운드를 업로드하세요',
      pickBgDesc1: '자유 배치 메뉴판에 사용할 ',
      pickBgDesc2: '배경 이미지',
      pickBgDesc3: '를 먼저 넣어주세요.',
      pickBgDesc4: '업로드하면 바로 편집 화면으로 넘어갑니다.',
      drop1: '배경 이미지 업로드',
      drop2: '파일 선택',
      drop3: '',
      hint: '권장: JPG/PNG · 태블릿 세로 화면에 맞는 메뉴판 이미지',
      keep: '자유 배치도에서만 필요한 단계입니다. 템플릿은 자체 배경을 사용합니다.',
      logout: '로그아웃',
      edit: '수정',
      changeBg: '배경(전체) 선택',
      templateBgNotAvailable: '템플릿 모드에서는 배경을 따로 변경할 수 없습니다. 템플릿 자체 디자인 배경이 적용됩니다. 배경을 직접 바꾸려면 편집 방식 변경에서 자유 배치로 바꿔 주세요.',
      introVideo: '인트로 비디오 변경',
      pageBg: '페이지 배경',
      pinSettings: '비밀번호 설정',
      editorMenu: '관리',
      pinEnterTitle: '비밀번호 입력',
      pinEnterDesc: '수정하려면 비밀번호(기본 0000)를 입력하세요.',
      confirm: '확인',
      cancel: '취소',
      close: '닫기',
      pinChange: '비밀번호 변경',
      curPin: '현재 비밀번호',
      newPin: '새 비밀번호(4자리 숫자)',
      newPin2: '새 비밀번호 확인',
      change: '변경',
      help: '우측 상단 모서리를 5번 클릭하거나 3초 길게 누르면 수정 버튼이 나타납니다. (5초 후 자동으로 숨김)\n*백업: Shift+E',
      backToVideo: '인트로',
      editModePick: '수정 방식 선택',
      freeEdit: '자유 배치로 편집하기',
      templateBadge: '템플릿 모드: ',
      changeMode: '편집 방식 변경',

      pageView: '페이지 보기',
      continuous: '연속 보기',
      page: '페이지',
      prev: '이전',
      next: '다음',
      jump: '이동',

      preview: '미리보기',
      save: '저장',
      back: '뒤로가기',

      showTplPanel: '템플릿 입력 열기',

      // page bg modal
      pageBgTitle: '페이지별 배경 설정',
      currentPage: '현재 페이지',
      uploadThis: '이 페이지 배경 업로드',
      clearThis: '이 페이지 배경 해제(기본으로)',
      usingOverride: '이 페이지는 오버라이드 배경 사용 중',
      usingDefault: '이 페이지는 기본 배경 사용 중',
      backupExport: '백업 파일 저장',
      backupImport: '백업 파일 불러오기',
      backupExportDone: '백업 파일을 저장했습니다.',
      backupExportFail: '백업 파일 저장 중 문제가 발생했습니다.',
      backupImportDone: '백업 파일을 불러왔습니다.',
      backupImportFail: '백업 파일을 불러오지 못했습니다.',
    },
    en: {
      pickBgTitle: 'Upload a menu background',
      pickBgDesc1: 'Add the ',
      pickBgDesc2: 'background image',
      pickBgDesc3: ' for your free-layout board first.',
      pickBgDesc4: 'After upload, the editor opens automatically.',
      drop1: 'Upload background image',
      drop2: 'Choose file',
      drop3: '',
      hint: 'Recommended: JPG/PNG · portrait tablet menu artwork',
      keep: 'This step is only for Free Layout. Templates use their own designed background.',
      logout: 'Log out',
      edit: 'Edit',
      changeBg: 'Background (All Pages)',
      templateBgNotAvailable: 'Background editing is not available in template mode. Templates use their own designed background. Switch to Free Layout if you need a custom background.',
      introVideo: 'Change intro video',
      pageBg: 'Page Background',
      pinSettings: 'PIN Settings',
      editorMenu: 'Manage',
      pinEnterTitle: 'Enter PIN',
      pinEnterDesc: 'Enter your PIN (default 0000) to edit.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      close: 'Close',
      pinChange: 'Change PIN',
      curPin: 'Current PIN',
      newPin: 'New PIN (4 digits)',
      newPin2: 'Confirm New PIN',
      change: 'Update',
      help: 'Tap the top-right corner 5 times or press & hold for 3 seconds to reveal the Edit button. (Auto hides in 5s)\n*Backup: Shift+E',
      backToVideo: 'Intro',
      editModePick: 'Choose edit mode',
      freeEdit: 'Edit with Free Layout',
      templateBadge: 'Template Mode: ',
      changeMode: 'Change Edit Mode',

      pageView: 'Page View',
      continuous: 'Continuous',
      page: 'Page',
      prev: 'Prev',
      next: 'Next',
      jump: 'Go',

      preview: 'Preview',
      save: 'Save',
      back: 'Back',

      showTplPanel: 'Show Template Input',

      pageBgTitle: 'Per-page Background',
      currentPage: 'Current page',
      uploadThis: 'Upload background for this page',
      clearThis: 'Clear this page override (use default)',
      usingOverride: 'This page is using an override background',
      usingDefault: 'This page is using the default background',
      backupExport: 'Save Backup File',
      backupImport: 'Load Backup File',
      backupExportDone: 'Backup file saved.',
      backupExportFail: 'Failed to save backup file.',
      backupImportDone: 'Backup file restored.',
      backupImportFail: 'Could not restore the backup file.',
    },
  }[lang];

  const isOverlayOpen = pinModalOpen || settingsOpen || editModeModalOpen || pageBgModalOpen;

  const notifyTemplateBackgroundLocked = useCallback(() => {
    setShowEditorMenu(false);
    setTemplateNotice(T.templateBgNotAvailable);
    if (templateNoticeTimerRef.current) clearTimeout(templateNoticeTimerRef.current);
    templateNoticeTimerRef.current = window.setTimeout(() => {
      setTemplateNotice('');
      templateNoticeTimerRef.current = null;
    }, 3400);
  }, [T.templateBgNotAvailable]);

  const openPageBackgroundFromManage = useCallback(() => {
    if (layout.mode === 'template') {
      notifyTemplateBackgroundLocked();
      return;
    }
    setPageBgModalOpen(true);
  }, [layout.mode, notifyTemplateBackgroundLocked]);

  const openAllPagesBackgroundFromManage = useCallback(() => {
    if (layout.mode === 'template') {
      notifyTemplateBackgroundLocked();
      return;
    }
    openFilePicker();
  }, [layout.mode, notifyTemplateBackgroundLocked, openFilePicker]);

  const handleToolsVisibleChange = (visible) => {
    setToolsVisible(!!visible);
    if (visible) setShowEditorMenu(false);
  };

  useEffect(() => {
    if (!edit || preview || isOverlayOpen) {
      setShowEditorMenu(false);
      setToolsVisible(false);
    }
  }, [edit, preview, isOverlayOpen]);

  // ✅ 페이지 계산
  const computedPages = useMemo(() => {
    // ---------- TEMPLATE MODE ----------
    if (layout?.mode === 'template') {
      const tid = layout?.templateId || '';
      const td = normalizeTemplateDataForMeasure(tid, layout?.templateData, lang);

      const isEmpty = tid.startsWith('T1')
        ? (td?.rows?.length ?? 0) === 0
        : tid.startsWith('T2')
        ? (td?.rows?.length ?? 0) === 0
        : (td?.cells?.length ?? 0) === 0;

      if (isEmpty) return 1;

      const pages = computeTemplatePages(tid, layout?.templateData, lang);
      return Math.max(1, pages);
    }

    // ---------- CUSTOM MODE ----------
    const items = Array.isArray(layout?.items) ? layout.items : [];
    if (items.length === 0) return 1;

    let maxBottom = 0;
    for (const it of items) {
      const b = Number(it?.y || 0) + Number(it?.h || 0);
      if (b > maxBottom) maxBottom = b;
    }

    const unit = PAGE_HEIGHT + PAGE_GAP;
    const occupiedBottom = Math.max(1, Math.ceil(maxBottom));
    const pages = Math.max(1, Math.floor(Math.max(0, occupiedBottom - 1) / unit) + 1);
    return pages;
  }, [layout, lang]);

  const highestBgOverridePage = useMemo(() => {
    const keys = Object.keys(bgOverrides || {});
    if (!keys.length) return 1;
    return Math.max(1, ...keys.map((key) => Number(key) || 1));
  }, [bgOverrides]);

  const premiumThreePageTemplate = layout?.mode === 'template' && ['T1A', 'T2A', 'T3A'].includes(layout?.templateId || '');
  const totalPages = useMemo(
    () => (premiumThreePageTemplate ? Math.max(1, Number(computedPages || 1)) : Math.max(1, Number(computedPages || 1), highestBgOverridePage)),
    [computedPages, highestBgOverridePage, premiumThreePageTemplate]
  );
  const preloadSinkUrls = useMemo(() => getAllLayoutImageUrls(layout), [layout]);

  // ✅ 컨텐츠 높이
  const contentHeight = useMemo(() => {
    const pages = Math.max(1, Number(totalPages || 1));
    const base = pages * PAGE_HEIGHT + (pages - 1) * PAGE_GAP;

    return Math.max(MIN_CONTENT_HEIGHT, base);
  }, [totalPages]);

  const fullScrollHeight = useMemo(() => contentHeight, [contentHeight]);

  // ✅ 보기모드에서만: 세로 스크롤 대신 페이지 단위 가로 스냅 활성화
  const pageTurnEnabled = useMemo(() => {
    return !edit && !preview;
  }, [edit, preview]);

  const editPageTurnEnabled = useMemo(() => {
    return edit && !preview && (layout.mode === 'custom' || layout.mode === 'template');
  }, [edit, layout.mode, preview]);

  const horizontalPageTurnEnabled = pageTurnEnabled || editPageTurnEnabled;

  // ✅ 보기모드 스케일: 손님용 메뉴 화면은 세로 화면을 채우되 crop 없이 높이는 맞춤
  const viewScaleY = useMemo(() => {
    const viewportHeight = Math.max(320, Number(vh) || PAGE_HEIGHT);
    const verticalGutter = layout.mode === 'template' && !edit && !preview
      ? TEMPLATE_VIEW_GUTTER_Y
      : VIEW_GUTTER_Y;
    const fitByHeight = Math.max(0.01, (viewportHeight - verticalGutter * 2) / PAGE_HEIGHT);

    return Math.max(MIN_VIEW_SCALE, fitByHeight);
  }, [edit, layout.mode, preview, vh]);

  const viewScaleX = useMemo(() => {
    const viewportWidth = Math.max(320, Number(vw) || PAGE_WIDTH);
    const fitByWidth = Math.max(0.01, (viewportWidth - VIEW_GUTTER_X * 2) / PAGE_WIDTH);

    return Math.max(MIN_VIEW_SCALE, fitByWidth);
  }, [vw]);

  const isScaledCustomEdit = edit && !preview && (layout.mode === 'custom' || layout.mode === 'template');

  const isWideEditViewport = useMemo(() => {
    const viewportWidth = Math.max(320, Number(vw) || PAGE_WIDTH);
    const viewportHeight = Math.max(480, Number(vh) || PAGE_HEIGHT);
    return isScaledCustomEdit && viewportWidth >= 1100 && viewportWidth > viewportHeight * 1.12;
  }, [isScaledCustomEdit, vh, vw]);

  const editSidePanelOpen = edit && !preview && (toolsVisible || (layout.mode === 'template' && tplPanelOpen));

  const editCanvasScale = useMemo(() => {
    if (!isScaledCustomEdit) return 1;
    const viewportWidth = Math.max(320, Number(vw) || PAGE_WIDTH);
    const viewportHeight = Math.max(480, Number(vh) || PAGE_HEIGHT);
    const isWideDesktop = viewportWidth >= 1100 && viewportWidth > viewportHeight * 1.12;

    if (isWideDesktop) {
      const reservedSideSpace = editSidePanelOpen ? 620 : 260;
      const fitByWorkspaceWidth = Math.max(0.5, (viewportWidth - reservedSideSpace) / PAGE_WIDTH);
      const comfortableHeight = Math.max(0.5, viewportHeight / PAGE_HEIGHT);
      return Math.min(0.72, Math.max(comfortableHeight, fitByWorkspaceWidth));
    }

    const fitByWidth = Math.max(0.32, (viewportWidth - 32) / PAGE_WIDTH);
    const fitByHeight = Math.max(0.32, (viewportHeight - 156) / PAGE_HEIGHT);

    return Math.min(1, fitByWidth, fitByHeight);
  }, [editSidePanelOpen, isScaledCustomEdit, vh, vw]);

  const editCanvasScaleX = useMemo(() => {
    if (!isScaledCustomEdit) return 1;
    if (isWideEditViewport) return editCanvasScale;
    const viewportWidth = Math.max(320, Number(vw) || PAGE_WIDTH);
    return Math.max(0.32, viewportWidth / PAGE_WIDTH);
  }, [editCanvasScale, isScaledCustomEdit, isWideEditViewport, vw]);

  const editCanvasScaleY = useMemo(() => {
    if (!isScaledCustomEdit) return 1;
    if (isWideEditViewport) return editCanvasScale;
    const viewportHeight = Math.max(480, Number(vh) || PAGE_HEIGHT);
    return Math.max(0.32, (viewportHeight - EDIT_ACTION_BAR_SPACE) / PAGE_HEIGHT);
  }, [editCanvasScale, isScaledCustomEdit, isWideEditViewport, vh]);

  const effectiveScaleY = useMemo(() => {
    if (edit || preview) return 1;
    return viewScaleY;
  }, [edit, preview, viewScaleY]);

  const effectiveScaleX = useMemo(() => {
    if (edit || preview) return 1;
    return viewScaleX;
  }, [edit, preview, viewScaleX]);

  const effectiveScale = effectiveScaleY;

  const viewPageWidthScaled = useMemo(() => PAGE_WIDTH * effectiveScaleX, [effectiveScaleX]);

  const viewPageHeightScaled = useMemo(() => PAGE_HEIGHT * effectiveScaleY, [effectiveScaleY]);

  const stageContentScaleX = isScaledCustomEdit ? editCanvasScaleX : 1;
  const stageContentScaleY = isScaledCustomEdit ? editCanvasScaleY : 1;
  const stageContentWidth = isScaledCustomEdit
    ? PAGE_WIDTH * stageContentScaleX
    : edit || preview
      ? PAGE_WIDTH
      : PAGE_WIDTH * effectiveScale;
  const stageContentHeight = isScaledCustomEdit
    ? fullScrollHeight * stageContentScaleY
    : edit || preview
      ? fullScrollHeight
      : fullScrollHeight * effectiveScale;

  const editPageWidthScaled = useMemo(() => PAGE_WIDTH * stageContentScaleX, [stageContentScaleX]);
  const editPageHeightScaled = useMemo(() => PAGE_HEIGHT * stageContentScaleY, [stageContentScaleY]);

  // ✅ pageTurnEnabled 켜질 때: 스크롤 잔상 제거
  useEffect(() => {
    if (!horizontalPageTurnEnabled) return;
    hardResetScrollTop('auto');
  }, [horizontalPageTurnEnabled]);

  // ✅ totalPages가 줄었을 때 pageIndex 보정
  useEffect(() => {
    const nextPage = Math.min(Math.max(1, pageIndex), totalPages);
    if (nextPage !== pageIndex) setPageIndex(nextPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  // ✅ edit 상태 변화 시 초기화
  useEffect(() => {
    if (edit) {
      setPageView(true);
      setPageIndex(1);
      setPreview(false);
      setTplPanelOpen(true);
      setTimeout(() => hardResetScrollTop('auto'), 0);
    } else {
      setPreview(false);
      setTimeout(() => hardResetScrollTop('auto'), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);

  // ✅ 보기 모드에서 pageIndex 변경 시 해당 페이지로 스냅 위치 동기화
  useEffect(() => {
    if (!horizontalPageTurnEnabled || preview) return;

    const sc = stageScrollRef.current;
    if (!sc) return;

    if (viewPageChangeSourceRef.current === 'scroll') {
      viewPageChangeSourceRef.current = null;
      return;
    }

    const viewportWidth = Math.max(1, Number(sc.clientWidth) || Number(vw) || 1);
    const targetLeft = (Math.min(Math.max(1, Number(pageIndex) || 1), totalPages) - 1) * viewportWidth;

    if (Math.abs((Number(sc.scrollLeft) || 0) - targetLeft) > 2) {
      sc.scrollTo({ left: targetLeft, behavior: 'auto' });
    }
  }, [horizontalPageTurnEnabled, preview, pageIndex, totalPages, vw]);

  // ✅ edit에서 pageView 켰을 때 페이지 스크롤 이동(편집 전용)
  const scrollToPage = (pi) => {
    const sc = stageScrollRef.current;
    if (!sc) return;
    const idx = Math.min(Math.max(1, pi), totalPages);
    const top = (idx - 1) * (PAGE_HEIGHT + PAGE_GAP);
    sc.scrollTo({ top, behavior: 'smooth' });
  };

  const getScrollBasedPageIndex = useCallback(() => {
    const sc = stageScrollRef.current;
    if (!sc) return Math.min(Math.max(1, Number(pageIndex) || 1), totalPages);

    const unit = PAGE_HEIGHT + PAGE_GAP;
    const scrollTop = Number(sc.scrollTop || 0);
    const viewportCenter = scrollTop + Math.max(1, Number(sc.clientHeight || PAGE_HEIGHT)) / 2;
    const derived = Math.floor(viewportCenter / unit) + 1;
    return Math.min(Math.max(1, derived), totalPages);
  }, [pageIndex, totalPages]);

  useEffect(() => {
    if (!edit || preview || !pageView || editPageTurnEnabled) return;
    const sc = stageScrollRef.current;
    if (!sc) return;

    const syncPageFromScroll = () => {
      const nextPage = getScrollBasedPageIndex();
      setPageIndex((prev) => (prev === nextPage ? prev : nextPage));
    };

    syncPageFromScroll();
    sc.addEventListener('scroll', syncPageFromScroll, { passive: true });
    window.addEventListener('resize', syncPageFromScroll);

    return () => {
      sc.removeEventListener('scroll', syncPageFromScroll);
      window.removeEventListener('resize', syncPageFromScroll);
    };
  }, [edit, preview, pageView, editPageTurnEnabled, getScrollBasedPageIndex]);

  useEffect(() => {
    if (!edit) return;
    setLayout((prev) => {
      const currentPageCount = Math.max(1, Number(prev?.pageCount || 1));
      const nextPageCount = Math.max(1, Number(totalPages || 1));
      if (currentPageCount === nextPageCount) return prev;
      const next = { ...prev, pageCount: nextPageCount };
      return next;
    });
  }, [edit, totalPages, lang]);

  useEffect(() => {
    if (!edit || editPageTurnEnabled) return;
    if (preview) return;
    if (!pageView) return;
    scrollToPage(pageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, edit, pageView, preview, editPageTurnEnabled]);

  const handleSaveAll = async () => {
    const currentLang = lang === 'ko' ? 'ko' : 'en';
    const draftMap = templateDraftLayoutsRef.current instanceof Map
      ? templateDraftLayoutsRef.current
      : new Map();
    const pendingTemplateDraft = draftMap.get(currentLang);
    const pendingTemplateId = getCanonicalTemplateId(pendingTemplateDraft);
    const saveSource =
      pendingTemplateDraft?.mode === 'template' && isPremiumTemplateId(pendingTemplateId)
        ? pendingTemplateDraft
        : layout;
    const next = normalizeLoadedLayout({ ...saveSource });
    setLayout(next);
    await persistLayout(next);
    editStartLayoutRef.current = null;
    editStartLayoutsRef.current = new Map();
    editStartLangRef.current = null;
    editStartTemplateSyncRef.current = null;
    templateDraftLayoutsRef.current = new Map();

    setPreview(false);
    setEdit(false);
    setShowEditorMenu(false);
    setToolsVisible(false);
    hideEditButton();
    setPageIndex(1);
    setTimeout(() => hardResetScrollTop('auto'), 0);
  };

  const handleCancelEdit = async () => {
    const previous = editStartLayoutRef.current;
    const previousSnapshots = editStartLayoutsRef.current instanceof Map
      ? editStartLayoutsRef.current
      : new Map();
    const previousLang = editStartLangRef.current === 'ko' ? 'ko' : editStartLangRef.current === 'en' ? 'en' : null;
    const restoreLang = previousLang || (lang === 'ko' ? 'ko' : 'en');
    const restoreLayout = previousSnapshots.get(restoreLang) || previous;

    if (restoreLayout) {
      setLayout(restoreLayout);
    }

    const restoreEntries = Array.from(previousSnapshots.entries())
      .filter(([, snapshot]) => isUsableMenuLayout(snapshot));
    await Promise.all(restoreEntries.map(async ([language, snapshot]) => {
      const safeLang = language === 'ko' ? 'ko' : 'en';
      const sanitized = sanitizeLayoutMediaSafe(snapshot);
      rememberLanguageView(safeLang, cacheOptionsForLayout(snapshot));
      await saveJson(menuLayoutKey(safeLang), sanitized);
    }));

    if (previousLang && previousLang !== lang) {
      setLang(previousLang);
      try {
        localStorage.setItem(LANG_KEY, previousLang);
      } catch {}
    }

    setPairedTemplateSync(editStartTemplateSyncRef.current?.templateId || null);
    editStartLayoutRef.current = null;
    editStartLayoutsRef.current = new Map();
    editStartLangRef.current = null;
    editStartTemplateSyncRef.current = null;
    templateDraftLayoutsRef.current = new Map();
    setPreview(false);
    setEdit(false);
    setShowEditorMenu(false);
    setToolsVisible(false);
    setTplPanelOpen(true);
    hideEditButton();
    setPageIndex(1);
    setTimeout(() => hardResetScrollTop('auto'), 0);
  };

  const handleExitPreview = () => {
    setPreview(false);
    setToolsVisible(false);
  };

  const getPageBgUrl = (pageNum) => {
    const overrideUrl = bgOverrideUrls?.[String(pageNum)] || bgOverrideUrls?.[pageNum];
    return overrideUrl || bgUrl;
  };

  // ✅✅ 배경 렌더: 페이지별 오버라이드가 있으면 그거, 없으면 default(bgUrl)
  const renderBgPages = () => {
    if (layout?.mode === 'template') return null;
    if (!bgUrl) return null;

    const pagesForBg = pageTurnEnabled ? totalPages : totalPages; // 동일, 구조만 명시
    const bgScaleX = isScaledCustomEdit ? stageContentScaleX : 1;
    const bgScaleY = isScaledCustomEdit ? stageContentScaleY : 1;
    return Array.from({ length: pagesForBg }).map((_, i) => {
      const pageNum = i + 1;
      const useUrl = getPageBgUrl(pageNum);

      const top = i * (PAGE_HEIGHT + PAGE_GAP) * bgScaleY;
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            width: PAGE_WIDTH * bgScaleX,
            top,
            height: PAGE_HEIGHT * bgScaleY,
            backgroundImage: `url(${useUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'top center',
            backgroundSize: '100% 100%',
            backgroundAttachment: 'scroll',
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      );
    });
  };

  const renderBgPage = (pageNum, top = 0) => {
    if (layout?.mode === 'template') return null;
    const useUrl = getPageBgUrl(pageNum);
    if (!useUrl) return null;

    return (
      <div
        key={`page-bg-${pageNum}-${top}`}
        style={{
          position: 'absolute',
          left: 0,
          width: PAGE_WIDTH,
          top,
          height: PAGE_HEIGHT,
          backgroundImage: `url(${useUrl})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'top center',
          backgroundSize: '100% 100%',
          backgroundAttachment: 'scroll',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
    );
  };

  const hasOverrideThisPage = !!bgOverrides?.[pageIndex];

  // ✅ 보기모드 스와이프/휠 처리
  const onViewScroll = useCallback((event) => {
    if (!horizontalPageTurnEnabled || preview) return;

    const sc = event?.currentTarget || stageScrollRef.current;
    if (!sc) return;

    const viewportWidth = Math.max(1, Number(sc.clientWidth) || Number(vw) || 1);
    const derivedPage = Math.min(
      Math.max(1, Math.round((Number(sc.scrollLeft) || 0) / viewportWidth) + 1),
      totalPages
    );

    if (derivedPage !== pageIndex) {
      viewPageChangeSourceRef.current = 'scroll';
      setPageIndex(derivedPage);
    }
  }, [horizontalPageTurnEnabled, preview, vw, totalPages, pageIndex]);

  const onViewWheel = useCallback((event) => {
    if (!horizontalPageTurnEnabled || preview) return;

    const sc = stageScrollRef.current;
    if (!sc) return;

    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!primaryDelta) return;

    event.preventDefault();
    sc.scrollLeft += primaryDelta;
  }, [horizontalPageTurnEnabled, preview]);

  const renderCanvasLayer = (width = `${PAGE_WIDTH}px`, height = fullScrollHeight, options = {}) => {
    const viewPageNumber = Number(options?.viewPageNumber) > 0 ? Math.floor(Number(options.viewPageNumber)) : null;
    const editPageNumber = Number(options?.editPageNumber) > 0 ? Math.floor(Number(options.editPageNumber)) : null;
    const canvasFullScrollHeight = Number(options?.fullScrollHeight) > 0 ? Number(options.fullScrollHeight) : fullScrollHeight;
    const canvasInteractionScale = Number(options?.interactionScale) > 0 ? Number(options.interactionScale) : 1;
    const canvasInteractionScaleX = Number(options?.interactionScaleX) > 0 ? Number(options.interactionScaleX) : canvasInteractionScale;
    const canvasInteractionScaleY = Number(options?.interactionScaleY) > 0 ? Number(options.interactionScaleY) : canvasInteractionScale;
    const canvasInspectorTop = Number(options?.inspectorTop) > 0 ? Number(options.inspectorTop) : 118;
    if (layout.mode === 'template') {
      return (
        <div
          style={{ position: 'relative', width, height, overflow: 'visible' }}
          onClick={() => {
            if (!edit || preview) return;
            setTplPanelOpen(true);
            setShowEditorMenu(false);
          }}
        >
          <TemplateCanvas
            lang={lang}
            editing={edit}
            uiMode={preview ? 'preview' : edit ? 'edit' : 'view'}
            panelOpen={tplPanelOpen}
            onTogglePanel={(open) => {
              setTplPanelOpen(open);
              if (!open) setShowEditorMenu(false);
            }}
            directTouchEdit
            pageHeight={PAGE_HEIGHT}
            pageGap={PAGE_GAP}
            fullScrollHeight={fullScrollHeight}
            viewPageNumber={viewPageNumber}
            templateId={layout.templateId}
            data={layout.templateData}
            onChange={(nextData) => {
              const next = { ...layout, mode: 'template', templateData: nextData };
              updateTemplateDraftLayout(next);
            }}
            onCancel={(items) => {
              handleCancelEdit();
            }}
          />
        </div>
      );
    }

    if (layout.mode === 'custom') {
      const allItems = Array.isArray(layout.items) ? layout.items : [];
      const safeEditPageNumber = edit && editPageNumber
        ? Math.min(Math.max(1, editPageNumber), totalPages)
        : null;
      const editPageTop = safeEditPageNumber
        ? (safeEditPageNumber - 1) * (PAGE_HEIGHT + PAGE_GAP)
        : 0;
      const editPageBottom = editPageTop + PAGE_HEIGHT;
      const pageScopedItems = safeEditPageNumber
        ? allItems
            .filter((item) => {
              const top = Number(item?.y) || 0;
              const bottom = top + Math.max(1, Number(item?.h) || 0);
              return bottom > editPageTop && top < editPageBottom;
            })
            .map((item) => ({ ...item, y: (Number(item?.y) || 0) - editPageTop }))
        : allItems;
      const pageScopedItemIds = new Set(pageScopedItems.map((item) => item.id));
      const mergePageScopedItems = (nextItems) => {
        if (!safeEditPageNumber) return Array.isArray(nextItems) ? nextItems : allItems;

        const absolutePageItems = (Array.isArray(nextItems) ? nextItems : pageScopedItems)
          .map((item) => ({
            ...item,
            y: (Number(item?.y) || 0) + editPageTop,
          }));
        const absoluteIds = new Set(absolutePageItems.map((item) => item.id));
        const keptItems = allItems.filter((item) => !pageScopedItemIds.has(item.id) && !absoluteIds.has(item.id));

        return [...keptItems, ...absolutePageItems].sort((a, b) => (a.z || 0) - (b.z || 0));
      };

      return (
        <div style={{ position: 'relative', width, height, overflow: 'visible' }}>
          <CustomCanvas
            lang={lang}
            inspectorTop={canvasInspectorTop}
            interactionScale={canvasInteractionScale}
            interactionScaleX={canvasInteractionScaleX}
            interactionScaleY={canvasInteractionScaleY}
            items={pageScopedItems}
            editing={edit}
            uiMode={preview ? 'preview' : edit ? 'edit' : 'view'}
            scrollRef={stageScrollRef}
            pageWidth={PAGE_WIDTH}
            pageHeight={PAGE_HEIGHT}
            pageGap={PAGE_GAP}
            fullScrollHeight={canvasFullScrollHeight}
            currentPage={safeEditPageNumber ? 1 : pageIndex}
            viewPageNumber={viewPageNumber}
            controlsHidden={isOverlayOpen}
            toolsVisible={toolsVisible}
            onToolsVisibleChange={handleToolsVisibleChange}
            toolsLauncherHidden={showEditorMenu}
            suppressToolsAutoOpen={showEditorMenu || isOverlayOpen}
            onChangeItems={(items) => {
              const next = { ...layout, mode: 'custom', items: mergePageScopedItems(items) };
              setLayout(next);
            }}
            onSave={(items) => {
              const next = { ...layout, mode: 'custom', items: mergePageScopedItems(items) };
              setLayout(next);
              persistLayout(next);

              setPreview(false);
              setEdit(false);
              setShowEditorMenu(false);
              setToolsVisible(false);
              hideEditButton();
              setPageIndex(1);
              setTimeout(() => hardResetScrollTop('auto'), 0);
            }}
            onCancel={(items) => {
              handleCancelEdit();
            }}
          />
        </div>
      );
    }

    return null;
  };

  const renderModals = () => (
    <>
      {pinModalOpen && (
        <div style={styles.modalBg} onClick={() => setPinModalOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>{T.pinEnterTitle}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>{T.pinEnterDesc}</div>

            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              inputMode="numeric"
              placeholder={lang === 'ko' ? '4자리 숫자' : '4 digits'}
              style={styles.pinInput}
              maxLength={4}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitPin();
                if (e.key === 'Escape') setPinModalOpen(false);
              }}
            />

            {pinError && <div style={styles.errText}>{pinError}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button style={styles.primaryBtn} onClick={submitPin}>
                {T.confirm}
              </button>
              <button style={styles.secondaryBtn} onClick={() => setPinModalOpen(false)}>
                {T.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div style={styles.modalBg} onClick={() => setSettingsOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>{T.pinSettings}</div>

            <div style={{ fontWeight: 900, marginBottom: 6 }}>{T.pinChange}</div>

            <input
              type="password"
              value={curPinInput}
              onChange={(e) => setCurPinInput(e.target.value)}
              inputMode="numeric"
              placeholder={T.curPin}
              style={styles.pinInput}
              maxLength={4}
            />
            <input
              type="password"
              value={newPinInput}
              onChange={(e) => setNewPinInput(e.target.value)}
              inputMode="numeric"
              placeholder={T.newPin}
              style={styles.pinInput}
              maxLength={4}
            />
            <input
              type="password"
              value={newPinConfirm}
              onChange={(e) => setNewPinConfirm(e.target.value)}
              inputMode="numeric"
              placeholder={T.newPin2}
              style={styles.pinInput}
              maxLength={4}
            />

            {settingsError && <div style={styles.errText}>{settingsError}</div>}
            {settingsMsg && <div style={styles.okText}>{settingsMsg}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button style={styles.primaryBtn} onClick={submitChangePin}>
                {T.change}
              </button>
              <button
                style={styles.secondaryBtn}
                onClick={() => {
                  setSettingsOpen(false);
                  setSettingsError('');
                  setSettingsMsg('');
                }}
              >
                {T.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {pageBgModalOpen && (
        <div style={styles.modalBg} onClick={() => setPageBgModalOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>{T.pageBgTitle}</div>

            <div style={{ fontWeight: 900, marginBottom: 8 }}>
              {T.currentPage}: {Math.min(Math.max(1, Number(pageIndex) || 1), totalPages)} / {totalPages}
            </div>

            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
              {hasOverrideThisPage ? T.usingOverride : T.usingDefault}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={styles.primaryBtn} onClick={() => { setPageIndex(getScrollBasedPageIndex()); openPageBgPicker(); }}>
                {T.uploadThis}
              </button>

              <button
                style={styles.secondaryBtn}
                onClick={() => clearPageBgOverride(getScrollBasedPageIndex())}
                disabled={!hasOverrideThisPage}
              >
                {T.clearThis}
              </button>

              <button style={styles.secondaryBtn} onClick={() => setPageBgModalOpen(false)}>
                {T.close}
              </button>
            </div>

            <input
              ref={pageBgInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => uploadPageBg(e.target.files?.[0], getScrollBasedPageIndex())}
            />

            {assetUploadMessage && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  color: assetUploading ? '#7dd3fc' : '#e5e7eb',
                }}
              >
                {assetUploadMessage}
              </div>
            )}
          </div>
        </div>
      )}

      {editModeModalOpen && (
        <div style={styles.modalBg} onClick={() => setEditModeModalOpen(false)}>
          <div style={{ ...styles.modal, ...styles.templateModal }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'grid', gap: 12 }}>
              <TemplatePicker
                lang={lang}
                onPick={startTemplateOnboarding}
              />

              <div style={{ height: 12 }} />

              <button
                style={styles.primaryBtn}
                onClick={startFreeLayoutOnboarding}
              >
                {T.freeEdit}
              </button>

              <button style={styles.secondaryBtn} onClick={() => setEditModeModalOpen(false)}>
                {T.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const langWrapStyle = edit ? styles.langWrapEdit : styles.langWrapView;
  const langRowStyle = edit ? styles.langRowEdit : styles.langRowView;
  const langBtnStyle = edit ? styles.langBtn : styles.langBtnView;
  const langBtnActiveStyle = edit ? styles.langBtnActive : styles.langBtnActiveView;

  const renderViewPageSegment = (pageNum, pageWidthScaled, pageHeightScaled, shouldRenderContent) => {
    const safePageNum = Math.min(Math.max(1, Number(pageNum) || 1), totalPages);

    return (
      <section
        key={`view-page-${safePageNum}`}
        style={{
          flex: '0 0 100%',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'center',
          scrollSnapAlign: 'center',
          scrollSnapStop: 'always',
          padding: 0,
        }}
      >
        <div
          style={{
            ...styles.viewPageFrame,
            width: pageWidthScaled,
            height: pageHeightScaled,
          }}
        >
          <div
            style={{
              ...styles.viewPageSurface,
              boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
            }}
          >
            <div style={{ ...styles.viewPageMask, width: pageWidthScaled, height: pageHeightScaled }}>
              <div
                style={{
                  position: 'relative',
                  width: pageWidthScaled,
                  height: pageHeightScaled,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: PAGE_WIDTH,
                    height: PAGE_HEIGHT,
                    transform: `translateZ(0) scaleX(${effectiveScaleX}) scaleY(${effectiveScaleY})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <div style={{ ...styles.page, height: PAGE_HEIGHT, margin: 0 }}>
                    {renderBgPage(safePageNum, 0)}
                    {shouldRenderContent
                      ? renderCanvasLayer(`${PAGE_WIDTH}px`, PAGE_HEIGHT, { viewPageNumber: safePageNum })
                      : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderViewPages = () => {
    const pageWidthScaled = viewPageWidthScaled;
    const pageHeightScaled = viewPageHeightScaled;

    return (
      <div
        ref={stageScrollRef}
        style={{
          ...styles.stage,
          ...styles.viewNoSelect,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorX: 'contain',
          overscrollBehaviorY: 'none',
          touchAction: 'pan-x pinch-zoom',
          scrollbarWidth: 'none',
        }}
        onScroll={onViewScroll}
        onWheel={onViewWheel}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
          }}
        >
          {Array.from({ length: totalPages }).map((_, index) => {
            const pageNum = index + 1;
            return renderViewPageSegment(pageNum, pageWidthScaled, pageHeightScaled, true);
          })}
        </div>
      </div>
    );
  };

  const renderEditPageSegment = (pageNum, shouldRenderContent) => {
    const safePageNum = Math.min(Math.max(1, pageNum), totalPages);
    const pageBgUrl = getPageBgUrl(safePageNum);

    return (
      <section
        key={`edit-page-${safePageNum}`}
        style={{
          position: 'relative',
          flex: '0 0 100%',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          scrollSnapAlign: 'center',
          scrollSnapStop: 'always',
          minHeight: '100%',
          padding: 0,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            ...styles.editPageFrame,
            width: editPageWidthScaled,
            height: editPageHeightScaled,
          }}
        >
          <div style={{ ...styles.editPageMask, width: editPageWidthScaled, height: editPageHeightScaled }}>
            <div
              style={{
                position: 'relative',
                width: editPageWidthScaled,
                height: editPageHeightScaled,
                overflow: 'hidden',
              }}
            >
              {pageBgUrl ? (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `url(${pageBgUrl})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'top center',
                    backgroundSize: '100% 100%',
                    zIndex: 0,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {shouldRenderContent ? (
                layout.mode === 'template' ? (
                  <div
                    style={{
                      position: 'relative',
                      width: PAGE_WIDTH,
                      height: PAGE_HEIGHT,
                      transform: `translateZ(0) scaleX(${stageContentScaleX}) scaleY(${stageContentScaleY})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <div style={{ ...styles.page, height: PAGE_HEIGHT, margin: 0 }}>
                      {renderCanvasLayer(`${PAGE_WIDTH}px`, PAGE_HEIGHT, { viewPageNumber: safePageNum })}
                    </div>
                  </div>
                ) : (
                  renderCanvasLayer(editPageWidthScaled, editPageHeightScaled, {
                    editPageNumber: safePageNum,
                    fullScrollHeight: PAGE_HEIGHT,
                    interactionScale: stageContentScaleX,
                    interactionScaleX: stageContentScaleX,
                    interactionScaleY: stageContentScaleY,
                    inspectorTop: 118,
                  })
                )
              ) : null}
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderEditPages = () => (
    <div
      ref={stageScrollRef}
      style={{
        ...styles.stage,
        overflowX: 'auto',
        overflowY: isWideEditViewport ? 'auto' : 'hidden',
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorX: 'contain',
        overscrollBehaviorY: isWideEditViewport ? 'contain' : 'none',
        touchAction: isWideEditViewport ? 'pan-x pan-y pinch-zoom' : 'pan-x pinch-zoom',
        scrollbarWidth: 'none',
        boxSizing: 'border-box',
      }}
      onScroll={onViewScroll}
      onWheel={onViewWheel}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '100%',
        }}
      >
        {Array.from({ length: totalPages }).map((_, index) => {
          const pageNum = index + 1;
          const shouldRenderContent = layout.mode === 'template' || pageNum === pageIndex;

          return renderEditPageSegment(pageNum, shouldRenderContent);
        })}
      </div>
    </div>
  );

  const renderFloatingUi = () => {
    if (preview) return null;

    return (
      <>
        {!isOverlayOpen && (
          <div style={langWrapStyle}>
            {edit ? (
              <div style={langRowStyle}>
                <button
                  style={{ ...langBtnStyle, ...(lang === 'en' ? langBtnActiveStyle : {}), ...(switchingLang ? styles.langBtnDisabled : {}) }}
                  onClick={() => setLanguage('en')}
                  disabled={!!switchingLang}
                  aria-label="English"
                  title="English"
                >
                  🇺🇸
                </button>
                <button
                  style={{ ...langBtnStyle, ...(lang === 'ko' ? langBtnActiveStyle : {}), ...(switchingLang ? styles.langBtnDisabled : {}) }}
                  onClick={() => setLanguage('ko')}
                  disabled={!!switchingLang}
                  aria-label="Korean"
                  title="한국어"
                >
                  🇰🇷
                </button>
              </div>
            ) : (
              <div style={langRowStyle}>
                <a href="/intro" style={styles.backBtn} onClick={goIntro} aria-label={T.backToVideo} title={T.backToVideo}>
                  <span style={styles.backBtnIcon} aria-hidden="true">
                    <span style={styles.backBtnTriangle} />
                  </span>
                </a>
                <button
                  style={{ ...langBtnStyle, ...(lang === 'en' ? langBtnActiveStyle : {}), ...(switchingLang ? styles.langBtnDisabled : {}) }}
                  onClick={() => setLanguage('en')}
                  disabled={!!switchingLang}
                  aria-label="English"
                  title="English"
                >
                  <span style={styles.langFlag}>🇺🇸</span>
                  <span style={styles.langCode}>EN</span>
                </button>
                <button
                  style={{ ...langBtnStyle, ...(lang === 'ko' ? langBtnActiveStyle : {}), ...(switchingLang ? styles.langBtnDisabled : {}) }}
                  onClick={() => setLanguage('ko')}
                  disabled={!!switchingLang}
                  aria-label="Korean"
                  title="한국어"
                >
                  <span style={styles.langFlag}>🇰🇷</span>
                  <span style={styles.langCode}>KO</span>
                </button>
              </div>
            )}

            {switchingLang && (
              <div style={styles.switchingLangPill}>
                {switchingLang === 'ko' ? '한국어 준비 중...' : 'English loading...'}
              </div>
            )}

            {!edit && showEditBtn && (
              <div style={styles.editActionsRow}>
                <button
                  style={styles.logoutBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLogout();
                  }}
                >
                  {T.logout}
                </button>
                <button
                  style={styles.editBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    requestEdit();
                  }}
                >
                  {T.edit}
                </button>
              </div>
            )}
          </div>
        )}


        {!showEditBtn && !edit && (
          <div
            style={styles.secretHotspot}
            onClick={onSecretCornerClick}
            onMouseDown={startLongPress}
            onMouseUp={cancelLongPress}
            onMouseLeave={cancelLongPress}
            onTouchStart={startLongPress}
            onTouchEnd={cancelLongPress}
            onTouchCancel={cancelLongPress}
            aria-label="secret-edit-hotspot"
          />
        )}

        {editPageTurnEnabled && !isOverlayOpen && !toolsVisible && (
          <div style={styles.editorMenuBar} onMouseDown={(e) => e.stopPropagation()}>
            <button
              style={styles.menuBtnDark}
              onClick={() => {
                setShowEditorMenu((prev) => {
                  const next = !prev;
                  if (next) setToolsVisible(false);
                  return next;
                });
              }}
            >
              {T.editorMenu}
            </button>
          </div>
        )}

        {editPageTurnEnabled && showEditorMenu && !isOverlayOpen && (
          <div style={styles.editMenu} onMouseDown={(e) => e.stopPropagation()}>
            <button
              style={styles.menuBtn}
              onClick={() => {
                setTplPanelOpen(false);
                setEditModeModalOpen(true);
              }}
            >
              {T.changeMode}
            </button>

            <button style={styles.menuBtn} onClick={openPageBackgroundFromManage}>
              {T.pageBg}
            </button>

            <button style={styles.menuBtn} onClick={openIntroVideoPicker}>
              {T.introVideo}
            </button>

            <button
              style={styles.menuBtn}
              onClick={() => {
                setSettingsError('');
                setSettingsMsg('');
                setSettingsOpen(true);
              }}
            >
              {T.pinSettings}
            </button>

            <button style={styles.menuBtn} onClick={openAllPagesBackgroundFromManage}>
              {T.changeBg}
            </button>

            <button style={styles.menuBtn} onClick={exportBackupFile}>
              {T.backupExport}
            </button>

            <button style={styles.menuBtn} onClick={openBackupImportPicker}>
              {T.backupImport}
            </button>

            <button
              style={styles.menuBtnDark}
              onClick={() => {
                setShowEditorMenu(false);
                setToolsVisible(false);
                setPreview(true);
              }}
            >
              {T.preview}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => uploadBg(e.target.files?.[0])}
            />

            <input
              ref={introVideoInputRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={(e) => uploadIntroVideo(e.target.files?.[0])}
            />

            <input
              ref={backupImportInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                await importBackupFile(file);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {edit && !preview && layout.mode === 'template' && !isOverlayOpen && (
          <div style={styles.templateActionBar} onMouseDown={(e) => e.stopPropagation()}>
            <button style={styles.menuBtnDark} onClick={handleSaveAll}>
              {T.save}
            </button>
            <button style={styles.menuBtn} onClick={handleCancelEdit}>
              {T.cancel}
            </button>
          </div>
        )}

        {horizontalPageTurnEnabled && totalPages > 1 && !isOverlayOpen && (
          <>
            <div style={styles.pagePill}>
              {Math.min(Math.max(1, Number(pageIndex) || 1), totalPages)} / {totalPages}
            </div>
            <button
              type="button"
              style={{
                ...styles.pageNavBtn,
                ...styles.pageNavLeft,
                ...(pageIndex <= 1 ? styles.pageNavBtnDisabled : null),
              }}
              onClick={() => setPageIndex((prev) => Math.max(1, prev - 1))}
              disabled={pageIndex <= 1}
              aria-label={T.prev}
              title={T.prev}
            >
              ‹
            </button>
            <button
              type="button"
              style={{
                ...styles.pageNavBtn,
                ...styles.pageNavRight,
                ...(pageIndex >= totalPages ? styles.pageNavBtnDisabled : null),
              }}
              onClick={() => setPageIndex((prev) => Math.min(totalPages, prev + 1))}
              disabled={pageIndex >= totalPages}
              aria-label={T.next}
              title={T.next}
            >
              ›
            </button>
          </>
        )}
      </>
    );
  };

  const hasRenderableMenu = isUsableMenuLayout(layout);
  const initialLayoutImageCount = hasRenderableMenu ? getAllLayoutImageUrls(layout).length : 0;
  const initialMediaHydrated = hasRenderableMenu && !layoutNeedsMediaHydration(layout);
  const initialLayoutImagesReady =
    initialLayoutImageCount === 0 ||
    initialMediaHydrated ||
    (visualsReadySignal >= 0 && visualsReadyLangsRef.current.has(lang));
  const initialCustomBackgroundReady =
    !hasRenderableMenu ||
    layout?.mode !== 'custom' ||
    (bgResolved && (!bgUrl || bgAssetsReady));
  const initialMenuReadyToDisplay =
    hasRenderableMenu &&
    initialMediaHydrated &&
    initialCustomBackgroundReady &&
    initialLayoutImagesReady;
  const initialLoadResolved =
    !loading &&
    (!hasRenderableMenu || initialMenuReadyToDisplay);
  const isInitialLoading = !hasInitialView && !initialLoadResolved;
  const showInitialTemplatePicker = !hasRenderableMenu && !freeLayoutOnboarding && (!loading || onboardingRequested);
  const showFreeLayoutBackgroundSetup = freeLayoutOnboarding || (bgResolved && !bgUrl && !hasRenderableMenu);

  return (
    <div style={styles.container}>
      {showInitialTemplatePicker ? (
        <div style={styles.setupWrap}>
          <div style={{ ...styles.setupCard, ...styles.onboardingCard }}>
            <TemplatePicker lang={lang} onPick={startTemplateOnboarding} />
            <button style={{ ...styles.primaryBtn, ...styles.onboardingFreeButton }} onClick={startFreeLayoutOnboarding}>
              {T.freeEdit}
            </button>
          </div>
        </div>
      ) : showFreeLayoutBackgroundSetup ? (
        <div style={styles.setupWrap}>
          <div style={styles.setupCard}>
            <div style={styles.setupHeader}>
              <div style={styles.setupEyebrow}>{T.freeEdit}</div>
              <div style={styles.title}>{T.pickBgTitle}</div>
              <div style={styles.desc}>
                {T.pickBgDesc1}
                <b>{T.pickBgDesc2}</b>
                {T.pickBgDesc3}
                <br />
                {T.pickBgDesc4}
              </div>
            </div>

            <div
              style={{ ...styles.dropZone, ...(dragOver ? styles.dropZoneActive : {}) }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={openFilePicker}
              role="button"
              tabIndex={0}
            >
              <div style={styles.dropIcon}>BG</div>
              <div style={styles.dropText}>
                {T.drop1}
                <br />
                <span style={styles.linkLike}>{T.drop2}</span> {T.drop3}
              </div>
              <div style={styles.hint}>{T.hint}</div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => uploadBg(e.target.files?.[0])}
            />

            {assetUploadMessage && (
              <div style={{ ...styles.setupUploadMessage, ...(assetUploading ? styles.setupUploadMessageBusy : {}) }}>
                {assetUploadMessage}
              </div>
            )}

            <div style={styles.smallNote}>{T.keep}</div>
          </div>
        </div>
      ) : editPageTurnEnabled ? (
        renderEditPages()
      ) : pageTurnEnabled ? (
        renderViewPages()
      ) : (
        <div
          ref={stageScrollRef}
          style={{
            ...styles.stage,
            ...((edit || preview) ? {} : styles.viewNoSelect),
            overflowX: edit || preview ? 'auto' : 'hidden',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            touchAction: edit || preview ? 'auto' : 'pan-y',
            boxSizing: 'border-box',
          }}
        >
          {/* ✅ mover: 보기모드에서만 translate, 편집/미리보기는 none */}
          <div
            style={{
              ...styles.viewportMover,
              justifyContent: 'center',
              paddingLeft: 0,
              paddingRight: 0,
              paddingTop: edit && !preview ? 118 : 0,
              paddingBottom: edit && !preview ? 88 : 0,
              boxSizing: 'border-box',
              minWidth: isScaledCustomEdit ? '100%' : edit || preview ? 'max(100%, 1080px)' : '100%',
            }}
          >
            {/* ✅ content wrapper: 보기모드는 실제 박스 폭도 같이 줄여서 Android/WebView 잘림 방지 */}
            <div
              style={{
                position: 'relative',
                width: stageContentWidth,
                height: stageContentHeight,
                overflow: 'visible',
                margin: '0 auto',
                flex: '0 0 auto',
              }}
            >
              <div
                style={{
                  ...styles.page,
                  width: isScaledCustomEdit ? stageContentWidth : PAGE_WIDTH,
                  height: isScaledCustomEdit ? stageContentHeight : fullScrollHeight,
                  transform: edit || preview ? 'none' : `scale(${effectiveScale})`,
                  transformOrigin: 'top left',
                  margin: 0,
                }}
              >
                {renderBgPages()}

                {/* ✅ 편집 중 페이지 구분선 */}
                {edit && !preview && (
                <>
                  {Array.from({ length: totalPages - 1 }).map((_, i) => {
                    const y = ((i + 1) * PAGE_HEIGHT + i * PAGE_GAP) * stageContentScaleY;
                    return (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: y,
                          height: PAGE_GAP * stageContentScaleY,
                          background: 'rgba(0,0,0,0.65)',
                          borderTop: '1px dashed rgba(255,255,255,0.55)',
                          borderBottom: '1px dashed rgba(255,255,255,0.55)',
                          zIndex: 30,
                          pointerEvents: 'none',
                        }}
                      />
                    );
                  })}
                </>
              )}

              {/* ✅ 편집 메뉴 */}
              {edit && !preview && !isOverlayOpen && !toolsVisible && (
                <div style={styles.editorMenuBar} onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    style={styles.menuBtnDark}
                    onClick={() => {
                      setShowEditorMenu((prev) => {
                        const next = !prev;
                        if (next) setToolsVisible(false);
                        return next;
                      });
                    }}
                  >
                    {T.editorMenu}
                  </button>
                </div>
              )}

              {/* ✅ 편집 메뉴 (토글) */}
              {edit && showEditorMenu && !preview && !isOverlayOpen && (
                <div style={styles.editMenu} onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    style={styles.menuBtn}
                    onClick={() => {
                      setTplPanelOpen(false);
                      setEditModeModalOpen(true);
                    }}
                  >
                    {T.changeMode}
                  </button>

                  <button style={styles.menuBtn} onClick={openPageBackgroundFromManage}>
                    {T.pageBg}
                  </button>

                  <button style={styles.menuBtn} onClick={openIntroVideoPicker}>
                    {T.introVideo}
                  </button>

                  <button
                    style={styles.menuBtn}
                    onClick={() => {
                      setSettingsError('');
                      setSettingsMsg('');
                      setSettingsOpen(true);
                    }}
                  >
                    {T.pinSettings}
                  </button>

                  <button style={styles.menuBtn} onClick={openAllPagesBackgroundFromManage}>
                    {T.changeBg}
                  </button>

                  <button style={styles.menuBtn} onClick={exportBackupFile}>
                    {T.backupExport}
                  </button>

                  <button style={styles.menuBtn} onClick={openBackupImportPicker}>
                    {T.backupImport}
                  </button>

                  <button
                    style={styles.menuBtnDark}
                    onClick={() => {
                      setShowEditorMenu(false);
                      setToolsVisible(false);
                      setPreview(true);
                    }}
                  >
                    {T.preview}
                  </button>

                  {/* 전체 배경 */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => uploadBg(e.target.files?.[0])}
                  />

                  <input
                    ref={introVideoInputRef}
                    type="file"
                    accept="video/*"
                    style={{ display: 'none' }}
                    onChange={(e) => uploadIntroVideo(e.target.files?.[0])}
                  />

                  <input
                    ref={backupImportInputRef}
                    type="file"
                    accept="application/json,.json"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      await importBackupFile(file);
                      e.target.value = '';
                    }}
                  />
                </div>
              )}

              {/* ✅ 미리보기 상단 바 */}
              {edit && preview && !isOverlayOpen && (
                <div style={styles.previewBar} onMouseDown={(e) => e.stopPropagation()}>
                  <button style={styles.menuBtnDark} onClick={handleSaveAll}>
                    {T.save}
                  </button>
                  <button style={styles.menuBtn} onClick={handleExitPreview}>
                    {T.back}
                  </button>
                </div>
              )}

              {/* ✅ 보기모드 페이지 인디케이터(옵션: 조용하게) */}
              {!layout.mode && !preview && <div style={styles.helpHint}>{T.help}</div>}

              {layout.mode === 'template' && !preview && (
                <div style={styles.badge}>
                  {T.templateBadge}
                  {layout.templateId}
                </div>
              )}

              {layout.mode === 'template' && edit && !preview && !isOverlayOpen && !tplPanelOpen && (
                <button style={{ ...styles.tplShowBtn, display: 'none' }} onClick={() => setTplPanelOpen(true)}>
                  {T.showTplPanel}
                </button>
              )}

              {/* ✅ Template */}
              {layout.mode === 'template' && (
                <div
                  style={{ position: 'relative', width: PAGE_WIDTH, height: '100%', overflow: 'hidden' }}
                  onClick={() => {
                    if (!edit || preview) return;
                    setTplPanelOpen(true);
                    setShowEditorMenu(false);
                  }}
                >
                  <TemplateCanvas
                    lang={lang}
                    editing={edit}
                    uiMode={preview ? 'preview' : edit ? 'edit' : 'view'}
                    panelOpen={tplPanelOpen}
                    onTogglePanel={(open) => {
                      setTplPanelOpen(open);
                      if (!open) setShowEditorMenu(false);
                    }}
                    directTouchEdit
                    pageHeight={PAGE_HEIGHT}
                    pageGap={PAGE_GAP}
                    fullScrollHeight={fullScrollHeight}
                    templateId={layout.templateId}
                    data={layout.templateData}
                    onChange={(nextData) => {
                      const next = { ...layout, mode: 'template', templateData: nextData };
                      updateTemplateDraftLayout(next);
                    }}
                    onCancel={(items) => {
                      handleCancelEdit();
                    }}
                  />
                </div>
              )}

              {/* ✅ Custom */}
              {layout.mode === 'custom' && (
                <div
                  style={{
                    position: 'relative',
                    width: isScaledCustomEdit ? stageContentWidth : PAGE_WIDTH,
                    height: '100%',
                    overflow: 'hidden',
                  }}
                >
                <CustomCanvas
                  lang={lang}
                  inspectorTop={118}
                  interactionScale={stageContentScaleX}
                  interactionScaleX={stageContentScaleX}
                  interactionScaleY={stageContentScaleY}
                  items={layout.items}
                  editing={edit}
                  uiMode={preview ? 'preview' : edit ? 'edit' : 'view'}
                  scrollRef={stageScrollRef}
            pageWidth={PAGE_WIDTH}
            pageHeight={PAGE_HEIGHT}
                  controlsHidden={isOverlayOpen}
                  toolsVisible={toolsVisible}
                  onToolsVisibleChange={handleToolsVisibleChange}
                  toolsLauncherHidden={showEditorMenu}
                  suppressToolsAutoOpen={showEditorMenu || isOverlayOpen}
                  onChangeItems={(items) => {
                    const next = { ...layout, mode: 'custom', items };
                    setLayout(next);
                  }}
                  onSave={(items) => {
                    const next = { ...layout, mode: 'custom', items };
                    setLayout(next);
                    persistLayout(next);

                    setPreview(false);
                    setEdit(false);
                    setShowEditorMenu(false);
                    setToolsVisible(false);
                    hideEditButton();
                    setPageIndex(1);
                    setTimeout(() => hardResetScrollTop('auto'), 0);
                  }}
                  onCancel={(items) => {
                    handleCancelEdit();
                  }}
                />
                </div>
              )}

              {/* ✅ 최초 편집 모드 선택 모달 */}
              {edit && !preview && layout.mode !== 'custom' && layout.mode !== 'template' && (
                <div
                  style={styles.modalBg}
                  onClick={() => {
                    setEdit(false);
                    setPreview(false);
                    hideEditButton();
                    setPageIndex(1);
                    setTimeout(() => hardResetScrollTop('auto'), 0);
                  }}
                >
                  <div style={{ ...styles.modal, ...styles.templateModal }} onClick={(e) => e.stopPropagation()}>
                    <TemplatePicker
                      lang={lang}
                      onPick={startTemplateOnboarding}
                    />

                    <div style={{ height: 12 }} />

                    <button
                      style={styles.primaryBtn}
                      onClick={startFreeLayoutOnboarding}
                    >
                      {T.freeEdit}
                    </button>

                    <button
                      style={styles.secondaryBtn}
                      onClick={() => {
                        setEdit(false);
                        setPreview(false);
                        hideEditButton();
                        setPageIndex(1);
                        setTimeout(() => hardResetScrollTop('auto'), 0);
                      }}
                    >
                      {T.close}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {!isInitialLoading && preloadSinkUrls.length > 0 && (
        <div style={styles.imagePreloadSink} aria-hidden="true">
          {preloadSinkUrls.map((src, index) => (
            <img
              key={`${src}-${index}`}
              src={src}
              alt=""
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              style={styles.imagePreloadSinkImg}
            />
          ))}
        </div>
      )}
      {!isInitialLoading && renderFloatingUi()}
      {!isInitialLoading && templateNotice && (
        <div style={styles.templateNotice} role="status">
          {templateNotice}
        </div>
      )}
      {!isInitialLoading && renderModals()}
    </div>
  );
}

// ✅ 초기 템플릿 데이터
function makeInitialTemplateData(fullId, lang) {
  const group = (fullId || '').slice(0, 2);
  const variant = (fullId || '').slice(2, 3) || 'A';
  const isKo = lang === 'ko';
  const id = `${group}${variant}`;

  const titles = {
    T1A: isKo ? 'Prime Dinner Menu' : 'Prime Dinner Menu',
    T1B: isKo ? 'Combo Counter Menu' : 'Combo Counter Menu',
    T1C: isKo ? 'Coffee · Brunch · Bakery' : 'Coffee · Brunch · Bakery',
    T2A: isKo ? 'Korean Signature Menu' : 'Korean Signature Menu',
    T2B: isKo ? 'Burger & Chicken Combos' : 'Burger & Chicken Combos',
    T2C: isKo ? 'Seasonal Specials' : 'Seasonal Specials',
    T3A: isKo ? 'Asian Fusion Menu' : 'Asian Fusion Menu',
    T3B: isKo ? 'Quick Service Picks' : 'Quick Service Picks',
    T3C: isKo ? 'Pub & Bar Specials' : 'Pub & Bar Specials',
  };

  const stylePresets = {
    T1A: { accentColor: '#d7b46a', lineSpacing: 1.04, rowGap: 10, uiScale: 0.94, minPages: 3 },
    T1B: { accentColor: '#fb923c', lineSpacing: 1.06, rowGap: 12, uiScale: 0.9 },
    T1C: { accentColor: '#5eead4', lineSpacing: 1.18, rowGap: 18, uiScale: 0.82 },
    T2A: { accentColor: '#7a4b25', lineSpacing: 1.05, rowGap: 10, uiScale: 0.94, minPages: 3 },
    T2B: { accentColor: '#ef4444', lineSpacing: 1.04, rowGap: 12, uiScale: 0.88 },
    T2C: { accentColor: '#38bdf8', lineSpacing: 1.14, rowGap: 16, uiScale: 0.84 },
    T3A: { accentColor: '#ff3d9a', lineSpacing: 1.02, rowGap: 10, uiScale: 0.94, minPages: 3 },
    T3B: { accentColor: '#22c55e', lineSpacing: 1.05, rowGap: 12, uiScale: 0.88 },
    T3C: { accentColor: '#f472b6', lineSpacing: 1.16, rowGap: 18, uiScale: 0.82 },
  };

  const baseStyle = {
    fontFamily: 'system-ui',
    textColor: '#ffffff',
    accentColor: '#f8d36a',
    lineSpacing: 1.12,
    rowGap: 14,
    forceTwoDecimals: true,
    uiScale: 0.85,
    minPages: 3,
    templateKey: id,
    ...(stylePresets[id] || {}),
    variant,
  };

  const brandPresets = {
    T1A: {
      restaurantName: isKo ? 'Oak & Ember' : 'Oak & Ember',
      tagline: isKo ? 'PRIME STEAK · SEAFOOD · WINE' : 'PRIME STEAK · SEAFOOD · WINE',
      footerText: isKo ? 'Order on Your Phone' : 'Order on Your Phone',
    },
    T1B: {
      restaurantName: isKo ? 'Flash Burger' : 'Flash Burger',
      tagline: isKo ? 'BURGERS · CHICKEN · COMBOS' : 'BURGERS · CHICKEN · COMBOS',
      footerText: isKo ? 'Combos served all day' : 'Combos served all day',
    },
    T1C: {
      restaurantName: isKo ? 'Mellow Cup Cafe' : 'Mellow Cup Cafe',
      tagline: isKo ? 'COFFEE · BRUNCH · BAKERY' : 'COFFEE · BRUNCH · BAKERY',
      footerText: isKo ? 'Fresh pastries every morning' : 'Fresh pastries every morning',
    },
    T2A: {
      restaurantName: isKo ? '한소반' : 'Hansoban',
      tagline: isKo ? '소반에 담은 계절 한식 · 반상 · 구이' : 'Modern Korean Bansang · Soban · Grill',
      footerText: isKo ? 'Order on Your Phone' : 'Order on Your Phone',
    },
    T2B: {
      restaurantName: isKo ? 'Stack House' : 'Stack House',
      tagline: isKo ? 'BURGERS · FRIED CHICKEN · FRIES' : 'BURGERS · FRIED CHICKEN · FRIES',
      footerText: isKo ? 'Fresh combos ready fast' : 'Fresh combos ready fast',
    },
    T2C: {
      restaurantName: isKo ? 'Blue Market Grill' : 'Blue Market Grill',
      tagline: isKo ? 'SEASONAL · SEAFOOD · LUNCH' : 'SEASONAL · SEAFOOD · LUNCH',
      footerText: isKo ? 'Ask about today’s market special' : 'Ask about today’s market special',
    },
    T3A: {
      restaurantName: isKo ? 'Neon Umami' : 'Neon Umami',
      tagline: isKo ? 'SUSHI · RAMEN · IZAKAYA · COCKTAILS' : 'SUSHI · RAMEN · IZAKAYA · COCKTAILS',
      footerText: isKo ? 'Order on Your Phone' : 'Order on Your Phone',
    },
    T3B: {
      restaurantName: isKo ? 'Green Line Bowls' : 'Green Line Bowls',
      tagline: isKo ? 'BOWLS · TACOS · WINGS' : 'BOWLS · TACOS · WINGS',
      footerText: isKo ? 'Fast picks for dine-in and takeout' : 'Fast picks for dine-in and takeout',
    },
    T3C: {
      restaurantName: isKo ? 'Copper Room Pub' : 'Copper Room Pub',
      tagline: isKo ? 'COCKTAILS · TAPAS · HAPPY HOUR' : 'COCKTAILS · TAPAS · HAPPY HOUR',
      footerText: isKo ? 'Evening specials available at the bar' : 'Evening specials available at the bar',
    },
  };

  const common = {
    restaurantName: brandPresets[id]?.restaurantName || (isKo ? '한소반' : 'Hansoban'),
    logoSrc: null,
    tagline: brandPresets[id]?.tagline || 'DINE-IN · TAKEOUT · DELIVERY',
    phone: '+1 555 123 4567',
    website: 'yourrestaurant.com',
    orderUrl: '',
    qrSrc: null,
    footerText: brandPresets[id]?.footerText || (isKo ? 'Fresh food made daily' : 'Fresh food made daily'),
    photos: makeTemplatePhotoSet(id, baseStyle.accentColor),
    caption: isKo ? '대표 음식 사진 업로드' : 'Upload featured food photo',
  };

  const listSamples = {
    T1A: [
      [isKo ? 'Prime Ribeye 12oz' : 'Prime Ribeye 12oz', '36.00'],
      [isKo ? 'New York Strip' : 'New York Strip', '34.00'],
      [isKo ? 'Filet Mignon' : 'Filet Mignon', '39.00'],
      [isKo ? 'Garlic Butter Salmon' : 'Garlic Butter Salmon', '28.00'],
      [isKo ? 'Truffle Mac & Cheese' : 'Truffle Mac & Cheese', '12.00'],
      [isKo ? 'Charred Broccolini' : 'Charred Broccolini', '10.00'],
      [isKo ? 'House Caesar' : 'House Caesar', '11.00'],
      [isKo ? 'French Onion Soup' : 'French Onion Soup', '9.00'],
      [isKo ? 'Red Wine Flight' : 'Red Wine Flight', '16.00'],
      [isKo ? 'Chocolate Lava Cake' : 'Chocolate Lava Cake', '11.00'],
    ],
    T1B: [
      [isKo ? 'Double Smash Combo' : 'Double Smash Combo', '12.99'],
      [isKo ? 'Crispy Chicken Combo' : 'Crispy Chicken Combo', '13.99'],
      [isKo ? 'Spicy Fish Sandwich' : 'Spicy Fish Sandwich', '11.99'],
      [isKo ? 'Classic Cheeseburger' : 'Classic Cheeseburger', '9.99'],
      [isKo ? 'Loaded Chili Fries' : 'Loaded Chili Fries', '6.99'],
      [isKo ? 'Mozzarella Sticks' : 'Mozzarella Sticks', '5.99'],
      [isKo ? 'Kids Burger Meal' : 'Kids Burger Meal', '6.99'],
      [isKo ? 'Fountain Drink' : 'Fountain Drink', '2.99'],
      [isKo ? 'Milkshake' : 'Milkshake', '4.99'],
      [isKo ? 'Extra Sauce' : 'Extra Sauce', '0.99'],
    ],
    T1C: [
      [isKo ? 'Honey Oat Latte' : 'Honey Oat Latte', '5.95'],
      [isKo ? 'Cold Brew Cream' : 'Cold Brew Cream', '5.75'],
      [isKo ? 'Matcha Cloud Latte' : 'Matcha Cloud Latte', '6.25'],
      [isKo ? 'Avocado Toast' : 'Avocado Toast', '10.50'],
      [isKo ? 'Smoked Salmon Bagel' : 'Smoked Salmon Bagel', '12.95'],
      [isKo ? 'Tomato Basil Soup' : 'Tomato Basil Soup', '7.95'],
      [isKo ? 'Butter Croissant' : 'Butter Croissant', '4.75'],
      [isKo ? 'Almond Danish' : 'Almond Danish', '5.50'],
      [isKo ? 'Lemon Tea' : 'Lemon Tea', '4.95'],
      [isKo ? 'Sparkling Ade' : 'Sparkling Ade', '5.25'],
    ],
  };

  const photoSamples = {
    T2A: [
      [isKo ? '갈비 BBQ 플래터' : 'Galbi BBQ Platter', '29.99'],
      [isKo ? '삼겹살 세트' : 'Pork Belly Set', '24.99'],
      [isKo ? '불고기 라이스볼' : 'Bulgogi Rice Bowl', '15.99'],
      [isKo ? '김치찌개' : 'Kimchi Stew', '13.99'],
      [isKo ? '순두부찌개' : 'Soft Tofu Stew', '12.99'],
      [isKo ? '해물칼국수' : 'Seafood Knife Noodles', '16.99'],
      [isKo ? '왕만두' : 'King Dumplings', '9.99'],
      [isKo ? '파전' : 'Scallion Pancake', '14.99'],
      [isKo ? '잡채' : 'Japchae', '15.99'],
      [isKo ? '식혜' : 'Sweet Rice Punch', '4.99'],
    ],
    T2B: [
      [isKo ? 'Smash Burger Combo' : 'Smash Burger Combo', '12.99'],
      [isKo ? 'Hot Chicken Combo' : 'Hot Chicken Combo', '13.99'],
      [isKo ? 'Bacon BBQ Burger' : 'Bacon BBQ Burger', '11.99'],
      [isKo ? 'Family Chicken Box' : 'Family Chicken Box', '38.99'],
      [isKo ? 'Tender Basket' : 'Tender Basket', '10.99'],
      [isKo ? 'Loaded Fries' : 'Loaded Fries', '6.99'],
      [isKo ? 'Taco Trio' : 'Taco Trio', '10.99'],
      [isKo ? 'Mac & Cheese' : 'Mac & Cheese', '4.99'],
      [isKo ? 'House Lemonade' : 'House Lemonade', '3.99'],
      [isKo ? 'Soft Serve Cup' : 'Soft Serve Cup', '3.49'],
    ],
    T2C: [
      [isKo ? 'Market Seafood Plate' : 'Market Seafood Plate', '24.99'],
      [isKo ? 'Grilled Shrimp Bowl' : 'Grilled Shrimp Bowl', '17.99'],
      [isKo ? 'Citrus Salmon' : 'Citrus Salmon', '21.99'],
      [isKo ? 'Weekend Brunch Board' : 'Weekend Brunch Board', '16.99'],
      [isKo ? 'Lobster Roll' : 'Lobster Roll', '19.99'],
      [isKo ? 'Truffle Fries' : 'Truffle Fries', '8.99'],
      [isKo ? 'Strawberry Fizz' : 'Strawberry Fizz', '5.99'],
      [isKo ? 'House Lemonade' : 'House Lemonade', '4.99'],
      [isKo ? 'Key Lime Tart' : 'Key Lime Tart', '7.99'],
      [isKo ? 'Chef’s Dessert' : 'Chef’s Dessert', '8.99'],
    ],
  };

  const gridSamples = {
    T3A: [
      [isKo ? '오마카세 롤' : 'Omakase Roll', '18.00'],
      [isKo ? '스파이시 튜나 크리스피' : 'Spicy Tuna Crispy', '16.00'],
      [isKo ? '연어 유즈 사시미' : 'Salmon Yuzu Sashimi', '19.00'],
      [isKo ? '블랙마늘 라멘' : 'Black Garlic Ramen', '17.00'],
      [isKo ? '탄탄멘' : 'Tantanmen', '16.00'],
      [isKo ? '쇼유 치킨 라멘' : 'Shoyu Chicken Ramen', '15.00'],
      [isKo ? '가라아게 바오' : 'Karaage Bao', '12.00'],
      [isKo ? '와규 고추장 타코' : 'Wagyu Gochujang Taco', '15.00'],
      [isKo ? '김치 프라이즈' : 'Kimchi Fries', '11.00'],
      [isKo ? '유자 하이볼' : 'Yuzu Highball', '12.00'],
    ],
    T3B: [
      [isKo ? 'Chicken Bowl' : 'Chicken Bowl', '11.99'],
      [isKo ? 'Steak Bowl' : 'Steak Bowl', '14.99'],
      [isKo ? 'Veggie Bowl' : 'Veggie Bowl', '10.99'],
      [isKo ? 'Street Tacos' : 'Street Tacos', '9.99'],
      [isKo ? 'Quesadilla' : 'Quesadilla', '10.99'],
      [isKo ? 'Nachos' : 'Nachos', '8.99'],
      [isKo ? 'Buffalo Wings' : 'Buffalo Wings', '12.99'],
      [isKo ? 'Garlic Fries' : 'Garlic Fries', '4.99'],
      [isKo ? 'Soft Drink' : 'Soft Drink', '2.99'],
      [isKo ? 'Kids Bowl' : 'Kids Bowl', '7.99'],
      [isKo ? 'Extra Protein' : 'Extra Protein', '3.99'],
      [isKo ? 'Side Salad' : 'Side Salad', '5.99'],
    ],
    T3C: [
      [isKo ? 'Signature Cocktail' : 'Signature Cocktail', '13.00'],
      [isKo ? 'Smoked Old Fashioned' : 'Smoked Old Fashioned', '15.00'],
      [isKo ? 'House Wine' : 'House Wine', '9.00'],
      [isKo ? 'Craft Beer' : 'Craft Beer', '8.00'],
      [isKo ? 'Charcuterie' : 'Charcuterie', '18.00'],
      [isKo ? 'Truffle Pasta' : 'Truffle Pasta', '22.00'],
      [isKo ? 'Steak Skewers' : 'Steak Skewers', '16.00'],
      [isKo ? 'Happy Hour Set' : 'Happy Hour Set', '16.00'],
      [isKo ? 'Bar Snacks' : 'Bar Snacks', '7.00'],
      [isKo ? 'Dessert Plate' : 'Dessert Plate', '12.00'],
    ],
  };

  const sampleExtensions = {
    T1A: [
      ['Burrata & Tomato', '14.00'],
      ['Crispy Calamari', '15.00'],
      ['Wagyu Meatballs', '16.00'],
      ['Bone-In Ribeye', '49.00'],
      ['Braised Short Rib', '32.00'],
      ['Herb Roasted Chicken', '24.00'],
      ['Wild Mushroom Risotto', '22.00'],
      ['Lobster Linguine', '35.00'],
      ['Creamed Spinach', '9.00'],
      ['Yukon Mash', '8.00'],
      ['Parmesan Fries', '7.00'],
      ['Grilled Asparagus', '10.00'],
      ['Wedge Salad', '12.00'],
      ['Lobster Bisque', '13.00'],
      ['Beet & Goat Cheese', '11.00'],
      ['Tiramisu', '10.00'],
      ['Creme Brulee', '10.00'],
      ['Espresso Martini', '14.00'],
      ['Cabernet Glass', '15.00'],
      ['Sparkling Water', '4.00'],
    ],
    T1B: [
      ['Triple Stack Combo', '14.99'],
      ['BBQ Bacon Combo', '13.99'],
      ['Grilled Chicken Combo', '12.99'],
      ['Nashville Chicken', '11.99'],
      ['Mushroom Swiss Burger', '10.99'],
      ['Jalapeno Burger', '10.99'],
      ['Crispy Fish Combo', '12.99'],
      ['Chicken Nugget Meal', '7.99'],
      ['Onion Rings', '4.99'],
      ['Seasoned Fries', '3.99'],
      ['Cheese Curds', '5.99'],
      ['Side Salad', '4.99'],
      ['Chocolate Shake', '4.99'],
      ['Strawberry Shake', '4.99'],
      ['Iced Tea', '2.99'],
      ['Lemonade', '3.25'],
      ['Family Burger Pack', '34.99'],
      ['Chicken Tender Pack', '29.99'],
      ['Extra Patty', '2.99'],
      ['Dipping Sauce', '0.75'],
    ],
    T1C: [
      ['Vanilla Cappuccino', '5.75'],
      ['Espresso Macchiato', '4.25'],
      ['Rose Milk Tea', '5.95'],
      ['Chai Latte', '5.75'],
      ['Breakfast Sandwich', '8.95'],
      ['Spinach Feta Wrap', '9.50'],
      ['Turkey Pesto Panini', '11.50'],
      ['Greek Yogurt Bowl', '8.95'],
      ['Blueberry Muffin', '4.50'],
      ['Chocolate Croissant', '5.25'],
      ['Cinnamon Roll', '5.50'],
      ['Banana Bread', '4.75'],
      ['Iced Jasmine Tea', '4.95'],
      ['Mint Lemonade', '5.25'],
      ['Hot Chocolate', '4.95'],
      ['Seasonal Ade', '5.95'],
      ['Soup & Toast Set', '12.95'],
      ['Brunch Plate', '14.95'],
      ['Fruit Tart', '6.95'],
      ['Cookie Pair', '5.25'],
    ],
    T2A: [
      [isKo ? '돌솥비빔밥' : 'Stone Pot Bibimbap', '15.99'],
      [isKo ? '제육볶음' : 'Spicy Pork Bulgogi', '16.99'],
      [isKo ? 'LA 갈비' : 'LA Galbi', '27.99'],
      [isKo ? '양념치킨' : 'Korean Fried Chicken', '18.99'],
      [isKo ? '된장찌개' : 'Soybean Stew', '12.99'],
      [isKo ? '육개장' : 'Spicy Beef Soup', '14.99'],
      [isKo ? '설렁탕' : 'Ox Bone Soup', '13.99'],
      [isKo ? '부대찌개' : 'Army Stew', '18.99'],
      [isKo ? '비빔냉면' : 'Spicy Cold Noodles', '14.99'],
      [isKo ? '물냉면' : 'Cold Noodles', '13.99'],
      [isKo ? '짜장면' : 'Black Bean Noodles', '12.99'],
      [isKo ? '짬뽕' : 'Spicy Seafood Noodles', '14.99'],
      [isKo ? '떡볶이' : 'Tteokbokki', '12.99'],
      [isKo ? '김밥' : 'Kimbap', '9.99'],
      [isKo ? '두부김치' : 'Tofu Kimchi', '15.99'],
      [isKo ? '계란찜' : 'Steamed Egg', '8.99'],
      [isKo ? '보쌈' : 'Bossam', '29.99'],
      [isKo ? '족발' : 'Jokbal', '31.99'],
      [isKo ? '막걸리' : 'Makgeolli', '8.99'],
      [isKo ? '수정과' : 'Cinnamon Punch', '4.99'],
      [isKo ? '호떡' : 'Hotteok', '6.99'],
      [isKo ? '빙수' : 'Bingsu', '12.99'],
      [isKo ? '콘치즈' : 'Corn Cheese', '8.99'],
      [isKo ? '감자전' : 'Potato Pancake', '13.99'],
      [isKo ? '오징어볶음' : 'Spicy Squid', '18.99'],
      [isKo ? '해물파전' : 'Seafood Pancake', '16.99'],
    ],
    T2B: [
      ['Double Cheeseburger', '10.99'],
      ['Mushroom Swiss Stack', '11.99'],
      ['Crispy Fish Burger', '10.99'],
      ['Spicy Chicken Sandwich', '10.99'],
      ['Buffalo Tender Combo', '12.99'],
      ['Honey Garlic Wings', '11.99'],
      ['Chicken & Fries Box', '16.99'],
      ['BBQ Chicken Melt', '11.99'],
      ['Chili Cheese Fries', '7.99'],
      ['Garlic Parmesan Fries', '5.99'],
      ['Onion Ring Basket', '5.99'],
      ['Side Mac Bowl', '4.99'],
      ['Kids Cheeseburger', '6.99'],
      ['Kids Tender Meal', '6.99'],
      ['Cookie Shake', '5.49'],
      ['Brownie Sundae', '5.99'],
      ['Classic Cola', '2.99'],
      ['Strawberry Lemonade', '3.99'],
      ['Sweet Tea', '2.99'],
      ['Extra Sauce Cup', '0.75'],
      ['Family Burger Tray', '32.99'],
      ['Twenty Wing Pack', '28.99'],
      ['Late Night Combo', '14.99'],
      ['Lunch Smash Special', '9.99'],
      ['Loaded Nacho Fries', '8.99'],
      ['Grilled Chicken Wrap', '10.99'],
    ],
    T2C: [
      ['Crab Cake Starter', '15.99'],
      ['Tuna Poke Cup', '13.99'],
      ['Coconut Shrimp', '12.99'],
      ['Clam Chowder', '8.99'],
      ['Fish Taco Plate', '14.99'],
      ['Blackened Mahi', '23.99'],
      ['Scallop Risotto', '25.99'],
      ['Cajun Pasta', '18.99'],
      ['Brunch Benedict', '15.99'],
      ['Avocado Grain Bowl', '13.99'],
      ['Chicken Sandwich', '12.99'],
      ['Market Salad', '11.99'],
      ['Blueberry Spritz', '5.99'],
      ['Cucumber Cooler', '5.99'],
      ['Cold Brew Tonic', '5.50'],
      ['Mint Iced Tea', '4.99'],
      ['Chocolate Mousse', '7.99'],
      ['Coconut Flan', '7.99'],
      ['Seasonal Sorbet', '6.99'],
      ['Warm Brownie', '8.99'],
      ['Chef Seafood Tower', '39.99'],
      ['Family Fish Basket', '32.99'],
      ['Lunch Salmon Box', '16.99'],
      ['Weekend Oyster Set', '22.99'],
      ['Grilled Veggie Plate', '14.99'],
      ['House Bread Basket', '5.99'],
    ],
    T3A: [
      [isKo ? '하마치 타르타르' : 'Hamachi Tartare', '18.00'],
      [isKo ? '크리스피 라이스' : 'Crispy Rice', '14.00'],
      [isKo ? '드래곤 롤' : 'Dragon Roll', '17.00'],
      [isKo ? '스캘럽 니기리' : 'Scallop Nigiri', '16.00'],
      [isKo ? '미소 버터 콘' : 'Miso Butter Corn', '9.00'],
      [isKo ? '에다마메 칠리' : 'Chili Edamame', '8.00'],
      [isKo ? '스파이시 돈코츠' : 'Spicy Tonkotsu', '17.00'],
      [isKo ? '해산물 우동' : 'Seafood Udon', '18.00'],
      [isKo ? '야키소바' : 'Yakisoba', '15.00'],
      [isKo ? '포크 카츠 산도' : 'Pork Katsu Sando', '14.00'],
      [isKo ? '비프 타다키' : 'Beef Tataki', '22.00'],
      [isKo ? '칠리 크랩 누들' : 'Chili Crab Noodles', '24.00'],
      [isKo ? '트러플 교자' : 'Truffle Gyoza', '13.00'],
      [isKo ? '연어 포케볼' : 'Salmon Poke Bowl', '18.00'],
      [isKo ? '시소 칵테일' : 'Shiso Spritz', '13.00'],
      [isKo ? '매실 마티니' : 'Plum Martini', '14.00'],
      [isKo ? '말차 티라미수' : 'Matcha Tiramisu', '11.00'],
      [isKo ? '모찌 아이스크림' : 'Mochi Ice Cream', '9.00'],
      [isKo ? '흑임자 판나코타' : 'Black Sesame Panna Cotta', '10.00'],
      [isKo ? '셰프 사케 플라이트' : 'Chef Sake Flight', '19.00'],
      [isKo ? '라임 소다' : 'Lime Soda', '6.00'],
      [isKo ? '망고 유자 에이드' : 'Mango Yuzu Ade', '7.00'],
      [isKo ? '타이 바질 누들' : 'Thai Basil Noodles', '16.00'],
      [isKo ? '칠리 새우 바오' : 'Chili Shrimp Bao', '13.00'],
      [isKo ? '아보카도 크런치 롤' : 'Avocado Crunch Roll', '14.00'],
      [isKo ? '토치드 살몬 롤' : 'Torched Salmon Roll', '18.00'],
    ],
    T3B: [
      ['Salmon Bowl', '15.99'],
      ['Tofu Bowl', '10.99'],
      ['Shrimp Bowl', '13.99'],
      ['Carnitas Tacos', '10.99'],
      ['Chicken Tacos', '9.99'],
      ['Veggie Tacos', '8.99'],
      ['Honey Wings', '12.99'],
      ['Korean Wings', '13.99'],
      ['Lemon Pepper Wings', '12.99'],
      ['Street Corn', '4.99'],
      ['Chips & Salsa', '3.99'],
      ['Loaded Nachos', '8.99'],
      ['Protein Add-On', '3.99'],
      ['Guacamole', '2.99'],
      ['Rice & Beans', '4.99'],
      ['Fountain Drink', '2.99'],
      ['Agua Fresca', '3.99'],
      ['Iced Tea', '2.99'],
      ['Combo Upgrade', '3.99'],
      ['Family Taco Kit', '29.99'],
      ['Kids Quesadilla', '6.99'],
      ['Side Tortillas', '1.99'],
      ['Hot Sauce Flight', '1.99'],
      ['Chocolate Churros', '5.99'],
    ],
    T3C: [
      ['Negroni', '13.00'],
      ['Mezcal Margarita', '14.00'],
      ['French 75', '13.00'],
      ['Espresso Martini', '15.00'],
      ['Local IPA', '8.00'],
      ['Amber Lager', '7.00'],
      ['Sparkling Wine', '10.00'],
      ['Zero-Proof Spritz', '8.00'],
      ['Whipped Feta', '11.00'],
      ['Crispy Brussels', '10.00'],
      ['Garlic Shrimp', '16.00'],
      ['Mini Sliders', '14.00'],
      ['Short Rib Pasta', '24.00'],
      ['Salmon Plate', '23.00'],
      ['Mushroom Flatbread', '16.00'],
      ['Pub Steak Frites', '29.00'],
      ['Happy Hour Wings', '9.00'],
      ['Half-Off Flatbread', '8.00'],
      ['Late Night Fries', '6.00'],
      ['Dessert Cocktail', '14.00'],
      ['Chocolate Pot', '9.00'],
      ['Cheese Board', '18.00'],
      ['Chef Tapas Trio', '21.00'],
      ['Bar Burger', '15.00'],
      ['Seasonal Draft', '7.00'],
      ['House Sangria', '10.00'],
    ],
  };

  const structuredSamples = {
    T2B: [
      ['Smash Burger Combo', '12.99'],
      ['Bacon BBQ Burger', '11.99'],
      ['Double Cheeseburger', '10.99'],
      ['Mushroom Swiss Stack', '11.99'],
      ['Crispy Fish Burger', '10.99'],
      ['Lunch Smash Special', '9.99'],
      ['Jalapeno Burger', '10.99'],
      ['Classic Cheeseburger', '9.99'],
      ['BBQ Smokehouse Burger', '12.99'],
      ['Hot Chicken Combo', '13.99'],
      ['Family Chicken Box', '38.99'],
      ['Tender Basket', '10.99'],
      ['Spicy Chicken Sandwich', '10.99'],
      ['Buffalo Tender Combo', '12.99'],
      ['Honey Garlic Wings', '11.99'],
      ['Chicken & Fries Box', '16.99'],
      ['BBQ Chicken Melt', '11.99'],
      ['Twenty Wing Pack', '28.99'],
      ['Loaded Fries', '6.99'],
      ['Mac & Cheese', '4.99'],
      ['Chili Cheese Fries', '7.99'],
      ['Garlic Parmesan Fries', '5.99'],
      ['Onion Ring Basket', '5.99'],
      ['Side Mac Bowl', '4.99'],
      ['House Lemonade', '3.99'],
      ['Cookie Shake', '5.49'],
      ['Classic Cola', '2.99'],
    ],
  };

  const sectionPresets = {
    T1A: ['APPETIZERS', 'STEAK', 'SEAFOOD', 'PASTA', 'DESSERT', 'WINE'],
    T1B: ['COMBOS', 'BURGERS', 'SIDES', 'DRINKS'],
    T1C: ['COFFEE', 'BRUNCH', 'BAKERY', 'TEA'],
    T2A: ['SIGNATURE', 'BBQ', 'SOUP', 'NOODLES', 'SHAREABLES', 'DESSERT'],
    T2B: ['BURGERS', 'CHICKEN', 'SIDES & DRINKS'],
    T2C: ['MARKET', 'BRUNCH', 'DRINKS', 'DESSERT'],
    T3A: ['SUSHI', 'RAMEN', 'IZAKAYA', 'COCKTAILS', 'DESSERT'],
    T3B: ['BOWLS', 'TACOS', 'WINGS', 'SIDES'],
    T3C: ['COCKTAILS', 'DRINKS', 'TAPAS', 'DINNER'],
  };

  const makeRows = (samples, templateKey, groupKey) => {
    const sections = sectionPresets[templateKey] || [];
    const bucketSize = Math.max(1, Math.ceil((samples?.length || 1) / Math.max(1, sections.length || 1)));
    return samples.map(([name, price], index) => ({
      section: sections[Math.min(sections.length - 1, Math.floor(index / bucketSize))] || '',
      name,
      price,
    }));
  };

  const getTemplateSamples = (templateKey, groupKey) => {
    if (structuredSamples[templateKey]) return structuredSamples[templateKey];
    const base =
      groupKey === 'T1' ? (listSamples[templateKey] || listSamples.T1A) :
      groupKey === 'T2' ? (photoSamples[templateKey] || photoSamples.T2A) :
      (gridSamples[templateKey] || gridSamples.T3A);
    const target = groupKey === 'T1' ? 30 : templateKey === 'T2B' ? 27 : 36;
    return [...base, ...(sampleExtensions[templateKey] || [])].slice(0, target);
  };

  const premiumRows = isPremiumTemplateId(id) ? makePremiumTemplateRows(id, lang) : null;

  if (group === 'T1') {
    return {
      ...common,
      title: titles[id] || (isKo ? '오늘의 메뉴' : 'Today’s Menu'),
      currency: '$',
      style: baseStyle,
      rows: premiumRows || makeRows(getTemplateSamples(id, 'T1'), id, 'T1'),
    };
  }

  if (group === 'T2') {
    return {
      ...common,
      title: titles[id] || (isKo ? '대표 메뉴' : 'Featured Plates'),
      currency: '$',
      style: baseStyle,
      photos: makeTemplatePhotoSet(id, baseStyle.accentColor),
      rows: premiumRows || makeRows(getTemplateSamples(id, 'T2'), id, 'T2'),
      caption: isKo ? '음식 사진 업로드' : 'Upload food photo',
    };
  }

  return {
    ...common,
    title: titles[id] || (isKo ? '메뉴' : 'Menu'),
    currency: '$',
    style: baseStyle,
    columns: id === 'T3B' ? 3 : 2,
    photos: makeTemplatePhotoSet(id, baseStyle.accentColor),
    cells: premiumRows || makeRows(getTemplateSamples(id, 'T3'), id, 'T3'),
  };
}

function makeTemplatePhotoSet(templateKey, accent = '#f8d36a') {
  const realSets = {
    T1A: ['/template-photos/steak-hero.jpg', '/template-photos/steak-board.jpg', '/template-photos/wine.jpg', '/template-photos/steak-hero.jpg'],
    T2A: ['/template-photos/korean-hero.jpg', '/template-photos/korean-table.jpg', '/template-photos/ramen.jpg', '/template-photos/korean-hero.jpg'],
    T3A: ['/template-photos/sushi-hero.jpg', '/template-photos/asian-plate.jpg', '/template-photos/ramen.jpg', '/template-photos/sushi-hero.jpg'],
  };

  if (realSets[templateKey]) {
    return Array.from({ length: MAX_PHOTOS }, (_, index) => realSets[templateKey][index % realSets[templateKey].length]);
  }

  const sets = {
    T1A: [
      ['#2a120b', '#f8d36a', '#6b2b16', 'STEAK'],
      ['#19110d', '#f59e0b', '#7c2d12', 'RIBEYE'],
      ['#24130f', '#fef3c7', '#92400e', 'SALMON'],
      ['#1f130d', '#fde68a', '#78350f', 'PASTA'],
      ['#22160f', '#facc15', '#713f12', 'WINE'],
      ['#120b08', '#eab308', '#854d0e', 'DESSERT'],
      ['#21150e', '#fed7aa', '#7c2d12', 'SIDES'],
      ['#180f0a', '#fbbf24', '#78350f', 'CHEF'],
    ],
    T1B: [
      ['#2b0909', '#fb923c', '#b91c1c', 'BURGER'],
      ['#111827', '#f97316', '#7f1d1d', 'COMBO'],
      ['#1f0a0a', '#facc15', '#dc2626', 'CHICKEN'],
      ['#2a0d0d', '#fdba74', '#991b1b', 'FRIES'],
      ['#160b0b', '#fb7185', '#b45309', 'SHAKE'],
      ['#24100a', '#f59e0b', '#991b1b', 'FISH'],
      ['#0f0f0f', '#fed7aa', '#ef4444', 'KIDS'],
      ['#210909', '#fb923c', '#7c2d12', 'SAUCE'],
    ],
    T1C: [
      ['#0f2f2a', '#5eead4', '#f7f3e9', 'LATTE'],
      ['#17342f', '#fef3c7', '#14b8a6', 'BRUNCH'],
      ['#12342f', '#fde68a', '#0f766e', 'BAKERY'],
      ['#10251f', '#f7f3e9', '#5eead4', 'TEA'],
      ['#19342f', '#bbf7d0', '#0f766e', 'TOAST'],
      ['#102b26', '#fed7aa', '#14b8a6', 'PASTRY'],
      ['#0f2924', '#ccfbf1', '#0f766e', 'COLD'],
      ['#13332e', '#fef9c3', '#2dd4bf', 'CAFE'],
    ],
    T2A: [
      ['#0b0b0b', '#fbbf24', '#7f1d1d', 'K-BBQ'],
      ['#111111', '#fde68a', '#14532d', 'GALBI'],
      ['#080808', '#f97316', '#7c2d12', 'SOUP'],
      ['#121212', '#facc15', '#991b1b', 'NOODLE'],
      ['#0f0f0f', '#fed7aa', '#166534', 'PANCAKE'],
      ['#111827', '#f59e0b', '#7f1d1d', 'BOWL'],
      ['#080808', '#fff7ed', '#b91c1c', 'FRIED'],
      ['#151515', '#fde68a', '#065f46', 'SIDE'],
    ],
    T2B: [
      ['#111827', '#ef4444', '#facc15', 'SMASH'],
      ['#050505', '#fb923c', '#b91c1c', 'CHICKEN'],
      ['#1f0b0b', '#fbbf24', '#991b1b', 'BACON'],
      ['#111111', '#f97316', '#7f1d1d', 'WINGS'],
      ['#140909', '#fde68a', '#ef4444', 'FRIES'],
      ['#0f172a', '#fed7aa', '#b45309', 'TACO'],
      ['#170909', '#fb7185', '#7c2d12', 'SHAKE'],
      ['#09090b', '#facc15', '#dc2626', 'BOX'],
    ],
    T2C: [
      ['#071a2d', '#38bdf8', '#f472b6', 'SEAFOOD'],
      ['#0f2a3a', '#bae6fd', '#0e7490', 'SHRIMP'],
      ['#082f49', '#fde68a', '#0284c7', 'SALMON'],
      ['#112d3d', '#f0f9ff', '#38bdf8', 'BRUNCH'],
      ['#102a35', '#f9a8d4', '#0e7490', 'DRINK'],
      ['#0b2532', '#fed7aa', '#0284c7', 'TART'],
      ['#092236', '#bae6fd', '#155e75', 'FRESH'],
      ['#112b3c', '#fef3c7', '#0891b2', 'MARKET'],
    ],
    T3A: [
      ['#20152f', '#c084fc', '#5eead4', 'COFFEE'],
      ['#101827', '#f0abfc', '#7e22ce', 'MATCHA'],
      ['#18213a', '#fef3c7', '#a855f7', 'CAKE'],
      ['#1f1b35', '#fed7aa', '#9333ea', 'PASTRY'],
      ['#172033', '#ccfbf1', '#7c3aed', 'TEA'],
      ['#1f1630', '#f5d0fe', '#6d28d9', 'ADE'],
      ['#131827', '#fef9c3', '#c084fc', 'DESSERT'],
      ['#211936', '#d9f99d', '#9333ea', 'COLD'],
    ],
    T3B: [
      ['#052e16', '#22c55e', '#facc15', 'BOWL'],
      ['#06110b', '#86efac', '#15803d', 'TACO'],
      ['#062315', '#bbf7d0', '#16a34a', 'WINGS'],
      ['#042014', '#fde68a', '#15803d', 'NACHOS'],
      ['#0a2a18', '#fed7aa', '#16a34a', 'KIDS'],
      ['#051b10', '#a7f3d0', '#15803d', 'DRINK'],
      ['#052317', '#fef3c7', '#22c55e', 'SIDE'],
      ['#061b12', '#86efac', '#14532d', 'FAST'],
    ],
    T3C: [
      ['#120817', '#f472b6', '#fbbf24', 'COCKTAIL'],
      ['#050505', '#fde68a', '#be185d', 'TAPAS'],
      ['#1d0c16', '#f9a8d4', '#92400e', 'BEER'],
      ['#190b12', '#fbbf24', '#db2777', 'PASTA'],
      ['#0f070c', '#fed7aa', '#be185d', 'SLIDER'],
      ['#180814', '#f0abfc', '#92400e', 'HOUR'],
      ['#090909', '#fde68a', '#be185d', 'BAR'],
      ['#160a12', '#f472b6', '#f59e0b', 'NIGHT'],
    ],
  };

  return (sets[templateKey] || sets.T1A).slice(0, MAX_PHOTOS).map((item, index) => {
    const [bg, plate, garnish, label] = item;
    return makeDemoFoodPhoto(bg, plate, garnish || accent, label, index);
  });
}

function makeDemoFoodPhoto(bg, plate, garnish, label, index) {
  const rotate = (index % 2 ? -10 : 8);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="520" viewBox="0 0 720 520">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${bg}"/>
          <stop offset="1" stop-color="#050505"/>
        </linearGradient>
        <radialGradient id="plate" cx="50%" cy="48%" r="45%">
          <stop offset="0" stop-color="#fff7ed"/>
          <stop offset="0.42" stop-color="${plate}"/>
          <stop offset="0.72" stop-color="${garnish}"/>
          <stop offset="1" stop-color="rgba(0,0,0,0)"/>
        </radialGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000" flood-opacity=".45"/>
        </filter>
      </defs>
      <rect width="720" height="520" fill="url(#bg)"/>
      <circle cx="584" cy="82" r="122" fill="${plate}" opacity=".18"/>
      <circle cx="98" cy="430" r="170" fill="${garnish}" opacity=".14"/>
      <g filter="url(#shadow)" transform="rotate(${rotate} 360 260)">
        <ellipse cx="360" cy="270" rx="224" ry="152" fill="#fffaf0"/>
        <ellipse cx="360" cy="270" rx="188" ry="122" fill="url(#plate)"/>
        <circle cx="286" cy="242" r="48" fill="${garnish}" opacity=".9"/>
        <circle cx="408" cy="296" r="64" fill="${plate}" opacity=".9"/>
        <circle cx="456" cy="226" r="38" fill="#fff7ed" opacity=".78"/>
        <path d="M224 319c86 42 232 42 314-6" fill="none" stroke="${bg}" stroke-width="22" stroke-linecap="round" opacity=".30"/>
      </g>
      <rect x="38" y="34" width="212" height="54" rx="10" fill="rgba(0,0,0,.42)" stroke="rgba(255,255,255,.24)"/>
      <text x="60" y="69" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="900" fill="#fff" letter-spacing="1">${label}</text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const styles = {
  container: { width: '100%', height: '100dvh', minHeight: '100vh', background: '#111' },
  imagePreloadSink: {
    position: 'fixed',
    left: -9999,
    top: -9999,
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
    pointerEvents: 'none',
  },
  imagePreloadSinkImg: {
    width: 1,
    height: 1,
    objectFit: 'cover',
    display: 'block',
  },
  loadingScreen: {
    width: '100%',
    height: '100%',
    background: '#111',
    display: 'grid',
    placeItems: 'center',
  },
  loadingText: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: 0,
  },

  setupWrap: {
    width: '100%',
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    padding: 18,
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: 'linear-gradient(145deg, #071014, #111827 58%, #0f172a)',
  },
  setupCard: {
    width: 'min(760px, calc(100vw - 36px))',
    maxHeight: 'calc(100dvh - 36px)',
    background: 'linear-gradient(145deg, rgba(255,255,255,0.98), rgba(240,253,250,0.94))',
    border: '1px solid rgba(255,255,255,0.72)',
    borderRadius: 26,
    padding: 22,
    boxSizing: 'border-box',
    boxShadow: '0 26px 80px rgba(0,0,0,0.38)',
    overflow: 'hidden',
  },
  onboardingCard: {
    width: 'min(1080px, calc(100vw - 36px))',
    maxHeight: 'calc(100dvh - 36px)',
    padding: 16,
    overflow: 'hidden',
  },
  onboardingFreeButton: {
    minHeight: 44,
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 14,
  },
  setupHeader: {
    display: 'grid',
    gap: 7,
    marginBottom: 16,
  },
  setupEyebrow: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  title: { fontSize: 26, lineHeight: 1.05, fontWeight: 1000, marginBottom: 0, color: '#0f172a' },
  desc: { fontSize: 14, lineHeight: 1.45, opacity: 0.85, marginBottom: 0, color: '#334155', fontWeight: 750 },

  dropZone: {
    border: '2px dashed rgba(15,118,110,0.30)',
    borderRadius: 22,
    padding: 22,
    textAlign: 'center',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.15s ease',
    background: 'linear-gradient(145deg, rgba(15,118,110,0.08), rgba(15,23,42,0.04))',
    display: 'grid',
    gap: 9,
    placeItems: 'center',
  },
  dropZoneActive: {
    borderColor: 'rgba(15,118,110,0.92)',
    background: 'linear-gradient(145deg, rgba(20,184,166,0.16), rgba(15,118,110,0.08))',
    transform: 'translateY(-1px)',
  },
  dropIcon: {
    width: 68,
    height: 68,
    borderRadius: 20,
    background: '#0f766e',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontSize: 15,
    fontWeight: 1000,
    boxShadow: '0 18px 34px rgba(15,118,110,0.28)',
  },
  dropText: { fontSize: 18, lineHeight: 1.35, fontWeight: 950, color: '#0f172a' },
  linkLike: {
    display: 'inline-flex',
    marginTop: 6,
    minHeight: 38,
    padding: '0 18px',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f766e',
    color: '#fff',
    fontWeight: 950,
    textDecoration: 'none',
  },
  hint: { marginTop: 0, fontSize: 12, opacity: 0.72, color: '#475569', fontWeight: 800 },
  setupUploadMessage: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: 850,
    color: '#0f766e',
    textAlign: 'center',
  },
  setupUploadMessageBusy: {
    color: '#0369a1',
  },
  smallNote: { marginTop: 12, fontSize: 12, opacity: 0.76, color: '#475569', fontWeight: 800, textAlign: 'center' },

  stage: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'transparent',
  },

  viewNoSelect: {
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitTapHighlightColor: 'transparent',
  },

  viewportMover: {
    position: 'relative',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
  },

  viewTrackWrap: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },

  viewTrack: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    willChange: 'transform',
    transform: 'translateZ(0)',
  },

  viewPageFrame: {
    position: 'relative',
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  viewPageSurface: {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    background: 'transparent',
    willChange: 'box-shadow',
  },

  viewPageBg: {
    position: 'absolute',
    inset: 0,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'top center',
    backgroundSize: '100% 100%',
    zIndex: 1,
  },

  viewPageMask: {
    position: 'relative',
    zIndex: 2,
    overflow: 'hidden',
    width: '100%',
    borderRadius: 0,
  },

  editPageFrame: {
    position: 'relative',
    flex: '0 0 auto',
    overflow: 'hidden',
    borderRadius: 0,
    background: '#000',
    boxShadow: 'none',
    outline: 'none',
  },

  editPageMask: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 0,
    background: '#000',
  },

  page: {
    position: 'relative',
    width: PAGE_WIDTH,
    overflow: 'hidden',
    flex: '0 0 auto',
  },

  secretHotspot: {
    position: 'fixed',
    top: 0,
    right: 0,
    width: 140,
    height: 140,
    zIndex: 9990,
    background: 'transparent',
    touchAction: 'none',
  },

  langWrapEdit: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 25px)',
    right: 16,
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-end',
  },

  langWrapView: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 22px)',
    right: 'calc(env(safe-area-inset-right, 0px) + 18px)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-end',
  },

  langRowEdit: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },

  langRowView: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    padding: 5,
    borderRadius: 999,
    background: 'rgba(12,18,32,0.62)',
    border: '1px solid rgba(255,255,255,0.18)',
    boxShadow: '0 14px 34px rgba(0,0,0,0.28)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  },

  langBtn: {
    width: 40,
    height: 32,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.28)',
    background: 'rgba(15,23,42,0.72)',
    cursor: 'pointer',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langBtnActive: {
    border: '1px solid rgba(255,255,255,0.92)',
    background: 'rgba(15,118,110,0.82)',
  },

  langBtnView: {
    minWidth: 64,
    height: 34,
    padding: '0 10px',
    borderRadius: 999,
    border: '1px solid transparent',
    background: 'transparent',
    color: '#f8fafc',
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    boxShadow: 'none',
    fontWeight: 950,
    letterSpacing: 0,
    transition: 'background 160ms ease, color 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
  },
  langBtnActiveView: {
    border: '1px solid rgba(255,255,255,0.78)',
    background: 'rgba(255,255,255,0.92)',
    color: '#0f172a',
    boxShadow: '0 8px 18px rgba(0,0,0,0.20)',
  },
  langBtnDisabled: {
    opacity: 0.62,
    cursor: 'wait',
  },

  langFlag: {
    fontSize: 18,
    lineHeight: 1,
    transform: 'translateY(-0.5px)',
  },

  langCode: {
    fontSize: 12,
    lineHeight: 1,
    fontWeight: 950,
  },

  switchingLangPill: {
    padding: '7px 10px',
    borderRadius: 999,
    background: 'rgba(15,23,42,0.82)',
    border: '1px solid rgba(255,255,255,0.18)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 900,
    boxShadow: '0 10px 22px rgba(0,0,0,0.26)',
    backdropFilter: 'blur(8px)',
  },

  templateNotice: {
    position: 'fixed',
    left: '50%',
    top: 'calc(env(safe-area-inset-top, 0px) + 18px)',
    transform: 'translateX(-50%)',
    zIndex: 100000,
    width: 'min(620px, calc(100vw - 28px))',
    padding: '13px 18px',
    borderRadius: 16,
    background: 'rgba(15,23,42,0.94)',
    border: '1px solid rgba(255,255,255,0.18)',
    color: '#fff',
    fontSize: 14,
    lineHeight: 1.35,
    fontWeight: 850,
    textAlign: 'center',
    boxShadow: '0 18px 42px rgba(0,0,0,0.32)',
    backdropFilter: 'blur(12px)',
  },

  editorMenuBar: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 66px)',
    right: 16,
    zIndex: 99998,
  },

  editMenu: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 112px)',
    right: 16,
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'stretch',
    width: 'min(286px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 150px)',
    overflowY: 'auto',
    padding: 12,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(17,24,39,0.10)',
    backdropFilter: 'blur(10px)',
    boxShadow: '0 18px 42px rgba(0,0,0,0.24)',
  },

  previewBar: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 9999,
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'nowrap',
  },

  templateActionBar: {
    position: 'fixed',
    left: '50%',
    bottom: 16,
    transform: 'translateX(-50%)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'nowrap',
    padding: 8,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid rgba(17,24,39,0.12)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.24)',
    backdropFilter: 'blur(10px)',
  },

  menuBtn: {
    padding: '11px 14px',
    borderRadius: 10,
    border: '1px solid #d1d5db',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#fff',
    color: '#111827',
    whiteSpace: 'nowrap',
  },

  menuBtnDark: {
    padding: '11px 14px',
    borderRadius: 10,
    border: '1px solid rgba(15,118,110,0.22)',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#0f766e',
    color: '#fff',
    whiteSpace: 'nowrap',
    boxShadow: '0 10px 26px rgba(0,0,0,0.18)',
  },

  editBtn: {
    alignSelf: 'flex-end',
    padding: '11px 15px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.22)',
    cursor: 'pointer',
    fontWeight: 900,
    background: 'rgba(15,23,42,0.78)',
    color: '#fff',
    boxShadow: '0 12px 26px rgba(0,0,0,0.34)',
    minWidth: 88,
  },

  editActionsRow: {
    display: 'flex',
    gap: 8,
  },

  logoutBtn: {
    alignSelf: 'flex-end',
    padding: '11px 15px',
    borderRadius: 999,
    border: '1px solid rgba(248,113,113,0.40)',
    cursor: 'pointer',
    fontWeight: 900,
    background: 'rgba(127,29,29,0.84)',
    color: '#fff',
    boxShadow: '0 12px 26px rgba(0,0,0,0.34)',
    minWidth: 88,
  },

  pagePill: {
    position: 'fixed',
    left: '50%',
    top: 'calc(env(safe-area-inset-top, 0px) + 28px)',
    transform: 'translateX(-50%)',
    zIndex: 99990,
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(15,23,42,0.78)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 950,
    boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
    backdropFilter: 'blur(8px)',
  },

  pageNavBtn: {
    position: 'fixed',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 99990,
    width: 42,
    height: 54,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(15,23,42,0.72)',
    color: '#fff',
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 12px 28px rgba(0,0,0,0.30)',
    backdropFilter: 'blur(8px)',
    display: 'grid',
    placeItems: 'center',
    padding: 0,
  },
  pageNavLeft: {
    left: 14,
  },
  pageNavRight: {
    right: 14,
  },
  pageNavBtnDisabled: {
    opacity: 0.28,
    cursor: 'not-allowed',
  },

  pageCtrl: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 14,
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    backdropFilter: 'blur(6px)',
  },
  pageCtrlBtn: {
    padding: '8px 10px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.25)',
    cursor: 'pointer',
    fontWeight: 900,
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
    opacity: 1,
  },
  pageCtrlText: {
    fontWeight: 900,
    fontSize: 13,
    opacity: 0.95,
    padding: '0 6px',
    userSelect: 'none',
  },

  viewPageHint: {
    position: 'fixed',
    left: 16,
    top: 'calc(env(safe-area-inset-top, 0px) + 32px)',
    zIndex: 99999,
    minHeight: 44,
    padding: '10px 12px',
    borderRadius: 12,
    background: 'rgba(0,0,0,0.48)',
    color: '#fff',
    fontWeight: 900,
    fontSize: 15,
    display: 'flex',
    alignItems: 'center',
    userSelect: 'none',
  },

  backBtn: {
    width: 34,
    minWidth: 34,
    height: 34,
    padding: 0,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.22)',
    cursor: 'pointer',
    fontWeight: 950,
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    textDecoration: 'none',
    boxShadow: 'none',
    letterSpacing: 0,
  },

  backBtnIcon: {
    width: 24,
    height: 24,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.92)',
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 auto',
  },

  backBtnTriangle: {
    width: 0,
    height: 0,
    borderTop: '4px solid transparent',
    borderBottom: '4px solid transparent',
    borderLeft: '7px solid #0f172a',
    marginLeft: 2,
  },

  badge: {
    position: 'fixed',
    left: 16,
    top: 64,
    zIndex: 150,
    color: '#fff',
    background: 'rgba(0,0,0,0.55)',
    padding: '8px 10px',
    borderRadius: 10,
  },

  tplShowBtn: {
    position: 'fixed',
    left: 16,
    top: 108,
    zIndex: 99999,
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },

  helpHint: {
    position: 'fixed',
    left: 16,
    bottom: 60,
    zIndex: 150,
    color: '#fff',
    background: 'rgba(0,0,0,0.55)',
    padding: 12,
    borderRadius: 12,
    maxWidth: 520,
    whiteSpace: 'pre-line',
  },

  modalBg: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.6)',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    boxSizing: 'border-box',
    zIndex: 3000,
  },
  modal: {
    width: 'min(520px, 92vw)',
    background: '#fff',
    padding: 18,
    borderRadius: 16,
  },
  templateModal: {
    width: 'min(1120px, calc(100vw - 48px))',
    maxHeight: 'calc(100dvh - 48px)',
    overflowY: 'auto',
    padding: 24,
    borderRadius: 18,
    boxShadow: '0 24px 80px rgba(0,0,0,0.30)',
    boxSizing: 'border-box',
  },

  pinInput: {
    width: '100%',
    padding: '12px 12px',
    borderRadius: 12,
    border: '1px solid #ddd',
    fontWeight: 900,
    fontSize: 16,
    letterSpacing: 4,
    boxSizing: 'border-box',
    marginBottom: 8,
  },

  errText: { marginTop: 8, color: '#c00000', fontWeight: 900, fontSize: 13 },
  okText: { marginTop: 8, color: '#0a7a2f', fontWeight: 900, fontSize: 13 },

  primaryBtn: {
    flex: 1,
    padding: '12px 14px',
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#111',
    color: '#fff',
  },
  secondaryBtn: {
    flex: 1,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #ddd',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#fff',
  },
};
