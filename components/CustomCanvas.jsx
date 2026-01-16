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
const SNAP_THRESHOLD = 8;
const INSPECTOR_ENABLED = true;
const DEFAULT_BORDER_COLOR = 'rgba(255,255,255,0.22)';

// ✅ 드래그 중 자동 스크롤
const AUTO_SCROLL_ZONE = 80;
const AUTO_SCROLL_SPEED = 18;

export default function CustomCanvas({
  items = [],
  onChangeItems,
  onSave,
  onCancel,
  editing = false,
  lang = 'ko',
  inspectorTop = 118,

  // ✅ NEW: 'edit' | 'preview'
  uiMode = 'edit',

  // ✅ MenuEditor stage scroll ref
  scrollRef,
}) {
  const t = useMemo(() => getTexts(lang), [lang]);
  const incomingItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const [draft, setDraft] = useState(incomingItems);
  const [origin, setOrigin] = useState(incomingItems);
  const safeItems = useMemo(() => (Array.isArray(draft) ? draft : []), [draft]);

  const [dirty, setDirty] = useState(false);

  // ✅ 선택 유지
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedId = selectedIds[0] || null;

  // ✅ 드래그 중 선택 풀림 방지
  const [isDragging, setIsDragging] = useState(false);

  // ✅ 스냅/그리드
  const [snapOn, setSnapOn] = useState(true);
  const [gridOn, setGridOn] = useState(false);
  const [gridSize, setGridSize] = useState(10);

  // ✅ 프리셋
  const [presets, setPresets] = useState([]);
  const [presetSelectedId, setPresetSelectedId] = useState('');

  // ✅ Inspector 표시/자동숨김
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const hideReasonRef = useRef(null); // 'select' | 'add'

  // ✅ 툴바 숨김/표시
  const [toolbarVisible, setToolbarVisible] = useState(false);

  // ✅ 멀티 드래그 이동용
  const dragAnchorRef = useRef(null);

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

  // -----------------------------
  // Presets load
  // -----------------------------
  useEffect(() => {
    setPresets(loadPresets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ 편집모드 아니면 UI OFF (하지만 draft는 유지됨)
  useEffect(() => {
    if (!editing) {
      setIsDragging(false);
      setSelectedIds([]);
      setInspectorVisible(false);
      clearInspectorHideTimer();
      hideReasonRef.current = null;
      setToolbarVisible(false);
    } else {
      setInspectorVisible(false);
      setToolbarVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // ✅ preview 모드 들어가면 UI 싹 숨김(선택/인스펙터/툴바)
  useEffect(() => {
    if (isPreview) {
      setSelectedIds([]);
      setInspectorVisible(false);
      clearInspectorHideTimer();
      hideReasonRef.current = null;
      setToolbarVisible(false);
    } else {
      if (editing) {
        setInspectorVisible(false);
        setToolbarVisible(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview]);

  // ✅ 편집 중(dirty)에는 부모 items로 덮어쓰기 금지
  useEffect(() => {
    if (dirty) return;
    setDraft(incomingItems);
    setOrigin(incomingItems);
    setSelectedIds([]);
    setDirty(false);
  }, [incomingItems, dirty]);

  const commit = (next) => {
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

  // -----------------------------
  // ✅ Drag auto-scroll (iPad)
  // -----------------------------
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

  // -----------------------------
  // Inspector helpers
  // -----------------------------
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
    if (!INSPECTOR_ENABLED) return;
    if (isPreview) return;
    setInspectorVisible(true);
    hideReasonRef.current = 'select';
    clearInspectorHideTimer();
  };

  const showInspectorByAdd = () => {
    if (!INSPECTOR_ENABLED) return;
    if (isPreview) return;
    setInspectorVisible(true);
    hideReasonRef.current = 'add';
    clearInspectorHideTimer();
  };

  // -----------------------------
  // Adders
  // -----------------------------
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
    if (isPreview) return;
    if (!file) return;
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

  // -----------------------------
  // Selection
  // -----------------------------
  const clearSelect = () => {
    setSelectedIds([]);
    clearInspectorHideTimer();
    hideReasonRef.current = null;
    setInspectorVisible(false);
  };

  // -----------------------------
  // Save / Cancel
  // -----------------------------
  const doSave = () => {
    setOrigin(safeItems);
    setDirty(false);
    onSave?.(safeItems);
  };

  const doCancel = () => {
    setDraft(origin);
    setDirty(false);
    setSelectedIds([]);
    clearInspectorHideTimer();
    hideReasonRef.current = null;
    setInspectorVisible(false);
    onCancel?.(origin);
  };

  // -----------------------------
  // Keyboard
  // -----------------------------
  useEffect(() => {
    if (!editing) return;
    if (isPreview) return;

    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
        e.preventDefault();
        removeMany(selectedIds);
      }

      if (selectedIds.length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        let dx = 0, dy = 0;
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
  }, [editing, selectedIds, safeItems, origin, isPreview]);

  // -----------------------------
  // Move / Snap
  // -----------------------------
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
    let nx = x;
    let ny = y;

    if (gridOn) {
      nx = Math.round(nx / gridSize) * gridSize;
      ny = Math.round(ny / gridSize) * gridSize;
    }

    if (!snapOn) return { x: nx, y: ny };

    const others = safeItems.filter((it) => it.id !== movingId);
    const xCandidates = [];
    const yCandidates = [];

    for (const o of others) {
      xCandidates.push(o.x, o.x + o.w, o.x + o.w / 2);
      yCandidates.push(o.y, o.y + o.h, o.y + o.h / 2);
    }

    nx = snapBest(nx, [
      ...xCandidates,
      ...xCandidates.map((c) => c - w),
      ...xCandidates.map((c) => c - w / 2),
    ]);

    ny = snapBest(ny, [
      ...yCandidates,
      ...yCandidates.map((c) => c - h),
      ...yCandidates.map((c) => c - h / 2),
    ]);

    return { x: Math.round(nx), y: Math.round(ny) };
  };

  function snapBest(value, candidates) {
    let best = value;
    let bestDist = SNAP_THRESHOLD + 1;
    for (const c of candidates) {
      const d = Math.abs(value - c);
      if (d <= SNAP_THRESHOLD && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  // -----------------------------
  // Group / Lock
  // -----------------------------
  const lockSelected = () => updateMany(selectedIds, { locked: true });
  const unlockSelected = () => updateMany(selectedIds, { locked: false });

  const groupSelected = () => {
    if (selectedIds.length < 2) return;
    const gid = 'g_' + newId();
    updateMany(selectedIds, { groupId: gid });
  };

  const ungroupSelected = () => updateMany(selectedIds, { groupId: null });

  // -----------------------------
  // Z-order / Duplicate
  // -----------------------------
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

  // -----------------------------
  // Align (Multi)
  // -----------------------------
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

  // -----------------------------
  // Presets
  // -----------------------------
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
    if (isPreview) return;
    if (!INSPECTOR_ENABLED) {
      return;
    }
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

  // -----------------------------
  // Multi-drag helpers
  // -----------------------------
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
  };

  const applyMultiDragStop = (activeId, newX, newY) => {
    const anchor = dragAnchorRef.current;
    dragAnchorRef.current = null;

    if (!anchor || anchor.id !== activeId) {
      const it = safeItems.find((x) => x.id === activeId);
      if (!it) return;
      const { x: sx, y: sy } = applySnap(activeId, newX, newY, it.w, it.h);
      updateItem(activeId, { x: sx, y: sy });
      return;
    }

    const dx = newX - anchor.startX;
    const dy = newY - anchor.startY;

    const set = new Set(selectedIds);
    const next = safeItems.map((it) => {
      if (!set.has(it.id)) return it;
      if (it.locked) return it;

      const snapBase = anchor.snapshot.find((s) => s.id === it.id);
      if (!snapBase) return it;

      let nx = snapBase.x + dx;
      let ny = snapBase.y + dy;

      if (gridOn) {
        nx = Math.round(nx / gridSize) * gridSize;
        ny = Math.round(ny / gridSize) * gridSize;
      }

      return { ...it, x: nx, y: ny };
    });

    const activeItem = safeItems.find((x) => x.id === activeId);
    if (activeItem) {
      const activeSnapBase = anchor.snapshot.find((s) => s.id === activeId);
      if (activeSnapBase) {
        const ax = activeSnapBase.x + dx;
        const ay = activeSnapBase.y + dy;
        const { x: sx, y: sy } = applySnap(activeId, ax, ay, activeItem.w, activeItem.h);
        const fixDx = sx - ax;
        const fixDy = sy - ay;

        const next2 = next.map((it) => {
          if (!set.has(it.id)) return it;
          if (it.locked) return it;
          return { ...it, x: it.x + fixDx, y: it.y + fixDy };
        });

        commit(next2);
        return;
      }
    }

    commit(next);
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <>
      {/* ✅ 편집모드 + 미리보기 아니면: 툴바 */}
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
                    onChange={(e) => addPhoto(e.target.files?.[0])}
                  />
                </label>

                <span style={styles.sep} />

                <label style={styles.chk}>
                  <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
                  {t.snap}
                </label>

                <label style={styles.chk}>
                  <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} />
                  {t.grid}
                </label>

                {gridOn && (
                  <input
                    type="number"
                    min={4}
                    max={100}
                    value={gridSize}
                    onChange={(e) => setGridSize(Number(e.target.value || 10))}
                    style={styles.gridNum}
                    title="Grid Size"
                  />
                )}

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
            <button style={styles.saveBtn} onClick={doSave}>{t.save}</button>
            <button style={styles.cancelBtn} onClick={doCancel}>{t.cancel}</button>
          </div>
        </>
      )}

      {/* Canvas */}
      <div
        style={styles.layer}
        onClick={(e) => {
          if (!isEdit) return;
          if (isPreview) return;
          if (e.target === e.currentTarget && !isDragging) clearSelect();
        }}
      >
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
                  if (!isEdit) return;
                  if (isPreview) return;

                  e.stopPropagation();

                  setSelectedIds((prev) => {
                    if (!e.shiftKey) return [it.id];
                    if (prev.includes(it.id)) return prev.filter((x) => x !== it.id);
                    return [...prev, it.id];
                  });

                  showInspectorBySelect();
                }}

                onDragStart={() => {
                  if (!isEdit || isPreview) return;
                  setIsDragging(true);

                  if (selectedIds.length >= 2 && selectedIds.includes(it.id)) {
                    beginMultiDrag(it.id);
                  } else {
                    dragAnchorRef.current = null;
                  }
                }}

                onDrag={(e) => {
                  if (!isEdit || isPreview) return;
                  autoScrollWhileDrag(e);
                }}

                onResizeStart={() => isEdit && !isPreview && setIsDragging(true)}

                onDragStop={(e, d) => {
                  if (!isEdit || isPreview) return;
                  setIsDragging(false);
                  if (isLocked) return;

                  if (selectedIds.length >= 2 && selectedIds.includes(it.id)) {
                    applyMultiDragStop(it.id, d.x, d.y);
                    return;
                  }

                  const { x: sx, y: sy } = applySnap(it.id, d.x, d.y, it.w, it.h);
                  updateItem(it.id, { x: sx, y: sy });
                }}

                onResizeStop={(e, dir, ref, delta, pos) => {
                  if (!isEdit || isPreview) return;
                  setIsDragging(false);
                  if (isLocked) return;

                  const w = ref.offsetWidth;
                  const h = ref.offsetHeight;

                  const { x: sx, y: sy } = applySnap(it.id, pos.x, pos.y, w, h);
                  updateItem(it.id, { w, h, x: sx, y: sy });
                }}

                style={{ zIndex: it.z || 0 }}
              >
                <ItemBox item={it} selected={isEdit && isSelected && !isPreview} />
              </Rnd>
            );
          })}
      </div>

      {/* ✅ Inspector: 편집 + 미리보기X + inspectorVisible */}
      {INSPECTOR_ENABLED && isEdit && !isPreview && inspectorVisible && (
        <div
          style={{ ...styles.inspector, top: inspectorTop }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={styles.inspectorTitle}>{t.inspectorTitle}</div>

          {selectedIds.length >= 2 && (
            <div style={styles.multiBox}>
              <div style={styles.multiGrid}>
                <button style={styles.actionBtn} onClick={alignLeft}>{t.left}</button>
                <button style={styles.actionBtn} onClick={alignCenter}>{t.center}</button>
                <button style={styles.actionBtn} onClick={alignRight}>{t.right}</button>
                <button style={styles.actionBtn} onClick={alignTop}>{t.top}</button>
                <button style={styles.actionBtn} onClick={alignMiddle}>{t.middle}</button>
                <button style={styles.actionBtn} onClick={alignBottom}>{t.bottom}</button>
              </div>

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

              {selected.type === 'image' && (
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
                      value={selected.fit || 'contain'}
                      onChange={(e) => updateItem(selected.id, { fit: e.target.value })}
                      style={styles.select}
                      disabled={selected.locked}
                    >
                      <option value="contain">{t.fitContain}</option>
                      <option value="cover">{t.fitCover}</option>
                    </select>
                  </div>
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
    </>
  );

  // -----------------------------
  // Preset storage
  // -----------------------------
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
            textShadow: '0 2px 8px rgba(0,0,0,0.55)',
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

  if (shape === 'triangle') return { ...common, borderRadius: 0, clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' };
  if (shape === 'diamond') return { ...common, borderRadius: 0, clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' };
  if (shape === 'rect') return { ...common, borderRadius: 0 };
  return common;
}

function toggleBtn(active) {
  return {
    padding: '8px 10px',
    borderRadius: 10,
    border: '1px solid ' + (active ? '#111' : '#ddd'),
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
    cursor: 'pointer',
    fontWeight: 800,
  };
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
    snap: 'Snap',
    grid: 'Grid',
    savePreset: '프리셋 저장',
    loadPreset: '프리셋 불러오기…',
    deletePreset: '프리셋 삭제',
    editingNotSaved: '● Editing (Not Saved)',
    saved: 'Saved',
    save: '저장',
    cancel: '취소',

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
  // ✅ 툴바: 좌상단 고정
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

  chk: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 800 },
  gridNum: { width: 70, padding: '8px 8px', borderRadius: 10, border: 'none', fontWeight: 900 },
  presetSelect: { padding: '8px 10px', borderRadius: 10, border: 'none', fontWeight: 900 },
  sep: { width: 1, height: 20, background: 'rgba(255,255,255,0.25)', margin: '0 4px' },

  saveBar: {
    position: 'fixed',
    right: 16,
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

  layer: {
    position: 'absolute',
    inset: 0,
    zIndex: 40,
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
    width: 320,
    maxHeight: 'calc(100vh - 90px)',
    overflow: 'auto',
    background: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    padding: 12,
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
    gridTemplateColumns: '1fr 1fr 1fr',
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
    padding: '10px 10px',
    borderRadius: 12,
    border: '1px solid #ddd',
    cursor: 'pointer',
    fontWeight: 900,
    background: '#fff',
  },
};