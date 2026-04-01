'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';

const FONTS = [
  { label: 'Pretendard', value: 'Pretendard, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  { label: 'Noto Sans KR', value: '"Noto Sans KR", system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' },
];

const SHAPES = [
  { label: 'Rectangle', value: 'rect' },
  { label: 'Rounded', value: 'rounded' },
  { label: 'Circle', value: 'circle' },
  { label: 'Triangle', value: 'triangle' },
  { label: 'Diamond', value: 'diamond' },
];

const PRESET_KEY = 'MENU_CUSTOM_PRESETS_V1';
const SNAP_THRESHOLD = 4;
const ALIGN_GUIDE_THRESHOLD = 3;
const SPACING_GUIDE_THRESHOLD = 2;
const INSPECTOR_ENABLED = true;
const DEFAULT_BORDER_COLOR = 'rgba(255,255,255,0.22)';

const AUTO_SCROLL_ZONE = 80;
const AUTO_SCROLL_SPEED = 18;

const GUIDE_COLOR = 'rgba(59,130,246,0.68)';
const GUIDE_ACCENT = 'rgba(59,130,246,0.88)';

export default function CustomCanvas({
  items = [],
  onChangeItems,
  onSave,
  onCancel,
  editing = false,
  lang = 'ko',
  inspectorTop = 118,
  uiMode = 'edit',
  scrollRef,
  pageWidth = 1080,
  pageHeight = 2200,
}) {
  const t = useMemo(() => getTexts(lang), [lang]);
  const incomingItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const [draft, setDraft] = useState(incomingItems);
  const [origin, setOrigin] = useState(incomingItems);
  const safeItems = useMemo(() => (Array.isArray(draft) ? draft : []), [draft]);

  const [dirty, setDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedId = selectedIds[0] || null;
  const [isDragging, setIsDragging] = useState(false);

  const [snapOn] = useState(true);

  const [presets, setPresets] = useState([]);
  const [presetSelectedId, setPresetSelectedId] = useState('');

  const [inspectorVisible, setInspectorVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const hideReasonRef = useRef(null);

  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [dragGuides, setDragGuides] = useState([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  const dragAnchorRef = useRef(null);
  const dragSessionRef = useRef(null);
  const layerRef = useRef(null);
  const marqueeBaseSelectionRef = useRef([]);
  const marqueeStartRef = useRef(null);
  const draggedItemRef = useRef(false);
  const dragStartPosRef = useRef(null);
  const suppressNextLayerClickRef = useRef(false);
  const marqueeHasMovedRef = useRef(false);

  const [marquee, setMarquee] = useState(null);

  const selected = useMemo(
    () => safeItems.find((it) => it.id === selectedId) || null,
    [safeItems, selectedId]
  );

  const resolvedBorderColor = useMemo(
    () => (selected ? resolveBorderColor(selected) : DEFAULT_BORDER_COLOR),
    [selected]
  );

  const borderColorValue = useMemo(
    () => normalizeColorInputValue(resolvedBorderColor),
    [resolvedBorderColor]
  );

  const isBorderTransparent = resolvedBorderColor === 'transparent';
  const isEdit = !!editing;
  const isPreview = uiMode === 'preview';

  useEffect(() => {
    setPresets(loadPresets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editing) {
      setIsDragging(false);
      setSelectedIds([]);
      setInspectorVisible(false);
      clearInspectorHideTimer();
      hideReasonRef.current = null;
      setToolbarVisible(false);
      setDragGuides([]);
    } else {
      setInspectorVisible(false);
      setToolbarVisible(false);
      setDragGuides([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    if (isPreview) {
      setSelectedIds([]);
      setInspectorVisible(false);
      clearInspectorHideTimer();
      hideReasonRef.current = null;
      setToolbarVisible(false);
      setDragGuides([]);
    } else if (editing) {
      setInspectorVisible(false);
      setToolbarVisible(false);
      setDragGuides([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, editing]);

  useEffect(() => {
    if (dirty) return;
    setDraft(incomingItems);
    setOrigin(incomingItems);
    setSelectedIds([]);
    setDirty(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
  }, [incomingItems, dirty]);

  const commit = (next, options = {}) => {
    const { skipHistory = false, previousState = safeItems } = options;
    if (!skipHistory) {
      undoStackRef.current.push(previousState);
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      redoStackRef.current = [];
      setHistoryVersion((v) => v + 1);
    }
    setDraft(next);
    setDirty(true);
    onChangeItems?.(next);
  };

  const undo = () => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(safeItems);
    setHistoryVersion((v) => v + 1);
    setDraft(previous);
    setDirty(true);
    onChangeItems?.(previous);
    setSelectedIds((prev) => prev.filter((id) => previous.some((item) => item.id === id)));
  };

  const redo = () => {
    const nextState = redoStackRef.current.pop();
    if (!nextState) return;
    undoStackRef.current.push(safeItems);
    setHistoryVersion((v) => v + 1);
    setDraft(nextState);
    setDirty(true);
    onChangeItems?.(nextState);
    setSelectedIds((prev) => prev.filter((id) => nextState.some((item) => item.id === id)));
  };

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;


  const applyDraftPreview = (next) => {
    setDraft(next);
    setDirty(true);
    onChangeItems?.(next);
  };

  const updateMany = (ids, patch) => {
    const set = new Set(ids);
    const next = safeItems.map((it) => (set.has(it.id) ? { ...it, ...patch } : it));
    commit(next);
  };

  const updateItem = (id, patch) => {
    const next = safeItems.map((it) => (it.id === id ? { ...it, ...patch } : it));
    commit(next);
  };

  const removeMany = (ids) => {
    const set = new Set(ids);
    const next = safeItems.filter((it) => !set.has(it.id));
    commit(next);
    setSelectedIds((prev) => prev.filter((id) => !set.has(id)));
  };

  const newId = () => (crypto.randomUUID?.() || String(Date.now() + Math.random()));

  const autoScrollWhileDrag = (evt) => {
    const sc = scrollRef?.current;
    if (!sc) return;

    const clientY =
      evt?.touches?.[0]?.clientY ??
      evt?.changedTouches?.[0]?.clientY ??
      evt?.clientY;

    if (typeof clientY !== 'number') return;

    const rect = sc.getBoundingClientRect();
    const topZone = rect.top + AUTO_SCROLL_ZONE;
    const bottomZone = rect.bottom - AUTO_SCROLL_ZONE;

    if (clientY < topZone) sc.scrollTop -= AUTO_SCROLL_SPEED;
    else if (clientY > bottomZone) sc.scrollTop += AUTO_SCROLL_SPEED;
  };

  const clearInspectorHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!selected) {
      clearInspectorHideTimer();
      hideReasonRef.current = null;
      setInspectorVisible(false);
    }
  }, [selected]);

  const showInspectorBySelect = () => {
    if (!INSPECTOR_ENABLED || isPreview) return;
    setInspectorVisible(true);
    hideReasonRef.current = 'select';
    clearInspectorHideTimer();
  };

  const showInspectorByAdd = () => {
    if (!INSPECTOR_ENABLED || isPreview) return;
    setInspectorVisible(true);
    hideReasonRef.current = 'add';
    clearInspectorHideTimer();
  };

  const addFoodName = () => {
    if (isPreview) return;
    const id = newId();
    const next = [
      ...safeItems,
      {
        id,
        type: 'text',
        role: 'name',
        x: 60,
        y: 80,
        w: 520,
        h: 90,
        text: t.foodNameDefault,
        fontFamily: FONTS[0].value,
        size: 52,
        color: '#ffffff',
        bold: true,
        italic: false,
        align: 'left',
        opacity: 1,
        z: maxZ(safeItems) + 1,
        locked: false,
        groupId: null,
      },
    ];
    commit(next);
    setSelectedIds([id]);
    showInspectorByAdd();
  };

  const addPrice = () => {
    if (isPreview) return;
    const id = newId();
    const next = [
      ...safeItems,
      {
        id,
        type: 'text',
        role: 'price',
        x: 60,
        y: 180,
        w: 320,
        h: 70,
        text: t.priceDefault,
        fontFamily: FONTS[0].value,
        size: 46,
        color: '#ffffff',
        bold: true,
        italic: false,
        align: 'left',
        opacity: 1,
        z: maxZ(safeItems) + 1,
        locked: false,
        groupId: null,
      },
    ];
    commit(next);
    setSelectedIds([id]);
    showInspectorByAdd();
  };

  const addPhoto = async (file) => {
    if (isPreview || !file) return;
    const src = await fileToDataUrl(file);
    const id = newId();
    const next = [
      ...safeItems,
      {
        id,
        type: 'image',
        x: 80,
        y: 120,
        w: 320,
        h: 240,
        src,
        shape: 'rounded',
        radius: 18,
        fit: 'contain',
        opacity: 1,
        z: maxZ(safeItems) + 1,
        locked: false,
        groupId: null,
      },
    ];
    commit(next);
    setSelectedIds([id]);
    showInspectorByAdd();
  };


  const addVideo = async (file) => {
    if (isPreview || !file) return;
    const src = await fileToDataUrl(file);
    const id = newId();
    const next = [
      ...safeItems,
      {
        id,
        type: 'video',
        x: 80,
        y: 120,
        w: 360,
        h: 240,
        src,
        shape: 'rounded',
        radius: 18,
        fit: 'cover',
        opacity: 1,
        z: maxZ(safeItems) + 1,
        locked: false,
        groupId: null,
        autoplay: true,
        loop: true,
        muted: true,
        playsInline: true,
      },
    ];
    commit(next);
    setSelectedIds([id]);
    showInspectorByAdd();
  };

  const clearSelect = () => {
    setSelectedIds([]);
    clearInspectorHideTimer();
    hideReasonRef.current = null;
    setInspectorVisible(false);
  };

  const pointToLayer = (clientX, clientY) => {
    const layer = layerRef.current;
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height),
    };
  };

  const getMarqueeRect = (start, current) => {
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    return { left, top, width, height };
  };

  const getMarqueeSelectedIds = (rect) => {
    if (!rect) return [];
    return safeItems
      .filter((it) => rectsIntersect(rect, { left: it.x, top: it.y, width: it.w, height: it.h }))
      .map((it) => it.id);
  };

  const startMarqueeSelect = (e) => {
    if (!isEdit || isPreview) return;
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;

    suppressNextLayerClickRef.current = false;
    marqueeHasMovedRef.current = false;

    const point = pointToLayer(e.clientX, e.clientY);
    if (!point) return;

    marqueeBaseSelectionRef.current = e.shiftKey ? selectedIds : [];
    marqueeStartRef.current = point;
    setMarquee({ ...getMarqueeRect(point, point), active: true });

    if (!e.shiftKey) {
      setSelectedIds([]);
      setInspectorVisible(false);
      clearInspectorHideTimer();
      hideReasonRef.current = null;
    }
  };

  const updateMarqueeSelect = (e) => {
    if (!marqueeStartRef.current) return;
    const point = pointToLayer(e.clientX, e.clientY);
    if (!point) return;

    const rect = getMarqueeRect(marqueeStartRef.current, point);
    if (rect.width > 2 || rect.height > 2) {
      marqueeHasMovedRef.current = true;
      suppressNextLayerClickRef.current = true;
    }
    const hitIds = getMarqueeSelectedIds(rect);
    const merged = Array.from(new Set([...(marqueeBaseSelectionRef.current || []), ...hitIds]));

    setMarquee({ ...rect, active: true });
    setSelectedIds(merged);
    if (merged.length) showInspectorBySelect();
  };

  const endMarqueeSelect = () => {
    if (marqueeHasMovedRef.current) {
      suppressNextLayerClickRef.current = true;
    }
    marqueeStartRef.current = null;
    marqueeBaseSelectionRef.current = [];
    marqueeHasMovedRef.current = false;
    setMarquee(null);
  };

  const handleItemClick = (e, itemId) => {
    if (!isEdit || isPreview) return;
    if (draggedItemRef.current) {
      draggedItemRef.current = false;
      return;
    }

    e.stopPropagation();
    setSelectedIds((prev) => {
      if (!e.shiftKey) return [itemId];
      if (prev.includes(itemId)) return prev.filter((x) => x !== itemId);
      return [...prev, itemId];
    });
    showInspectorBySelect();
  };

  const doSave = () => {
    setOrigin(safeItems);
    setDirty(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
    onSave?.(safeItems);
  };

  const doCancel = () => {
    setDraft(origin);
    setDirty(false);
    setSelectedIds([]);
    clearInspectorHideTimer();
    hideReasonRef.current = null;
    setInspectorVisible(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
    onCancel?.(origin);
  };

  useEffect(() => {
    if (!editing || isPreview) return;

    const onKey = (e) => {
      const target = e.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isTypingTarget) return;

      const modKey = e.metaKey || e.ctrlKey;

      if (modKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if (modKey && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
        e.preventDefault();
        removeMany(selectedIds);
      }

      if (selectedIds.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        moveMany(selectedIds, dx, dy);
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        doCancel();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedIds, safeItems, origin, isPreview, historyVersion]);

  useEffect(() => {
    if (!isEdit || isPreview) return;

    const onMove = (e) => updateMarqueeSelect(e);
    const onUp = () => endMarqueeSelect();

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isEdit, isPreview, safeItems, selectedIds]);

  const moveMany = (ids, dx, dy) => {
    const set = new Set(ids);
    const next = safeItems.map((it) => {
      if (!set.has(it.id)) return it;
      if (it.locked) return it;
      return { ...it, x: it.x + dx, y: it.y + dy };
    });
    commit(next);
  };

  const applySnap = (movingId, x, y, w, h) => {
    if (!snapOn) return { x, y, guides: [] };
    return computeDragAssist(movingId, x, y, w, h);
  };

  const clearDragGuides = () => setDragGuides([]);

  const buildSpacingGuides = (movingItem, x, y) => {
    if (!movingItem || movingItem.type !== 'text' || movingItem.role !== 'name') return [];

    const moved = { ...movingItem, x, y };
    const peers = safeItems
      .filter((it) => it.id !== movingItem.id && it.type === 'text' && it.role === 'name')
      .slice()
      .sort((a, b) => a.y - b.y);

    if (peers.length < 2) return [];

    const all = [...peers, moved].sort((a, b) => a.y - b.y);
    const idx = all.findIndex((it) => it.id === moved.id);
    if (idx <= 0 || idx >= all.length - 1) return [];

    const prev = all[idx - 1];
    const next = all[idx + 1];
    const gapAbove = moved.y - (prev.y + prev.h);
    const gapBelow = next.y - (moved.y + moved.h);

    if (gapAbove < -1 || gapBelow < -1) return [];
    if (Math.abs(gapAbove - gapBelow) > SPACING_GUIDE_THRESHOLD) return [];

    const left = Math.min(prev.x, moved.x, next.x);
    const right = Math.max(prev.x + prev.w, moved.x + moved.w, next.x + next.w);
    const centerX = left + (right - left) / 2;

    return [
      {
        kind: 'spacing',
        orientation: 'vertical-segment',
        x: centerX,
        y1: prev.y + prev.h,
        y2: moved.y,
        label: `${Math.round((gapAbove + gapBelow) / 2)}px`,
      },
      {
        kind: 'spacing',
        orientation: 'vertical-segment',
        x: centerX,
        y1: moved.y + moved.h,
        y2: next.y,
        label: `${Math.round((gapAbove + gapBelow) / 2)}px`,
      },
    ];
  };

  const computeDragAssist = (movingId, x, y, w, h) => {
    const movingItem = safeItems.find((it) => it.id === movingId);
    if (!movingItem) return { x, y, guides: [] };

    let nx = x;
    let ny = y;
    const guides = [];
    const others = safeItems.filter((it) => it.id !== movingId);

    const movingLines = {
      left: nx,
      centerX: nx + w / 2,
      right: nx + w,
      top: ny,
      centerY: ny + h / 2,
      bottom: ny + h,
    };

    for (const o of others) {
      const targetLines = {
        left: o.x,
        centerX: o.x + o.w / 2,
        right: o.x + o.w,
        top: o.y,
        centerY: o.y + o.h / 2,
        bottom: o.y + o.h,
      };

      const xPairs = [
        ['left', 'left', targetLines.left],
        ['centerX', 'centerX', targetLines.centerX],
        ['right', 'right', targetLines.right],
      ];
      const yPairs = [
        ['top', 'top', targetLines.top],
        ['centerY', 'centerY', targetLines.centerY],
        ['bottom', 'bottom', targetLines.bottom],
      ];

      for (const [movingKey, targetKey, target] of xPairs) {
        const delta = target - movingLines[movingKey];
        if (Math.abs(delta) <= SNAP_THRESHOLD) {
          nx += delta;
          movingLines.left += delta;
          movingLines.centerX += delta;
          movingLines.right += delta;

          if (Math.abs(delta) <= ALIGN_GUIDE_THRESHOLD) {
            guides.push({
              kind: 'align',
              orientation: 'vertical',
              x: target,
              y1: Math.min(ny, o.y),
              y2: Math.max(ny + h, o.y + o.h),
              target: targetKey,
            });
          }
          break;
        }
      }

      for (const [movingKey, targetKey, target] of yPairs) {
        const delta = target - movingLines[movingKey];
        if (Math.abs(delta) <= SNAP_THRESHOLD) {
          ny += delta;
          movingLines.top += delta;
          movingLines.centerY += delta;
          movingLines.bottom += delta;

          if (Math.abs(delta) <= ALIGN_GUIDE_THRESHOLD) {
            guides.push({
              kind: 'align',
              orientation: 'horizontal',
              y: target,
              x1: Math.min(nx, o.x),
              x2: Math.max(nx + w, o.x + o.w),
              target: targetKey,
            });
          }
          break;
        }
      }
    }

    const spacingGuides = buildSpacingGuides(movingItem, nx, ny);
    if (spacingGuides.length) guides.push(...spacingGuides);

    return { x: Math.round(nx), y: Math.round(ny), guides };
  };

  const lockSelected = () => updateMany(selectedIds, { locked: true });
  const unlockSelected = () => updateMany(selectedIds, { locked: false });

  const groupSelected = () => {
    if (selectedIds.length < 2) return;
    const gid = 'g_' + newId();
    updateMany(selectedIds, { groupId: gid });
  };

  const ungroupSelected = () => updateMany(selectedIds, { groupId: null });

  const bringForward = () => {
    if (!selectedIds.length) return;
    let z = maxZ(safeItems) + 1;
    const set = new Set(selectedIds);
    const next = safeItems.map((it) => {
      if (!set.has(it.id)) return it;
      z += 1;
      return { ...it, z };
    });
    commit(next);
  };

  const sendBackward = () => {
    if (!selectedIds.length) return;
    const set = new Set(selectedIds);
    const next = safeItems.map((it) =>
      set.has(it.id) ? { ...it, z: Math.max(0, (it.z || 0) - 1) } : it
    );
    commit(next);
  };

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const selectedItems = safeItems.filter((it) => selectedIds.includes(it.id));
    let z = maxZ(safeItems) + 1;
    const copies = selectedItems.map((it) => ({
      ...it,
      id: newId(),
      x: it.x + 20,
      y: it.y + 20,
      z: ++z,
      locked: false,
    }));
    commit([...safeItems, ...copies]);
    setSelectedIds(copies.map((c) => c.id));
    showInspectorByAdd();
  };

  const alignLeft = () => {
    if (selectedIds.length < 2) return;
    const sel = safeItems.filter((it) => selectedIds.includes(it.id));
    const minX = Math.min(...sel.map((it) => it.x));
    updateMany(selectedIds, { x: minX });
  };

  const alignRight = () => {
    if (selectedIds.length < 2) return;
    const sel = safeItems.filter((it) => selectedIds.includes(it.id));
    const maxR = Math.max(...sel.map((it) => it.x + it.w));
    const set = new Set(selectedIds);
    const next = safeItems.map((it) => {
      if (!set.has(it.id) || it.locked) return it;
      return { ...it, x: maxR - it.w };
    });
    commit(next);
  };

  const alignCenter = () => {
    if (selectedIds.length < 2) return;
    const sel = safeItems.filter((it) => selectedIds.includes(it.id));
    const center = (Math.min(...sel.map((it) => it.x)) + Math.max(...sel.map((it) => it.x + it.w))) / 2;
    const set = new Set(selectedIds);
    const next = safeItems.map((it) => {
      if (!set.has(it.id) || it.locked) return it;
      return { ...it, x: Math.round(center - it.w / 2) };
    });
    commit(next);
  };

  const alignTop = () => {
    if (selectedIds.length < 2) return;
    const sel = safeItems.filter((it) => selectedIds.includes(it.id));
    const minY = Math.min(...sel.map((it) => it.y));
    updateMany(selectedIds, { y: minY });
  };

  const alignBottom = () => {
    if (selectedIds.length < 2) return;
    const sel = safeItems.filter((it) => selectedIds.includes(it.id));
    const maxB = Math.max(...sel.map((it) => it.y + it.h));
    const set = new Set(selectedIds);
    const next = safeItems.map((it) => {
      if (!set.has(it.id) || it.locked) return it;
      return { ...it, y: maxB - it.h };
    });
    commit(next);
  };

  const alignMiddle = () => {
    if (selectedIds.length < 2) return;
    const sel = safeItems.filter((it) => selectedIds.includes(it.id));
    const mid = (Math.min(...sel.map((it) => it.y)) + Math.max(...sel.map((it) => it.y + it.h))) / 2;
    const set = new Set(selectedIds);
    const next = safeItems.map((it) => {
      if (!set.has(it.id) || it.locked) return it;
      return { ...it, y: Math.round(mid - it.h / 2) };
    });
    commit(next);
  };

  const savePreset = () => {
    if (isPreview) return;
    const name = prompt(t.presetNamePrompt, t.presetNameDefault);
    if (!name) return;

    const all = loadPresets();
    all.push({ id: newId(), name, createdAt: Date.now(), items: safeItems });
    persistPresets(all);
    setPresets(all);
    alert(t.presetSavedAlert);
  };

  const loadPreset = (presetId) => {
    if (isPreview || !INSPECTOR_ENABLED) return;

    const all = loadPresets();
    const p = all.find((x) => x.id === presetId);
    if (!p) return;

    const remapped = p.items.map((it) => ({ ...it, id: newId() }));
    commit(remapped);

    setSelectedIds([]);
    setPresetSelectedId(presetId);

    setInspectorVisible(true);
    hideReasonRef.current = 'add';
    clearInspectorHideTimer();
  };

  const deletePreset = () => {
    if (isPreview) return;
    const id = presetSelectedId;
    if (!id) {
      alert(t.pickPresetFirst);
      return;
    }

    const all = loadPresets();
    const p = all.find((x) => x.id === id);
    if (!p) return;

    const ok = confirm(`${t.deletePresetConfirm}\n\n- ${p.name}`);
    if (!ok) return;

    const next = all.filter((x) => x.id !== id);
    persistPresets(next);
    setPresets(next);
    setPresetSelectedId('');
    alert(t.presetDeletedAlert);
  };

  const beginMultiDrag = (activeId) => {
    const snapshot = safeItems
      .filter((it) => selectedIds.includes(it.id))
      .map((it) => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, locked: !!it.locked }));

    const active = safeItems.find((it) => it.id === activeId);
    dragAnchorRef.current = {
      id: activeId,
      startX: active?.x ?? 0,
      startY: active?.y ?? 0,
      snapshot,
    };
    dragSessionRef.current = {
      type: 'multi',
      activeId,
      startItems: safeItems,
    };
  };

  const buildMultiDragState = (activeId, newX, newY) => {
    const anchor = dragAnchorRef.current;
    if (!anchor || anchor.id !== activeId) return null;

    const dx = newX - anchor.startX;
    const dy = newY - anchor.startY;
    const set = new Set(selectedIds);

    let next = safeItems.map((it) => {
      if (!set.has(it.id) || it.locked) return it;

      const snapBase = anchor.snapshot.find((s) => s.id === it.id);
      if (!snapBase) return it;

      return {
        ...it,
        x: snapBase.x + dx,
        y: snapBase.y + dy,
      };
    });

    const activeItem = safeItems.find((x) => x.id === activeId);
    if (activeItem) {
      const activeSnapBase = anchor.snapshot.find((s) => s.id === activeId);
      if (activeSnapBase) {
        const ax = activeSnapBase.x + dx;
        const ay = activeSnapBase.y + dy;
        const { x: sx, y: sy, guides } = applySnap(activeId, ax, ay, activeItem.w, activeItem.h);
        const fixDx = sx - ax;
        const fixDy = sy - ay;

        next = next.map((it) => {
          if (!set.has(it.id) || it.locked) return it;
          return { ...it, x: it.x + fixDx, y: it.y + fixDy };
        });

        return { next, guides: guides || [] };
      }
    }

    return { next, guides: [] };
  };

  const applyMultiDragPreview = (activeId, newX, newY) => {
    const state = buildMultiDragState(activeId, newX, newY);
    if (!state) return;
    setDragGuides(state.guides || []);
    applyDraftPreview(state.next);
  };

  const applyMultiDragStop = (activeId, newX, newY) => {
    const anchor = dragAnchorRef.current;
    const dragSession = dragSessionRef.current;
    dragAnchorRef.current = null;
    dragSessionRef.current = null;
    clearDragGuides();

    if (!anchor || anchor.id !== activeId) {
      const it = safeItems.find((x) => x.id === activeId);
      if (!it) return;
      const { x: sx, y: sy } = applySnap(activeId, newX, newY, it.w, it.h);
      updateItem(activeId, { x: sx, y: sy });
      return;
    }

    const state = buildMultiDragState(activeId, newX, newY);
    if (!state) return;
    const previousState = dragSession?.startItems || safeItems;
    if (JSON.stringify(previousState) === JSON.stringify(state.next)) return;
    commit(state.next, { previousState });
  };

  return (
    <div style={{ ...styles.root, width: pageWidth, height: pageHeight }}>
      {isEdit && !isPreview && (
        <>
          {!toolbarVisible && (
            <button
              style={styles.toolsOpenBtn}
              onClick={() => setToolbarVisible(true)}
            >
              {t.openTools}
            </button>
          )}

          {toolbarVisible && (
            <div style={styles.toolbarFixed} onMouseDown={(e) => e.stopPropagation()}>
              <div style={styles.toolbarRow}>
                <button style={styles.toolBtn} onClick={addFoodName}>{t.addName}</button>
                <button style={styles.toolBtn} onClick={addPrice}>{t.addPrice}</button>

                <label style={{ ...styles.toolBtn, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {t.addPhoto}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      addPhoto(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>

                <label style={{ ...styles.toolBtn, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {t.addVideo}
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,video/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      addVideo(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>

                <span style={styles.sep} />

                <button style={styles.toolBtnSm} onClick={undo} disabled={!canUndo}>{t.undo}</button>
                <button style={styles.toolBtnSm} onClick={redo} disabled={!canRedo}>{t.redo}</button>

                <span style={styles.sep} />

                <button style={styles.toolBtnSm} onClick={savePreset}>{t.savePreset}</button>

                <select
                  value={presetSelectedId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPresetSelectedId(v);
                    if (v) loadPreset(v);
                  }}
                  style={styles.presetSelect}
                >
                  <option value="">{t.loadPreset}</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <button style={styles.toolBtnSm} onClick={deletePreset}>
                  {t.deletePreset}
                </button>

                <span style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>
                  {dirty ? t.editingNotSaved : t.saved}
                </span>

                <button
                  style={styles.toolbarCloseBtn}
                  onClick={() => setToolbarVisible(false)}
                  aria-label="close-toolbar"
                  title={t.hideTools}
                >
                  ×
                </button>
              </div>
            </div>
          )}

          <div style={styles.saveBar} onMouseDown={(e) => e.stopPropagation()}>
            <button style={{ ...styles.toolBtnSm, minWidth: 72 }} onClick={undo} disabled={!canUndo}>{t.undo}</button>
            <button style={{ ...styles.toolBtnSm, minWidth: 72 }} onClick={redo} disabled={!canRedo}>{t.redo}</button>
            <button style={styles.saveBtn} onClick={doSave}>{t.save}</button>
            <button style={styles.cancelBtn} onClick={doCancel}>{t.cancel}</button>
          </div>
        </>
      )}

      <div
        ref={layerRef}
        style={styles.layer}
        onMouseDown={startMarqueeSelect}
        onClick={(e) => {
          if (!isEdit || isPreview) return;
          if (suppressNextLayerClickRef.current) {
            suppressNextLayerClickRef.current = false;
            return;
          }
          if (e.target === e.currentTarget && !isDragging && !marqueeStartRef.current) clearSelect();
        }}
      >
        {dragGuides.map((guide, index) => (
          <GuideOverlay key={`${guide.kind}-${guide.orientation}-${index}`} guide={guide} />
        ))}

        {marquee?.active && marquee.width > 0 && marquee.height > 0 && (
          <div
            style={{
              ...styles.marquee,
              left: marquee.left,
              top: marquee.top,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}

        {safeItems
          .slice()
          .sort((a, b) => (a.z || 0) - (b.z || 0))
          .map((it) => {
            const isSelected = selectedIds.includes(it.id);
            const isLocked = !!it.locked;

            return (
              <Rnd
                key={it.id}
                bounds="parent"
                size={{ width: it.w, height: it.h }}
                position={{ x: it.x, y: it.y }}
                disableDragging={!isEdit || isLocked || isPreview}
                enableResizing={!isEdit ? false : (isLocked || isPreview ? false : undefined)}
                onMouseDown={(e) => {
                  if (!isEdit || isPreview) return;
                  e.stopPropagation();
                }}
                onClick={(e) => handleItemClick(e, it.id)}
                onDragStart={(e, d) => {
                  if (!isEdit || isPreview) return;
                  draggedItemRef.current = false;
                  dragStartPosRef.current = { x: d.x, y: d.y };
                  dragSessionRef.current = { type: 'single', itemId: it.id, startItems: safeItems };
                  setIsDragging(true);
                  clearDragGuides();

                  if (!selectedIds.includes(it.id)) {
                    setSelectedIds([it.id]);
                  }

                  if (selectedIds.length >= 2 && selectedIds.includes(it.id)) {
                    beginMultiDrag(it.id);
                  } else {
                    dragAnchorRef.current = null;
                  }
                }}
                onDrag={(e, d) => {
                  if (!isEdit || isPreview || isLocked) return;
                  autoScrollWhileDrag(e);

                  const dragStart = dragStartPosRef.current;
                  if (dragStart) {
                    const moved = Math.abs(d.x - dragStart.x) > 5 || Math.abs(d.y - dragStart.y) > 5;
                    if (moved) draggedItemRef.current = true;
                  }

                  if (selectedIds.length >= 2 && selectedIds.includes(it.id)) {
                    applyMultiDragPreview(it.id, d.x, d.y);
                    return;
                  }

                  const assist = computeDragAssist(it.id, d.x, d.y, it.w, it.h);
                  setDragGuides(assist.guides || []);
                  applyDraftPreview(
                    safeItems.map((item) => (item.id === it.id ? { ...item, x: assist.x, y: assist.y } : item))
                  );
                }}
                onResizeStart={() => {
                  if (isEdit && !isPreview) {
                    dragSessionRef.current = { type: 'resize', itemId: it.id, startItems: safeItems };
                    setIsDragging(true);
                    clearDragGuides();
                  }
                }}
                onDragStop={(e, d) => {
                  if (!isEdit || isPreview) return;
                  setIsDragging(false);
                  clearDragGuides();
                  if (isLocked) {
                    dragSessionRef.current = null;
                    return;
                  }

                  const dragStart = dragStartPosRef.current;
                  dragStartPosRef.current = null;
                  const movedEnough = !dragStart || Math.abs(d.x - dragStart.x) > 5 || Math.abs(d.y - dragStart.y) > 5;
                  if (!movedEnough) {
                    dragSessionRef.current = null;
                    return;
                  }

                  if (selectedIds.length >= 2 && selectedIds.includes(it.id)) {
                    applyMultiDragStop(it.id, d.x, d.y);
                    return;
                  }

                  const { x: sx, y: sy } = applySnap(it.id, d.x, d.y, it.w, it.h);
                  const dragSession = dragSessionRef.current;
                  dragSessionRef.current = null;
                  const next = safeItems.map((item) => (item.id === it.id ? { ...item, x: sx, y: sy } : item));
                  const previousState = dragSession?.startItems || safeItems;
                  if (JSON.stringify(previousState) === JSON.stringify(next)) return;
                  commit(next, { previousState });
                }}
                onResizeStop={(e, dir, ref, delta, pos) => {
                  if (!isEdit || isPreview) return;
                  setIsDragging(false);
                  clearDragGuides();
                  if (isLocked) {
                    dragSessionRef.current = null;
                    return;
                  }

                  const w = ref.offsetWidth;
                  const h = ref.offsetHeight;
                  const { x: sx, y: sy } = applySnap(it.id, pos.x, pos.y, w, h);
                  const dragSession = dragSessionRef.current;
                  dragSessionRef.current = null;
                  const next = safeItems.map((item) => (item.id === it.id ? { ...item, w, h, x: sx, y: sy } : item));
                  const previousState = dragSession?.startItems || safeItems;
                  if (JSON.stringify(previousState) === JSON.stringify(next)) return;
                  commit(next, { previousState });
                }}
                style={{ zIndex: it.z || 0 }}
              >
                <ItemBox item={it} selected={isEdit && isSelected && !isPreview} />
              </Rnd>
            );
          })}
      </div>

      {INSPECTOR_ENABLED && isEdit && !isPreview && inspectorVisible && (
        <div
          style={{ ...styles.inspector, top: inspectorTop }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={styles.inspectorTitle}>{t.inspectorTitle}</div>

          {selectedIds.length >= 2 && (
            <div style={styles.multiBox}>
              <div style={styles.multiGrid}>
                <button style={styles.actionBtn} onClick={groupSelected}>{t.group}</button>
                <button style={styles.actionBtn} onClick={ungroupSelected}>{t.ungroup}</button>
                <button style={styles.actionBtn} onClick={duplicateSelected}>{t.duplicate}</button>
                <button style={styles.actionBtn} onClick={bringForward}>{t.bring}</button>
                <button style={styles.actionBtn} onClick={sendBackward}>{t.send}</button>
                <button style={styles.actionBtn} onClick={lockSelected}>{t.lock}</button>
                <button style={styles.actionBtn} onClick={unlockSelected}>{t.unlock}</button>
                <button
                  style={{ ...styles.actionBtn, background: '#ffefef', borderColor: '#ffb7b7' }}
                  onClick={() => removeMany(selectedIds)}
                >
                  {t.delete}
                </button>
              </div>

              <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #eee' }} />
            </div>
          )}

          {selected ? (
            <>
              <div style={styles.row}>
                <div style={styles.label}>{t.type}</div>
                <div style={styles.value}>
                  {selected.type === 'text'
                    ? (selected.role === 'price' ? t.textPrice : t.textName)
                    : selected.type === 'video'
                      ? t.video
                      : t.photo}
                </div>
              </div>

              <div style={styles.row}>
                <div style={styles.label}>{t.locked}</div>
                <button
                  style={toggleBtn(!!selected.locked)}
                  onClick={() => updateItem(selected.id, { locked: !selected.locked })}
                >
                  {selected.locked ? t.lockedOn : t.lockedOff}
                </button>
              </div>

              <div style={styles.row}>
                <div style={styles.label}>{t.opacity}</div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={selected.opacity ?? 1}
                  onChange={(e) => updateItem(selected.id, { opacity: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={styles.row}>
                <div style={styles.label}>{t.borderColor}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={borderColorValue}
                    onChange={(e) => updateItem(selected.id, { borderColor: e.target.value, showBorder: true })}
                    style={{ ...styles.color, flex: 1 }}
                    disabled={selected.locked}
                  />
                  <button
                    type="button"
                    style={{
                      ...styles.transparentBtn,
                      ...(isBorderTransparent ? styles.transparentBtnActive : {}),
                    }}
                    onClick={() => updateItem(selected.id, { borderColor: 'transparent', showBorder: true })}
                    disabled={selected.locked}
                  >
                    {t.transparent}
                  </button>
                </div>
              </div>

              {selected.type === 'text' && (
                <>
                  <div style={styles.rowCol}>
                    <div style={styles.label}>{t.text}</div>
                    <input
                      value={selected.text || ''}
                      onChange={(e) => updateItem(selected.id, { text: e.target.value })}
                      style={styles.input}
                      disabled={selected.locked}
                    />
                  </div>

                  <div style={styles.row}>
                    <div style={styles.label}>{t.font}</div>
                    <select
                      value={selected.fontFamily || FONTS[0].value}
                      onChange={(e) => updateItem(selected.id, { fontFamily: e.target.value })}
                      style={styles.select}
                      disabled={selected.locked}
                    >
                      {FONTS.map((f) => (
                        <option key={f.label} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.row}>
                    <div style={styles.label}>{t.size}</div>
                    <input
                      type="number"
                      value={selected.size || 36}
                      min={10}
                      max={200}
                      onChange={(e) => updateItem(selected.id, { size: Number(e.target.value) })}
                      style={styles.num}
                      disabled={selected.locked}
                    />
                  </div>

                  <div style={styles.row}>
                    <div style={styles.label}>{t.color}</div>
                    <input
                      type="color"
                      value={selected.color || '#ffffff'}
                      onChange={(e) => updateItem(selected.id, { color: e.target.value })}
                      style={styles.color}
                      disabled={selected.locked}
                    />
                  </div>

                  <div style={styles.row}>
                    <div style={styles.label}>{t.style}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={toggleBtn(!!selected.bold)}
                        onClick={() => updateItem(selected.id, { bold: !selected.bold })}
                        disabled={selected.locked}
                      >
                        {t.bold}
                      </button>
                      <button
                        style={toggleBtn(!!selected.italic)}
                        onClick={() => updateItem(selected.id, { italic: !selected.italic })}
                        disabled={selected.locked}
                      >
                        {t.italic}
                      </button>
                    </div>
                  </div>

                  <div style={styles.row}>
                    <div style={styles.label}>{t.align}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={toggleBtn((selected.align || 'left') === 'left')}
                        onClick={() => updateItem(selected.id, { align: 'left' })}
                        disabled={selected.locked}
                      >
                        {t.left}
                      </button>
                      <button
                        style={toggleBtn((selected.align || 'left') === 'center')}
                        onClick={() => updateItem(selected.id, { align: 'center' })}
                        disabled={selected.locked}
                      >
                        {t.center}
                      </button>
                      <button
                        style={toggleBtn((selected.align || 'left') === 'right')}
                        onClick={() => updateItem(selected.id, { align: 'right' })}
                        disabled={selected.locked}
                      >
                        {t.right}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {(selected.type === 'image' || selected.type === 'video') && (
                <>
                  <div style={styles.row}>
                    <div style={styles.label}>{t.shape}</div>
                    <select
                      value={selected.shape || 'rounded'}
                      onChange={(e) => updateItem(selected.id, { shape: e.target.value })}
                      style={styles.select}
                      disabled={selected.locked}
                    >
                      {SHAPES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  {selected.shape === 'rounded' && (
                    <div style={styles.row}>
                      <div style={styles.label}>{t.radius}</div>
                      <input
                        type="number"
                        value={selected.radius ?? 18}
                        min={0}
                        max={200}
                        onChange={(e) => updateItem(selected.id, { radius: Number(e.target.value) })}
                        style={styles.num}
                        disabled={selected.locked}
                      />
                    </div>
                  )}

                  <div style={styles.row}>
                    <div style={styles.label}>{t.fit}</div>
                    <select
                      value={selected.fit || (selected.type === 'video' ? 'cover' : 'contain')}
                      onChange={(e) => updateItem(selected.id, { fit: e.target.value })}
                      style={styles.select}
                      disabled={selected.locked}
                    >
                      <option value="contain">{t.fitContain}</option>
                      <option value="cover">{t.fitCover}</option>
                      <option value="fill">{t.fitFill}</option>
                    </select>
                  </div>

                  {selected.type === 'video' && (
                    <>
                      <div style={styles.row}>
                        <div style={styles.label}>{t.autoplay}</div>
                        <button
                          style={toggleBtn(selected.autoplay !== false)}
                          onClick={() => updateItem(selected.id, { autoplay: !(selected.autoplay !== false) })}
                          disabled={selected.locked}
                        >
                          {selected.autoplay !== false ? t.on : t.off}
                        </button>
                      </div>

                      <div style={styles.row}>
                        <div style={styles.label}>{t.loop}</div>
                        <button
                          style={toggleBtn(selected.loop !== false)}
                          onClick={() => updateItem(selected.id, { loop: !(selected.loop !== false) })}
                          disabled={selected.locked}
                        >
                          {selected.loop !== false ? t.on : t.off}
                        </button>
                      </div>

                      <div style={styles.row}>
                        <div style={styles.label}>{t.muted}</div>
                        <button
                          style={toggleBtn(selected.muted !== false)}
                          onClick={() => updateItem(selected.id, { muted: !(selected.muted !== false) })}
                          disabled={selected.locked}
                        >
                          {selected.muted !== false ? t.on : t.off}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}

              <div style={styles.actions}>
                <button style={styles.actionBtn} onClick={duplicateSelected}>{t.duplicate}</button>
                <button style={styles.actionBtn} onClick={bringForward}>{t.bring}</button>
                <button style={styles.actionBtn} onClick={sendBackward}>{t.send}</button>
                <button style={styles.actionBtn} onClick={() => updateItem(selected.id, { locked: true })}>{t.lock}</button>
                <button style={styles.actionBtn} onClick={() => updateItem(selected.id, { locked: false })}>{t.unlock}</button>
                <button
                  style={{ ...styles.actionBtn, background: '#ffefef', borderColor: '#ffb7b7' }}
                  onClick={() => removeMany([selected.id])}
                >
                  {t.delete}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function persistPresets(arr) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(arr));
  }
}

function resolveBorderColor(item) {
  return item?.borderColor ?? (item?.showBorder ? DEFAULT_BORDER_COLOR : 'transparent');
}

function normalizeColorInputValue(color) {
  if (!color || color === 'transparent') return '#ffffff';
  if (color.startsWith('#')) return color;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return '#ffffff';
  const toHex = (value) => Number(value).toString(16).padStart(2, '0');
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

function GuideOverlay({ guide }) {
  if (guide.orientation === 'vertical') {
    return (
      <div
        style={{
          ...styles.guideLineV,
          left: guide.x,
          top: guide.y1,
          height: Math.max(0, guide.y2 - guide.y1),
        }}
      />
    );
  }

  if (guide.orientation === 'horizontal') {
    return (
      <div
        style={{
          ...styles.guideLineH,
          top: guide.y,
          left: guide.x1,
          width: Math.max(0, guide.x2 - guide.x1),
        }}
      />
    );
  }

  if (guide.orientation === 'vertical-segment') {
    const top = Math.min(guide.y1, guide.y2);
    const height = Math.abs(guide.y2 - guide.y1);
    const midY = top + height / 2;

    return (
      <>
        <div style={{ ...styles.guideSpacing, left: guide.x, top, height }} />
        <div style={{ ...styles.guideCap, left: guide.x - 4, top: guide.y1, width: 8 }} />
        <div style={{ ...styles.guideCap, left: guide.x - 4, top: guide.y2, width: 8 }} />
        {guide.label ? (
          <div style={{ ...styles.guideLabel, left: guide.x + 6, top: midY - 8 }}>
            {guide.label}
          </div>
        ) : null}
      </>
    );
  }

  return null;
}

function ItemBox({ item, selected }) {
  const resolvedBorderColor = resolveBorderColor(item);
  const border = selected ? styles.itemBoxSelected.border : `2px solid ${resolvedBorderColor}`;
  const base = {
    ...styles.itemBox,
    ...(item.type === 'text' ? styles.textItemBox : null),
    ...(selected ? styles.itemBoxSelected : {}),
    opacity: item.opacity ?? 1,
    cursor: item.locked ? 'not-allowed' : 'move',
    border,
  };

  if (item.type === 'image') {
    return (
      <div style={base}>
        <div style={imageFrameStyle(item)}>
          <img
            src={item.src}
            alt="photo"
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: item.fit || 'contain',
              display: 'block',
            }}
          />
        </div>
      </div>
    );
  }

  if (item.type === 'video') {
    return (
      <div style={base}>
        <div style={imageFrameStyle(item)}>
          <video
            src={item.src}
            muted={item.muted !== false}
            autoPlay={item.autoplay !== false}
            loop={item.loop !== false}
            playsInline={item.playsInline !== false}
            preload="auto"
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: item.fit || 'cover',
              display: 'block',
              pointerEvents: 'none',
              background: '#000',
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={base}>
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: 10,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent:
            (item.align || 'left') === 'left'
              ? 'flex-start'
              : (item.align === 'right' ? 'flex-end' : 'center'),
        }}
      >
        <div
          style={{
            width: '100%',
            color: item.color || '#fff',
            fontFamily: item.fontFamily,
            fontSize: item.size || 36,
            fontWeight: item.bold ? 900 : 600,
            fontStyle: item.italic ? 'italic' : 'normal',
            textAlign: item.align || 'left',
            textShadow: '0 2px 8px rgba(0,0,0,0.78), 0 0 2px rgba(0,0,0,0.95)',
            WebkitTextStroke: '1px rgba(0,0,0,0.72)',
            paintOrder: 'stroke fill',
            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
            userSelect: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {item.text}
        </div>
      </div>
    </div>
  );
}

function imageFrameStyle(item) {
  const shape = item.shape || 'rounded';
  const radius = item.radius ?? 18;

  const common = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    borderRadius: shape === 'rounded' ? radius : (shape === 'circle' ? 9999 : 0),
  };

  if (shape === 'triangle') {
    return { ...common, borderRadius: 0, clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' };
  }
  if (shape === 'diamond') {
    return { ...common, borderRadius: 0, clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' };
  }
  if (shape === 'rect') {
    return { ...common, borderRadius: 0 };
  }
  return common;
}

function toggleBtn(active) {
  return {
    padding: '8px 10px',
    borderRadius: 10,
    border: `1px solid ${active ? '#111' : '#ddd'}`,
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
    cursor: 'pointer',
    fontWeight: 800,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsIntersect(a, b) {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

function maxZ(items) {
  let m = 0;
  for (const it of items) m = Math.max(m, it.z || 0);
  return m;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function getTexts(lang) {
  const ko = {
    addName: '+ 음식이름',
    addPrice: '+ 가격',
    addPhoto: '+ 사진',
    addVideo: '+ 영상',
    snap: 'Snap',
    grid: 'Grid',
    savePreset: '프리셋 저장',
    loadPreset: '프리셋 불러오기…',
    deletePreset: '프리셋 삭제',
    editingNotSaved: '● Editing (Not Saved)',
    saved: 'Saved',
    save: '저장',
    cancel: '취소',
    undo: '되돌리기',
    redo: '다시실행',

    openTools: '도구 열기',
    hideTools: '도구 숨기기',

    presetNamePrompt: '프리셋 이름을 입력하세요',
    presetNameDefault: '내 메뉴 프리셋',
    presetSavedAlert: '프리셋 저장 완료!',
    presetDeletedAlert: '프리셋 삭제 완료!',
    pickPresetFirst: '삭제할 프리셋을 먼저 선택하세요.',
    deletePresetConfirm: '선택한 프리셋을 삭제할까요?',

    inspectorTitle: '속성',

    type: '종류',
    textName: '텍스트(메뉴명)',
    textPrice: '텍스트(가격)',
    photo: '사진',
    video: '영상',

    locked: '잠금',
    lockedOn: '잠금',
    lockedOff: '해제',

    border: '테두리',
    borderOn: '켜짐',
    borderOff: '꺼짐',
    borderColor: '테두리 색',
    transparent: '투명',

    opacity: '투명도',
    text: '텍스트',
    font: '폰트',
    size: '크기',
    color: '색상',
    style: '스타일',
    bold: '굵게',
    italic: '기울임',
    align: '정렬',

    shape: '모양',
    radius: '둥근 정도',
    fit: '맞춤',
    fitContain: 'Contain (전체 보이게)',
    fitCover: 'Cover (꽉 채우기)',
    fitFill: 'Fill (늘려 맞추기)',
    autoplay: '자동재생',
    loop: '무한반복',
    muted: '음소거',
    on: '켜짐',
    off: '꺼짐',

    left: '왼쪽',
    center: '가운데',
    right: '오른쪽',
    top: '위',
    middle: '중간',
    bottom: '아래',

    group: '그룹',
    ungroup: '그룹 해제',
    duplicate: '복제',
    bring: '앞으로',
    send: '뒤로',
    lock: '잠금',
    unlock: '잠금 해제',
    delete: '삭제',

    foodNameDefault: '음식 이름',
    priceDefault: '$9.99',
  };

  const en = {
    addName: '+ Name',
    addPrice: '+ Price',
    addPhoto: '+ Photo',
    addVideo: '+ Video',
    snap: 'Snap',
    grid: 'Grid',
    savePreset: 'Save Preset',
    loadPreset: 'Load Preset…',
    deletePreset: 'Delete Preset',
    editingNotSaved: '● Editing (Not Saved)',
    saved: 'Saved',
    save: 'Save',
    cancel: 'Cancel',

    openTools: 'Show Tools',
    hideTools: 'Hide Tools',

    presetNamePrompt: 'Enter preset name',
    presetNameDefault: 'My Menu Preset',
    presetSavedAlert: 'Preset saved!',
    presetDeletedAlert: 'Preset deleted!',
    pickPresetFirst: 'Pick a preset to delete first.',
    deletePresetConfirm: 'Delete selected preset?',

    inspectorTitle: 'Properties',

    type: 'Type',
    textName: 'Text (Name)',
    textPrice: 'Text (Price)',
    photo: 'Photo',
    video: 'Video',

    locked: 'Locked',
    lockedOn: 'Locked',
    lockedOff: 'Unlocked',

    border: 'Border',
    borderOn: 'On',
    borderOff: 'Off',
    borderColor: 'Border color',
    transparent: 'Transparent',

    opacity: 'Opacity',
    text: 'Text',
    font: 'Font',
    size: 'Size',
    color: 'Color',
    style: 'Style',
    bold: 'Bold',
    italic: 'Italic',
    align: 'Align',

    shape: 'Shape',
    radius: 'Radius',
    fit: 'Fit',
    fitContain: 'Contain',
    fitCover: 'Cover',
    fitFill: 'Fill',
    autoplay: 'Autoplay',
    loop: 'Loop',
    muted: 'Muted',
    on: 'On',
    off: 'Off',

    left: 'Left',
    center: 'Center',
    right: 'Right',
    top: 'Top',
    middle: 'Middle',
    bottom: 'Bottom',

    group: 'Group',
    ungroup: 'Ungroup',
    duplicate: 'Duplicate',
    bring: 'Bring +',
    send: 'Send -',
    lock: 'Lock',
    unlock: 'Unlock',
    delete: 'Delete',

    foodNameDefault: 'Item Name',
    priceDefault: '$9.99',
  };

  return lang === 'en' ? en : ko;
}

const styles = {
  toolbarFixed: {
    position: 'fixed',
    left: 16,
    top: 'calc(env(safe-area-inset-top, 0px) + 48px)',
    zIndex: 9999,
    pointerEvents: 'auto',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    padding: '10px 12px',
    borderRadius: 14,
    backdropFilter: 'blur(6px)',
    maxWidth: 'min(920px, calc(100vw - 160px))',
  },
  toolbarRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'nowrap',
    alignItems: 'center',
    whiteSpace: 'nowrap',
    overflowX: 'auto',
  },
  toolBtn: {
    padding: '9px 11px',
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 900,
  },
  toolBtnSm: {
    padding: '7px 9px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 900,
  },
  toolbarCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.28)',
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    fontWeight: 900,
    display: 'grid',
    placeItems: 'center',
    marginLeft: 'auto',
  },
  toolsOpenBtn: {
    position: 'fixed',
    left: 16,
    top: 'calc(env(safe-area-inset-top, 0px) + 66px)',
    zIndex: 9999,
    padding: '10px 12px',
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 900,
  },

  presetSelect: { padding: '8px 10px', borderRadius: 10, border: 'none', fontWeight: 900 },
  sep: { width: 1, height: 20, background: 'rgba(255,255,255,0.25)', margin: '0 4px' },

  saveBar: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    zIndex: 9999,
    pointerEvents: 'auto',
    display: 'flex',
    gap: 10,
  },
  saveBtn: {
    padding: '12px 16px',
    borderRadius: 12,
    border: 'none',
    fontWeight: 900,
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #ddd',
    fontWeight: 900,
    background: 'rgba(255,255,255,0.95)',
    cursor: 'pointer',
  },

  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },

  layer: {
    position: 'absolute',
    inset: 0,
    zIndex: 40,
  },
  guideLineV: {
    position: 'absolute',
    width: 1,
    borderLeft: `1px dashed ${GUIDE_COLOR}`,
    pointerEvents: 'none',
    zIndex: 80,
  },
  guideLineH: {
    position: 'absolute',
    height: 1,
    borderTop: `1px dashed ${GUIDE_COLOR}`,
    pointerEvents: 'none',
    zIndex: 80,
  },
  guideSpacing: {
    position: 'absolute',
    width: 1,
    borderLeft: `1px dashed ${GUIDE_ACCENT}`,
    pointerEvents: 'none',
    zIndex: 81,
  },
  guideCap: {
    position: 'absolute',
    height: 1,
    borderTop: `1px solid ${GUIDE_ACCENT}`,
    pointerEvents: 'none',
    zIndex: 81,
  },
  guideLabel: {
    position: 'absolute',
    padding: '1px 4px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.96)',
    color: 'rgba(37,99,235,0.96)',
    border: '1px solid rgba(59,130,246,0.18)',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
    pointerEvents: 'none',
    zIndex: 82,
  },

  itemBox: {
    width: '100%',
    height: '100%',
    outline: 'none',
    borderRadius: 12,
    border: `2px solid ${DEFAULT_BORDER_COLOR}`,
    background: 'rgba(0,0,0,0.08)',
    boxShadow: '0 10px 22px rgba(0,0,0,0.20)',
  },
  textItemBox: {
    background: 'transparent',
    boxShadow: 'none',
  },
  itemBoxSelected: {
    border: '2px solid rgba(255,255,255,0.85)',
    boxShadow: '0 12px 26px rgba(0,0,0,0.35)',
  },

  inspector: {
    position: 'fixed',
    right: 16,
    zIndex: 9998,
    pointerEvents: 'auto',
    width: 280,
    maxHeight: 'calc(100vh - 170px)',
    overflow: 'auto',
    background: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    padding: 10,
    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
  },
  inspectorTitle: {
    fontWeight: 900,
    fontSize: 16,
    marginBottom: 10,
  },

  multiBox: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  multiGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 8,
  },

  row: {
    display: 'grid',
    gridTemplateColumns: '90px 1fr',
    gap: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  rowCol: {
    display: 'grid',
    gap: 6,
    marginBottom: 10,
  },
  label: { fontSize: 12, fontWeight: 900, opacity: 0.75 },
  value: { fontSize: 13, fontWeight: 800 },

  input: {
    width: '100%',
    padding: '10px 10px',
    borderRadius: 12,
    border: '1px solid #ddd',
    fontWeight: 700,
  },
  select: {
    width: '100%',
    padding: '10px 10px',
    borderRadius: 12,
    border: '1px solid #ddd',
    fontWeight: 800,
    background: '#fff',
  },
  num: {
    width: '100%',
    padding: '10px 10px',
    borderRadius: 12,
    border: '1px solid #ddd',
    fontWeight: 800,
  },
  color: { width: '100%', height: 38, border: '1px solid #ddd', borderRadius: 12 },
  transparentBtn: {
    padding: '8px 10px',
    borderRadius: 10,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 800,
  },
  transparentBtnActive: {
    background: '#111',
    color: '#fff',
    borderColor: '#111',
  },

  actions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    padding: '8px 8px',
    borderRadius: 10,
    border: '1px solid #ddd',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#fff',
  },
};