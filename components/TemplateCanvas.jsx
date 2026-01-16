'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const BASE_W = 1080;

const DEFAULT_ROW_H = 92;
const DEFAULT_HEADER_H = 210;
const DEFAULT_PAGE_PADDING_TOP = 70;
const DEFAULT_PAGE_PADDING_X = 70;

// ✅ 사진: 블록에서 돌아가며 쓰는 사진들(최대 8장까지 늘려도 됨)
const MAX_PHOTOS = 8;

export default function TemplateCanvas({
  templateId,
  data,
  onChange,
  onCancel,
  editing = false,
  uiMode = 'edit', // 'edit' | 'preview'
  lang = 'ko',
  pageHeight = 2200,
  pageGap = 40,
  fullScrollHeight,
  panelOpen = true,
  onTogglePanel,
}) {
  const isPreview = uiMode === 'preview';
  const isEdit = !!editing && !isPreview;

  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  const t = useMemo(() => getTexts(lang), [lang]);

  // scale 계산
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const calc = () => {
      const w = el.clientWidth || window.innerWidth || BASE_W;
      const next = w / BASE_W;
      setScale(next > 0 ? next : 1);
    };

    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    window.addEventListener('resize', calc);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', calc);
    };
  }, []);

  const safe = useMemo(() => normalizeData(templateId, data, lang), [templateId, data, lang]);
  if (!safe) return null;

  const style = safe.style;
  const currency = safe.currency || '$';

  // ✅ 헤더 로고 업로드
  const onPickLogo = async (file) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    onChange?.({ ...safe, logoSrc: src });
  };

  const removeLogo = () => {
    onChange?.({ ...safe, logoSrc: null });
  };

  // ✅ 블록용 사진 업로드 (slot index)
  const onPickPhoto = async (file, idx) => {
    if (!file) return;
    const src = await fileToDataUrl(file);

    const photos = Array.isArray(safe.photos) ? [...safe.photos] : Array(MAX_PHOTOS).fill(null);
    while (photos.length < MAX_PHOTOS) photos.push(null);
    photos[idx] = src;

    // ✅ 레거시 호환: photoSrc도 함께 유지(첫번째 사진)
    onChange?.({ ...safe, photos, photoSrc: photos[0] || null });
  };

  const removePhoto = (idx) => {
    const photos = Array.isArray(safe.photos) ? [...safe.photos] : Array(MAX_PHOTOS).fill(null);
    while (photos.length < MAX_PHOTOS) photos.push(null);
    photos[idx] = null;
    onChange?.({ ...safe, photos, photoSrc: photos[0] || null });
  };

  // rows (T1/T2)
  const updateRow = (idx, patch) => {
    const rows = Array.isArray(safe?.rows) ? safe.rows : [];
    const nextRows = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange?.({ ...safe, rows: nextRows });
  };
  const addRow = () => {
    const rows = Array.isArray(safe?.rows) ? safe.rows : [];
    onChange?.({ ...safe, rows: [...rows, { name: '', price: '' }] });
  };
  const removeRow = (idx) => {
    const rows = Array.isArray(safe?.rows) ? safe.rows : [];
    onChange?.({ ...safe, rows: rows.filter((_, i) => i !== idx) });
  };

  // cells (T3)
  const updateCell = (idx, patch) => {
    const cells = Array.isArray(safe?.cells) ? safe.cells : [];
    const nextCells = cells.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange?.({ ...safe, cells: nextCells });
  };
  const addCell = () => {
    const cells = Array.isArray(safe?.cells) ? safe.cells : [];
    onChange?.({ ...safe, cells: [...cells, { name: '', price: '' }] });
  };
  const removeCell = (idx) => {
    const cells = Array.isArray(safe?.cells) ? safe.cells : [];
    onChange?.({ ...safe, cells: cells.filter((_, i) => i !== idx) });
  };

  const setStyle = (patch) => {
    onChange?.({ ...safe, style: { ...style, ...patch } });
  };

  // ✅ templateId는 "T2B" 같은 fullId
  const group = (templateId || '').slice(0, 2); // T1/T2/T3
  const variant = (templateId || '').slice(2, 3) || 'A'; // A/B/C

  return (
    <>
      {/* Render layer */}
      <div
        ref={wrapRef}
        style={styles.layer}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: BASE_W,
            height: Math.ceil((fullScrollHeight || pageHeight) / scale),
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'relative',
            pointerEvents: 'none',
          }}
        >
          {group === 'T1' && (
            <PagedList
              variant={variant}
              title={safe.title}
              restaurantName={safe.restaurantName}
              logoSrc={safe.logoSrc}
              rows={safe.rows || []}
              currency={currency}
              style={style}
              pageHeight={pageHeight}
              pageGap={pageGap}
            />
          )}

          {group === 'T2' && (
            <PagedPhotoList
              variant={variant}
              title={safe.title}
              restaurantName={safe.restaurantName}
              logoSrc={safe.logoSrc}
              rows={safe.rows || []}
              currency={currency}
              photos={safe.photos || []}
              caption={safe.caption}
              style={style}
              pageHeight={pageHeight}
              pageGap={pageGap}
            />
          )}

          {group === 'T3' && (
            <PagedGrid
              variant={variant}
              title={safe.title}
              restaurantName={safe.restaurantName}
              logoSrc={safe.logoSrc}
              cells={safe.cells || []}
              currency={currency}
              columns={safe.columns || 2}
              style={style}
              pageHeight={pageHeight}
              pageGap={pageGap}
            />
          )}
        </div>
      </div>

      {/* Input panel */}
      {isEdit && panelOpen && (
        <div style={ui.panel} onMouseDown={(e) => e.stopPropagation()}>
          <div style={ui.header}>
            <div style={ui.headerLeft}>
              <div style={ui.kicker}>{t.templateInput}</div>
              <div style={ui.hTitle}>{t.templateName(templateId)}</div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={ui.badge}>{templateId}</div>

              <button
                type="button"
                style={ui.closeX}
                onClick={() => onTogglePanel?.(false)}
                aria-label="hide-template-panel"
                title={lang === 'ko' ? '숨기기' : 'Hide'}
              >
                ×
              </button>
            </div>
          </div>

          {/* ✅ NEW: 상단 브랜드(로고+가게명) */}
          <Section title={t.brand}>
            <Field label={t.restaurantName}>
              <input
                value={safe.restaurantName || ''}
                onChange={(e) => onChange?.({ ...safe, restaurantName: e.target.value })}
                style={ui.input}
                placeholder={lang === 'ko' ? '예: 한소반' : 'e.g., Hansoban'}
              />
            </Field>

            <Field label={t.logo}>
              <div style={ui.logoRow}>
                <div style={ui.logoPreview}>
                  {safe.logoSrc ? (
                    <img
                      src={safe.logoSrc}
                      alt="logo"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      draggable={false}
                    />
                  ) : (
                    <div style={ui.logoEmpty}>{t.logoHint}</div>
                  )}
                </div>

                <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                  <label style={ui.fileBtn}>
                    {t.upload}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => onPickLogo(e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    style={{ ...ui.ghostBtn, opacity: safe.logoSrc ? 1 : 0.35 }}
                    onClick={() => safe.logoSrc && removeLogo()}
                    disabled={!safe.logoSrc}
                  >
                    {t.remove}
                  </button>
                </div>
              </div>

              <div style={ui.miniHint}>{t.logoNote}</div>
            </Field>
          </Section>

          <Section title={t.basic}>
            <Field label={t.title}>
              <input
                value={safe.title || ''}
                onChange={(e) => onChange?.({ ...safe, title: e.target.value })}
                style={ui.input}
              />
            </Field>

            <div style={ui.row2}>
              <Field label={t.currency}>
                <input
                  value={safe.currency || '$'}
                  onChange={(e) => onChange?.({ ...safe, currency: e.target.value })}
                  style={ui.inputSm}
                  maxLength={3}
                />
              </Field>

              <Field label={t.priceFormat}>
                <Toggle
                  value={!!style?.forceTwoDecimals}
                  onChange={(v) => setStyle({ forceTwoDecimals: v })}
                  left={t.off}
                  right={t.on}
                />
              </Field>
            </div>
          </Section>

          <Section title={t.style}>
            <Field label={t.font}>
              <select
                value={style.fontFamily}
                onChange={(e) => setStyle({ fontFamily: e.target.value })}
                style={ui.select}
              >
                <option value="system-ui">System</option>
                <option value="ui-sans-serif">Sans</option>
                <option value="ui-serif">Serif</option>
                <option value="ui-rounded">Rounded</option>
              </select>
            </Field>

            <div style={ui.row2}>
              <Field label={t.textColor}>
                <ColorDot value={style.textColor} onChange={(val) => setStyle({ textColor: val })} />
              </Field>
              <Field label={t.accentColor}>
                <ColorDot value={style.accentColor} onChange={(val) => setStyle({ accentColor: val })} />
              </Field>
            </div>

            <Field label={`${t.lineSpacing} (${style.lineSpacing.toFixed(2)})`}>
              <input
                type="range"
                min="0.90"
                max="1.60"
                step="0.02"
                value={style.lineSpacing}
                onChange={(e) => setStyle({ lineSpacing: Number(e.target.value) })}
                style={ui.range}
              />
            </Field>

            <Field label={`${t.rowGap} (${style.rowGap}px)`}>
              <input
                type="range"
                min="6"
                max="26"
                step="1"
                value={style.rowGap}
                onChange={(e) => setStyle({ rowGap: Number(e.target.value) })}
                style={ui.range}
              />
            </Field>
          </Section>

          {/* ✅ T2 사진 업로드 입력 UI */}
          {group === 'T2' && (
            <Section title={t.photoSection}>
              <Field label={t.photos}>
                <div style={ui.photoGrid}>
                  {Array.from({ length: MAX_PHOTOS }).map((_, idx) => {
                    const src = safe.photos?.[idx] || null;
                    return (
                      <div key={idx} style={ui.photoSlot}>
                        {src ? (
                          <img
                            src={src}
                            alt={`photo-${idx}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            draggable={false}
                          />
                        ) : (
                          <div style={ui.photoEmpty}>{t.photoSlot(idx + 1)}</div>
                        )}

                        <div style={ui.photoSlotBar}>
                          <label style={ui.fileBtnSm}>
                            {t.upload}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => onPickPhoto(e.target.files?.[0], idx)}
                            />
                          </label>

                          <button
                            type="button"
                            style={{ ...ui.ghostBtnSm, opacity: src ? 1 : 0.35 }}
                            onClick={() => src && removePhoto(idx)}
                            disabled={!src}
                          >
                            {t.remove}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Field>

              <Field label={t.caption}>
                <input
                  value={safe.caption || ''}
                  onChange={(e) => onChange?.({ ...safe, caption: e.target.value })}
                  style={ui.input}
                />
              </Field>

              <div style={ui.miniHint}>{t.photoHint}</div>
            </Section>
          )}

          {/* rows */}
          {(group === 'T1' || group === 'T2') && (
            <Section title={t.items}>
              {(safe.rows || []).map((r, idx) => (
                <div key={idx} style={ui.itemRow}>
                  <div style={ui.dragPill} title={t.reorderHint}>⋮⋮</div>
                  <input
                    value={r.name || ''}
                    onChange={(e) => updateRow(idx, { name: e.target.value })}
                    placeholder={t.namePH}
                    style={ui.rowName}
                  />
                  <input
                    value={r.price || ''}
                    onChange={(e) => updateRow(idx, { price: e.target.value })}
                    placeholder={t.pricePH}
                    style={ui.rowPrice}
                    inputMode="decimal"
                  />
                  <button style={ui.delBtn} onClick={() => removeRow(idx)} title={t.delete}>×</button>
                </div>
              ))}

              <button style={ui.addBtn} onClick={addRow}>{t.addRow}</button>
            </Section>
          )}

          {/* grid cells */}
          {group === 'T3' && (
            <Section title={t.gridSection}>
              <div style={ui.row2}>
                <Field label={t.columns}>
                  <select
                    value={safe.columns || 2}
                    onChange={(e) => onChange?.({ ...safe, columns: Number(e.target.value) })}
                    style={ui.select}
                  >
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </Field>
                <Field label={t.note}>
                  <div style={ui.miniHint}>{t.gridHint}</div>
                </Field>
              </div>

              {(safe.cells || []).map((c, idx) => (
                <div key={idx} style={ui.itemRow}>
                  <div style={ui.dragPill}>⋮⋮</div>
                  <input
                    value={c.name || ''}
                    onChange={(e) => updateCell(idx, { name: e.target.value })}
                    placeholder={t.namePH}
                    style={ui.rowName}
                  />
                  <input
                    value={c.price || ''}
                    onChange={(e) => updateCell(idx, { price: e.target.value })}
                    placeholder={t.pricePH}
                    style={ui.rowPrice}
                    inputMode="decimal"
                  />
                  <button style={ui.delBtn} onClick={() => removeCell(idx)}>×</button>
                </div>
              ))}

              <button style={ui.addBtn} onClick={addCell}>{t.addCell}</button>
            </Section>
          )}

          <div style={ui.panelHint}>{t.hint}</div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button style={ui.secondaryBtn} onClick={() => onCancel?.()}>{t.close}</button>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------- RENDER: PAGES -------------------- */

function PagedList({ title, restaurantName, logoSrc, rows, currency, style, pageHeight, pageGap, variant }) {
  const rowH = estimateRowH(style);
  const headerH = estimateHeaderH(style);

  const paddingTop = DEFAULT_PAGE_PADDING_TOP;
  const paddingX = DEFAULT_PAGE_PADDING_X;

  const usableH = pageHeight - paddingTop - 80;
  const perPage = Math.max(1, Math.floor((usableH - headerH) / (rowH + (style.rowGap || 14))));
  const pages = chunk(rows, perPage);

  return (
    <>
      {pages.map((pageRows, pi) => {
        const top = pi * (pageHeight + pageGap);
        return (
          <div
            key={pi}
            style={{
              position: 'absolute',
              left: 0, right: 0, top,
              height: pageHeight,
              padding: `${paddingTop}px ${paddingX}px 0 ${paddingX}px`,
            }}
          >
            <Header
              title={title}
              restaurantName={restaurantName}
              logoSrc={logoSrc}
              style={style}
              continued={pi > 0}
              pageIndex={pi + 1}
              kind="T1"
              variant={variant}
            />
            <div style={{ marginTop: 24, display: 'grid', gap: style.rowGap }}>
              {pageRows.map((r, i) => (
                <LineItem
                  key={i}
                  name={r.name || ''}
                  price={formatPrice(r.price, currency, style.forceTwoDecimals)}
                  style={style}
                  variant={variant}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * ✅ T2: 한 페이지에 사진 블록 3~4개(=사진 3~4장)
 * - 블록당 메뉴 3~4개
 * - A/B/C 레이아웃 확실히 다르게
 */
function PagedPhotoList({ title, restaurantName, logoSrc, rows, currency, photos, caption, style, pageHeight, pageGap, variant }) {
  const paddingTop = 70;
  const paddingX = 70;

  const usableH = pageHeight - paddingTop - 80;
  const headerH = estimateHeaderH(style);

  // ✅ 블록당 메뉴: 3~4개 (항목이 많으면 자동으로 블록 늘어남)
  const ITEMS_PER_BLOCK = variant === 'B' ? 3 : 4;

  const targetBlocksPerPage = 3.5; // 3~4
  const available = Math.max(400, usableH - headerH - 24);
  const blockGap = variant === 'A' ? 18 : variant === 'B' ? 16 : 20;
  const blockH = Math.floor((available - blockGap * (Math.ceil(targetBlocksPerPage) - 1)) / targetBlocksPerPage);

  const blocksPerPage = clampNum(Math.floor((available + blockGap) / (blockH + blockGap)), 3, 4);

  const blocks = chunk(rows, ITEMS_PER_BLOCK);
  const pages = chunk(blocks, blocksPerPage);

  const ph = Array.isArray(photos) ? photos.filter(Boolean) : [];
  const getPhotoForBlock = (bi) => {
    if (ph.length === 0) return null;
    return ph[bi % ph.length] || null;
  };

  return (
    <>
      {pages.map((pageBlocks, pi) => {
        const top = pi * (pageHeight + pageGap);

        return (
          <div
            key={pi}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top,
              height: pageHeight,
              padding: `${paddingTop}px ${paddingX}px 0 ${paddingX}px`,
            }}
          >
            <Header
              title={title}
              restaurantName={restaurantName}
              logoSrc={logoSrc}
              style={style}
              continued={pi > 0}
              pageIndex={pi + 1}
              kind="T2"
              variant={variant}
            />

            <div style={{ marginTop: 22, display: 'grid', gap: blockGap }}>
              {pageBlocks.map((blockRows, bi) => {
                const globalBlockIndex = pi * blocksPerPage + bi;
                const src = getPhotoForBlock(globalBlockIndex);

                return (
                  <PhotoMenuBlock
                    key={bi}
                    variant={variant}
                    style={style}
                    height={blockH}
                    photoSrc={src}
                    caption={caption}
                    rows={blockRows}
                    currency={currency}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function PagedGrid({ title, restaurantName, logoSrc, cells, currency, columns = 2, style, pageHeight, pageGap, variant }) {
  const col = Math.max(2, Math.min(3, Number(columns) || 2));
  const paddingTop = 70;
  const paddingX = 70;

  const headerH = estimateHeaderH(style);

  const cardH = variant === 'A' ? 172 : variant === 'B' ? 160 : 188;
  const gap = variant === 'A' ? 18 : variant === 'B' ? 14 : 22;

  const usableH = pageHeight - paddingTop - 80;
  const rowsPerPage = Math.max(1, Math.floor((usableH - headerH) / (cardH + gap)));
  const perPage = rowsPerPage * col;

  const pages = chunk(cells, perPage);

  return (
    <>
      {pages.map((pageCells, pi) => {
        const top = pi * (pageHeight + pageGap);
        return (
          <div
            key={pi}
            style={{
              position: 'absolute',
              left: 0, right: 0, top,
              height: pageHeight,
              padding: `${paddingTop}px ${paddingX}px 0 ${paddingX}px`,
            }}
          >
            <Header
              title={title}
              restaurantName={restaurantName}
              logoSrc={logoSrc}
              style={style}
              continued={pi > 0}
              pageIndex={pi + 1}
              kind="T3"
              variant={variant}
            />
            <div
              style={{
                marginTop: 26,
                display: 'grid',
                gridTemplateColumns: `repeat(${col}, 1fr)`,
                gap,
              }}
            >
              {pageCells.map((c, i) => (
                <div key={i} style={gridCard(style, variant, cardH)}>
                  <div style={gridName(style, variant)}>{c.name || ''}</div>
                  <div style={gridPrice(style, variant)}>
                    {formatPrice(c.price, currency, style.forceTwoDecimals)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* -------------------- T2 BLOCK -------------------- */

function PhotoMenuBlock({ variant, style, height, photoSrc, caption, rows, currency }) {
  if (variant === 'C') {
    return (
      <div style={{ ...blockWrap(style, variant), minHeight: height }}>
        <div style={blockPhotoBanner(style)}>
          {photoSrc ? (
            <img
              src={photoSrc}
              alt="menu"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              draggable={false}
            />
          ) : (
            <div style={photoPlaceholderStyle(style)}>{caption || 'Upload photo'}</div>
          )}
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: Math.max(10, (style.rowGap || 14) - 4) }}>
          {rows.map((r, i) => (
            <div key={i} style={miniLine(style, variant)}>
              <div style={miniName(style, variant)}>{r.name || ''}</div>
              <div style={miniPrice(style, variant)}>
                {formatPrice(r.price, currency, style.forceTwoDecimals)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const photoOnRight = variant === 'B';

  return (
    <div style={{ ...blockWrap(style, variant), minHeight: height }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: photoOnRight ? '1.1fr 1fr' : '1fr 1.1fr',
          gap: 14,
          alignItems: 'stretch',
        }}
      >
        {!photoOnRight ? (
          <div style={blockPhotoBox(style, variant)}>
            {photoSrc ? (
              <img
                src={photoSrc}
                alt="menu"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                draggable={false}
              />
            ) : (
              <div style={photoPlaceholderStyle(style)}>{caption || 'Upload photo'}</div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
            {rows.map((r, i) => (
              <div key={i} style={miniLine(style, variant)}>
                <div style={miniName(style, variant)}>{r.name || ''}</div>
                <div style={miniPrice(style, variant)}>
                  {formatPrice(r.price, currency, style.forceTwoDecimals)}
                </div>
              </div>
            ))}
          </div>
        )}

        {photoOnRight ? (
          <div style={blockPhotoBox(style, variant)}>
            {photoSrc ? (
              <img
                src={photoSrc}
                alt="menu"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                draggable={false}
              />
            ) : (
              <div style={photoPlaceholderStyle(style)}>{caption || 'Upload photo'}</div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
            {rows.map((r, i) => (
              <div key={i} style={miniLine(style, variant)}>
                <div style={miniName(style, variant)}>{r.name || ''}</div>
                <div style={miniPrice(style, variant)}>
                  {formatPrice(r.price, currency, style.forceTwoDecimals)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function blockWrap(style, variant) {
  const radius = variant === 'A' ? 20 : variant === 'B' ? 18 : 22;
  const bg =
    variant === 'B'
      ? 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(0,0,0,0.14))'
      : 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))';

  const border = '1px solid rgba(255,255,255,0.20)';
  const shadow = '0 18px 40px rgba(0,0,0,0.30)';

  return {
    borderRadius: radius,
    background: bg,
    border,
    boxShadow: shadow,
    padding: 14,
    overflow: 'hidden',
    boxSizing: 'border-box',
    backdropFilter: 'blur(8px)',
  };
}

function blockPhotoBox(style, variant) {
  const radius = variant === 'B' ? 14 : 18;
  return {
    borderRadius: radius,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.18)',
    boxShadow: '0 10px 26px rgba(0,0,0,0.22)',
    minHeight: 220,
    display: 'grid',
    placeItems: 'center',
  };
}

function blockPhotoBanner(style) {
  return {
    borderRadius: 18,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.18)',
    boxShadow: '0 10px 26px rgba(0,0,0,0.22)',
    height: 252,
    display: 'grid',
    placeItems: 'center',
  };
}

function miniLine(style, variant) {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 14,
    alignItems: 'baseline',
    padding: variant === 'B' ? '10px 12px' : '10px 12px',
    borderRadius: variant === 'C' ? 999 : 14,
    background:
      variant === 'C'
        ? 'rgba(255,255,255,0.08)'
        : variant === 'B'
          ? 'rgba(255,255,255,0.06)'
          : 'rgba(0,0,0,0.14)',
    border: '1px solid rgba(255,255,255,0.14)',
  };
}

function miniName(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 34 : 32,
    fontWeight: 950,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    letterSpacing: variant === 'C' ? 0.6 : 0.1,
  };
}

function miniPrice(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 34 : 30,
    fontWeight: 1000,
    opacity: 0.98,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

/* -------------------- PIECES -------------------- */

function Header({ title, restaurantName, logoSrc, style, continued, pageIndex, kind, variant }) {
  return (
    <div>
      <div style={brandRow(style, variant)}>
        <div style={brandLogoWrap(style, variant)}>
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="logo"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              draggable={false}
            />
          ) : (
            <div style={brandLogoEmpty(style)}>LOGO</div>
          )}
        </div>

        <div style={brandNameWrap(style, variant)}>
          <div style={brandName(style, variant)}>
            {(restaurantName || '').trim() || (style?.fallbackRestaurantName || '') || 'Restaurant Name'}
          </div>
          <div style={brandSub(style, variant)}>{title || 'Menu'}</div>
        </div>

        <div style={brandChip(style, variant)}>
          {variant === 'A' ? 'Classic' : variant === 'B' ? 'Bold' : 'Modern'}
        </div>
      </div>

      <div style={{ height: 12 }} />
      <div style={ruleStyle(style, variant)} />

      {continued && (
        <div style={continuedStyle(style)}>
          Continued · Page {pageIndex}
        </div>
      )}
    </div>
  );
}

function LineItem({ name, price, style, variant }) {
  return (
    <div style={lineStyle(style, variant)}>
      <div style={nameStyle(style, variant)}>{name}</div>
      <div style={priceStyle(style, variant)}>{price}</div>
    </div>
  );
}

/* -------------------- UI bits -------------------- */

function Section({ title, children }) {
  return (
    <div style={ui.section}>
      <div style={ui.sectionTitle}>{title}</div>
      <div style={ui.sectionBody}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={ui.field}>
      <div style={ui.label}>{label}</div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange, left, right }) {
  return (
    <div style={ui.toggleWrap}>
      <button
        type="button"
        style={{ ...ui.toggleBtn, ...(value ? {} : ui.toggleBtnActive) }}
        onClick={() => onChange?.(false)}
      >
        {left}
      </button>
      <button
        type="button"
        style={{ ...ui.toggleBtn, ...(value ? ui.toggleBtnActive : {}) }}
        onClick={() => onChange?.(true)}
      >
        {right}
      </button>
    </div>
  );
}

function ColorDot({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{ ...ui.colorDot, background: value }} />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={ui.colorInput}
      />
    </div>
  );
}

/* -------------------- Helpers -------------------- */

function normalizeData(templateId, data, lang) {
  if (!data) return null;

  const baseStyle = {
    fontFamily: 'system-ui',
    textColor: '#ffffff',
    accentColor: 'rgba(255,255,255,0.65)',
    lineSpacing: 1.12,
    rowGap: 14,
    forceTwoDecimals: true,
    uiScale: 0.85,
    fallbackRestaurantName: lang === 'ko' ? '한소반' : 'Hansoban',
  };

  const style = { ...baseStyle, ...(data.style || {}) };
  const group = (templateId || '').slice(0, 2); // T1/T2/T3

  const common = {
    restaurantName: data.restaurantName ?? (lang === 'ko' ? '한소반' : 'Hansoban'),
    logoSrc: data.logoSrc ?? null,
  };

  if (group === 'T1') {
    return {
      ...common,
      title: data.title ?? (lang === 'ko' ? '오늘의 메뉴' : 'Today’s Menu'),
      currency: data.currency ?? '$',
      rows: Array.isArray(data.rows) ? data.rows : [],
      style,
    };
  }

  if (group === 'T2') {
    let photos =
      Array.isArray(data.photos) ? [...data.photos] :
      data.photoSrc ? [data.photoSrc] : [];

    while (photos.length < MAX_PHOTOS) photos.push(null);
    photos = photos.slice(0, MAX_PHOTOS);

    return {
      ...common,
      title: data.title ?? (lang === 'ko' ? '추천 메뉴' : 'Featured'),
      currency: data.currency ?? '$',
      rows: Array.isArray(data.rows) ? data.rows : [],
      photos,
      photoSrc: photos[0] || null,
      caption: data.caption ?? (lang === 'ko' ? '사진을 업로드하세요' : 'Upload photos'),
      style,
    };
  }

  return {
    ...common,
    title: data.title ?? (lang === 'ko' ? '메뉴' : 'Menu'),
    currency: data.currency ?? '$',
    columns: clampNum(data.columns ?? 2, 2, 3),
    cells: Array.isArray(data.cells) ? data.cells : [],
    style,
  };
}

function estimateRowH(style) {
  const ls = clampNum(style?.lineSpacing ?? 1.12, 0.9, 1.6);
  return Math.round(DEFAULT_ROW_H * (0.9 + (ls - 0.9) * 0.8));
}
function estimateHeaderH(style) {
  const ls = clampNum(style?.lineSpacing ?? 1.12, 0.9, 1.6);
  return Math.round(DEFAULT_HEADER_H * (0.95 + (ls - 0.9) * 0.35));
}

function formatPrice(raw, currency, forceTwoDecimals) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  if (Number.isFinite(n)) {
    if (forceTwoDecimals) return `${currency}${n.toFixed(2)}`;
    return `${currency}${String(n)}`;
  }
  return `${currency}${s}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < (arr?.length || 0); i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* -------------------- TEXTS -------------------- */

function getTexts(lang) {
  const ko = {
    templateInput: '템플릿 입력',
    templateName: (id) => {
      const g = (id || '').slice(0, 2);
      const v = (id || '').slice(2, 3) || 'A';
      const base = g === 'T1' ? '리스트형' : g === 'T2' ? '사진 + 리스트' : '그리드형';
      return `${base} · ${v}`;
    },

    brand: '상단(로고/가게명)',
    restaurantName: '가게 이름',
    logo: '로고 이미지',
    logoHint: '로고 업로드',
    logoNote: '로고는 원형으로 잘려서 표시됩니다. 정사각형 이미지를 추천해요.',

    basic: '기본',
    style: '스타일',
    photoSection: '사진(블록에 사용)',
    gridSection: '그리드',

    title: '제목',
    currency: '통화기호',
    priceFormat: '가격 2자리 고정',

    font: '폰트',
    textColor: '글자색',
    accentColor: '라인/포인트 색',
    lineSpacing: '줄간격',
    rowGap: '항목 간격',

    items: '항목',
    namePH: '메뉴명',
    pricePH: '가격 (숫자)',
    addRow: '+ 항목 추가',
    addCell: '+ 항목 추가',
    delete: '삭제',
    reorderHint: '정렬(추후 드래그 지원 가능)',

    photos: `사진 ${MAX_PHOTOS}장`,
    photoSlot: (n) => `사진 ${n}`,
    upload: '업로드',
    remove: '삭제',
    caption: '안내 문구',
    photoHint: 'T2는 “사진 1장 + 메뉴 3~4개” 블록이 한 페이지에 3~4개 들어가도록 자동 배치됩니다.',

    columns: '컬럼 수',
    note: '참고',
    gridHint: '항목이 많아지면 자동으로 다음 페이지로 넘어갑니다.',

    off: 'OFF',
    on: 'ON',

    hint: '※ 입력은 자동 저장됩니다. 미리보기에서 “저장” 누르면 메뉴 화면에 반영됩니다.',
    close: '저장',
  };

  const en = {
    templateInput: 'Template Input',
    templateName: (id) => {
      const g = (id || '').slice(0, 2);
      const v = (id || '').slice(2, 3) || 'A';
      const base = g === 'T1' ? 'List' : g === 'T2' ? 'Photo + List' : 'Grid';
      return `${base} · ${v}`;
    },

    brand: 'Header (Logo / Name)',
    restaurantName: 'Restaurant name',
    logo: 'Logo image',
    logoHint: 'Upload logo',
    logoNote: 'Logo is displayed as a circle. Square images work best.',

    basic: 'Basic',
    style: 'Style',
    photoSection: 'Photos (used in blocks)',
    gridSection: 'Grid',

    title: 'Title',
    currency: 'Currency',
    priceFormat: 'Force 2 decimals',

    font: 'Font',
    textColor: 'Text color',
    accentColor: 'Accent color',
    lineSpacing: 'Line spacing',
    rowGap: 'Row gap',

    items: 'Items',
    namePH: 'Name',
    pricePH: 'Price (number)',
    addRow: '+ Add item',
    addCell: '+ Add item',
    delete: 'Delete',
    reorderHint: 'Reorder (drag support can be added)',

    photos: `Up to ${MAX_PHOTOS} photos`,
    photoSlot: (n) => `Photo ${n}`,
    upload: 'Upload',
    remove: 'Remove',
    caption: 'Caption',
    photoHint: 'T2 auto-layouts 3–4 photo blocks per page. Each block contains 3–4 menu items.',

    columns: 'Columns',
    note: 'Note',
    gridHint: 'Auto paginates when there are many items.',

    off: 'OFF',
    on: 'ON',

    hint: '* Auto-saved. Press “Save” in preview to apply.',
    close: 'save',
  };

  return lang === 'en' ? en : ko;
}

/* -------------------- RENDER STYLES (variants) -------------------- */

function brandRow(style, variant) {
  return {
    display: 'grid',
    gridTemplateColumns: '84px 1fr auto',
    gap: 14,
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 22,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(0,0,0,0.20))',
    border: '1px solid rgba(255,255,255,0.20)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.28)',
    backdropFilter: 'blur(8px)',
  };
}

function brandLogoWrap(style, variant) {
  return {
    width: 74,
    height: 74,
    borderRadius: 999,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(0,0,0,0.20)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
    display: 'grid',
    placeItems: 'center',
  };
}

function brandLogoEmpty(style) {
  return {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: 1000,
    fontSize: 16,
    letterSpacing: 1,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

function brandNameWrap(style, variant) {
  return { display: 'grid', gap: 2, alignContent: 'center' };
}

function brandName(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 44 : 46,
    fontWeight: 1000,
    lineHeight: 1.04,
    letterSpacing: -0.6,
    fontFamily: style.fontFamily,
    textShadow: '0 8px 22px rgba(0,0,0,0.55)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 700,
  };
}

function brandSub(style, variant) {
  return {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: variant === 'B' ? 0.8 : 0,
    fontFamily: style.fontFamily,
    textShadow: '0 6px 18px rgba(0,0,0,0.55)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 700,
  };
}

function brandChip(style, variant) {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.18)',
    color: 'rgba(255,255,255,0.88)',
    fontWeight: 950,
    fontSize: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    boxShadow: '0 10px 24px rgba(0,0,0,0.22)',
  };
}

function ruleStyle(style, variant) {
  return {
    height: variant === 'B' ? 3 : 2,
    background: style.accentColor,
    borderRadius: 999,
    boxShadow: variant === 'C'
      ? '0 6px 18px rgba(0,0,0,0.35)'
      : '0 4px 14px rgba(0,0,0,0.35)',
  };
}

function continuedStyle(style) {
  return {
    marginTop: 10,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: 900,
    fontSize: 18,
    fontFamily: style.fontFamily,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

function lineStyle(style, variant) {
  const radius = variant === 'B' ? 16 : variant === 'C' ? 22 : 18;
  const bg =
    variant === 'B'
      ? 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))'
      : 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.20))';

  const border = '1px solid rgba(255,255,255,0.18)';
  const shadow = '0 16px 34px rgba(0,0,0,0.26)';

  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 16,
    alignItems: 'baseline',
    padding: variant === 'B' ? '12px 14px' : '14px 16px',
    borderRadius: radius,
    background: bg,
    border,
    boxShadow: shadow,
    fontFamily: style.fontFamily,
    backdropFilter: 'blur(8px)',
  };
}

function nameStyle(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 40 : 44,
    fontWeight: 950,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    letterSpacing: variant === 'B' ? 0.4 : 0,
  };
}

function priceStyle(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 38 : 42,
    fontWeight: 1000,
    opacity: 0.95,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

function photoPlaceholderStyle(style) {
  return {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: 900,
    fontSize: 22,
    padding: 20,
    textAlign: 'center',
    lineHeight: style.lineSpacing,
    fontFamily: style.fontFamily,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

function gridCard(style, variant, minH) {
  const radius = variant === 'B' ? 16 : variant === 'C' ? 26 : 22;
  const bg = 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.20))';
  const border = '1px solid rgba(255,255,255,0.18)';
  const shadow = '0 16px 34px rgba(0,0,0,0.26)';

  return {
    borderRadius: radius,
    padding: variant === 'B' ? 14 : 18,
    background: bg,
    border,
    boxShadow: shadow,
    minHeight: minH,
    display: 'grid',
    gap: 10,
    alignContent: 'start',
    fontFamily: style.fontFamily,
    backdropFilter: 'blur(8px)',
  };
}

function gridName(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 34 : 36,
    fontWeight: 1000,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    letterSpacing: variant === 'C' ? 0.8 : 0.1,
  };
}

function gridPrice(style, variant) {
  return {
    color: style.textColor,
    fontSize: variant === 'B' ? 32 : 34,
    fontWeight: 1000,
    opacity: 0.95,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

/* -------------------- LAYER/PANEL styles -------------------- */

const styles = {
  // ✅ 핵심 FIX: TemplateCanvas가 화면을 덮어도 클릭/터치 이벤트를 "먹지 않게"
  // (비밀 핫스팟/수정 버튼/기타 UI 클릭이 정상 동작)
  layer: {
    position: 'absolute',
    inset: 0,
    zIndex: 45,
    pointerEvents: 'none', // ✅ FIX
  },
};

const ui = {
  // ✅ 패널만 pointerEvents 살려서 입력 가능
  panel: {
    position: 'fixed',
    left: 16,
    top: 90,
    zIndex: 99999,
    width: 'min(440px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 140px)',
    overflow: 'auto',
    background: 'rgba(255,255,255,0.96)',
    borderRadius: 18,
    padding: 12,
    boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
    border: '1px solid rgba(0,0,0,0.06)',
    pointerEvents: 'auto',
  },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  headerLeft: { display: 'grid', gap: 3 },
  kicker: { fontSize: 12, fontWeight: 900, opacity: 0.55 },
  hTitle: { fontSize: 16, fontWeight: 1000, letterSpacing: -0.2 },

  badge: {
    padding: '6px 10px',
    borderRadius: 999,
    background: 'rgba(0,0,0,0.06)',
    fontWeight: 900,
    fontSize: 12,
  },

  closeX: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(0,0,0,0.04)',
    fontWeight: 1100,
    cursor: 'pointer',
    lineHeight: '30px',
  },

  section: {
    background: '#fff',
    borderRadius: 16,
    padding: 10,
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 8px 18px rgba(0,0,0,0.06)',
    marginBottom: 10,
  },
  sectionTitle: { fontWeight: 1000, fontSize: 13, marginBottom: 8, opacity: 0.85 },
  sectionBody: { display: 'grid', gap: 10 },

  field: { display: 'grid', gap: 6 },
  label: { fontSize: 12, fontWeight: 900, opacity: 0.65 },

  input: {
    width: '100%',
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    fontWeight: 900,
    boxSizing: 'border-box',
    outline: 'none',
  },
  inputSm: {
    width: 110,
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    fontWeight: 900,
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    fontWeight: 900,
    background: '#fff',
    outline: 'none',
  },

  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  range: { width: '100%' },

  toggleWrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    overflow: 'hidden',
    background: 'rgba(0,0,0,0.03)',
  },
  toggleBtn: {
    padding: '9px 9px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 1000,
    background: 'transparent',
    opacity: 0.55,
  },
  toggleBtnActive: { background: 'rgba(0,0,0,0.08)', opacity: 1 },

  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 999,
    border: '1px solid rgba(0,0,0,0.15)',
  },
  colorInput: { width: 42, height: 32, border: 'none', background: 'transparent', padding: 0 },

  itemRow: { display: 'grid', gridTemplateColumns: '24px 1fr 130px 36px', gap: 8, alignItems: 'center' },
  dragPill: {
    width: 24,
    height: 36,
    borderRadius: 12,
    background: 'rgba(0,0,0,0.05)',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 1000,
    opacity: 0.45,
    userSelect: 'none',
  },
  rowName: {
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    fontWeight: 900,
    outline: 'none',
  },
  rowPrice: {
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    fontWeight: 1000,
    textAlign: 'right',
    outline: 'none',
  },
  delBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(255,0,0,0.04)',
    fontWeight: 1000,
    cursor: 'pointer',
  },

  addBtn: {
    width: '100%',
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px dashed rgba(0,0,0,0.25)',
    background: '#fff',
    fontWeight: 1000,
    cursor: 'pointer',
    marginTop: 6,
  },

  miniHint: { fontSize: 12, opacity: 0.6, fontWeight: 900 },

  panelHint: { marginTop: 6, fontSize: 12, opacity: 0.75, lineHeight: 1.4, padding: '6px 2px' },

  secondaryBtn: {
    flex: 1,
    padding: '11px 12px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.12)',
    cursor: 'pointer',
    fontWeight: 1000,
    background: '#fff',
  },

  logoRow: {
    display: 'grid',
    gridTemplateColumns: '120px 1fr',
    gap: 12,
    alignItems: 'center',
  },
  logoPreview: {
    width: 110,
    height: 110,
    borderRadius: 22,
    overflow: 'hidden',
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(0,0,0,0.04)',
    boxShadow: '0 8px 18px rgba(0,0,0,0.06)',
    display: 'grid',
    placeItems: 'center',
  },
  logoEmpty: {
    fontWeight: 1000,
    opacity: 0.55,
    fontSize: 12,
    textAlign: 'center',
    padding: 10,
  },
  fileBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    background: '#fff',
    fontWeight: 1000,
    cursor: 'pointer',
    fontSize: 13,
  },
  ghostBtn: {
    padding: '10px 11px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(0,0,0,0.04)',
    fontWeight: 1000,
    cursor: 'pointer',
    fontSize: 13,
  },

  photoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  photoSlot: {
    borderRadius: 14,
    overflow: 'hidden',
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(0,0,0,0.03)',
    height: 140,
    display: 'grid',
    gridTemplateRows: '1fr auto',
  },
  photoEmpty: {
    display: 'grid',
    placeItems: 'center',
    fontWeight: 1000,
    fontSize: 12,
    opacity: 0.55,
  },
  photoSlotBar: {
    display: 'flex',
    gap: 8,
    padding: 8,
    background: 'rgba(255,255,255,0.85)',
  },
  fileBtnSm: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 9px',
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.10)',
    background: '#fff',
    fontWeight: 1000,
    cursor: 'pointer',
    fontSize: 12,
  },
  ghostBtnSm: {
    padding: '7px 9px',
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(0,0,0,0.04)',
    fontWeight: 1000,
    cursor: 'pointer',
    fontSize: 12,
  },
};