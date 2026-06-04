'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const BASE_W = 1080;

const DEFAULT_ROW_H = 92;
const DEFAULT_HEADER_H = 210;
const DEFAULT_PAGE_PADDING_TOP = 70;
const DEFAULT_PAGE_PADDING_X = 70;
const DEFAULT_FOOTER_SPACE = 176;
const FEATURE_RIBBON_H = 168;
const FEATURE_RIBBON_GAP = 18;

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
  viewPageNumber = null,
  directTouchEdit = false,
  directEditCloseSignal = 0,
}) {
  const isPreview = uiMode === 'preview';
  const isEdit = !!editing && !isPreview;

  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [activeTarget, setActiveTarget] = useState(null);
  const [portalHost, setPortalHost] = useState(null);
  const resolvedViewPageNumber = Number(viewPageNumber) > 0 ? Math.floor(Number(viewPageNumber)) : null;

  const t = useMemo(() => getTexts(lang), [lang]);

  // scale 계산
  useEffect(() => {
    if (resolvedViewPageNumber) {
      setScale(1);
      return;
    }

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
  }, [resolvedViewPageNumber]);

  const safe = useMemo(() => normalizeData(templateId, data, lang), [templateId, data, lang]);
  if (!safe) return null;

  const style = safe.style;
  const currency = safe.currency || '$';
  const touchEditing = isEdit && directTouchEdit;
  const photoSlotLabels = useMemo(() => getTemplatePhotoSlotLabels(templateId, lang), [templateId, lang]);

  useEffect(() => {
    setActiveTarget(null);
  }, [templateId]);

  useEffect(() => {
    setActiveTarget(null);
  }, [directEditCloseSignal]);

  useEffect(() => {
    setPortalHost(document.body);
  }, []);

  // ✅ 헤더 로고 업로드
  const onPickLogo = async (file) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    onChange?.({ ...safe, logoSrc: src });
  };

  const removeLogo = () => {
    onChange?.({ ...safe, logoSrc: null });
  };

  const onPickQr = async (file) => {
    if (!file) return;
    const src = await fileToDataUrl(file);
    onChange?.({ ...safe, qrSrc: src });
  };

  const removeQr = () => {
    onChange?.({ ...safe, qrSrc: null });
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
    const nextRows = [...rows];
    while (nextRows.length <= idx) nextRows.push({ section: '', name: '', price: '' });
    nextRows[idx] = { ...nextRows[idx], ...patch };
    onChange?.({ ...safe, rows: nextRows });
  };
  const addRow = () => {
    const rows = Array.isArray(safe?.rows) ? safe.rows : [];
    const lastSection = [...rows].reverse().find((row) => row?.section)?.section || '';
    onChange?.({ ...safe, rows: [...rows, { section: lastSection, name: '', price: '' }] });
  };
  const removeRow = (idx) => {
    const rows = Array.isArray(safe?.rows) ? safe.rows : [];
    onChange?.({ ...safe, rows: rows.filter((_, i) => i !== idx) });
  };

  // cells (T3)
  const updateCell = (idx, patch) => {
    const cells = Array.isArray(safe?.cells) ? safe.cells : [];
    const nextCells = [...cells];
    while (nextCells.length <= idx) nextCells.push({ section: '', name: '', price: '' });
    nextCells[idx] = { ...nextCells[idx], ...patch };
    onChange?.({ ...safe, cells: nextCells });
  };
  const addCell = () => {
    const cells = Array.isArray(safe?.cells) ? safe.cells : [];
    const lastSection = [...cells].reverse().find((cell) => cell?.section)?.section || '';
    onChange?.({ ...safe, cells: [...cells, { section: lastSection, name: '', price: '' }] });
  };
  const removeCell = (idx) => {
    const cells = Array.isArray(safe?.cells) ? safe.cells : [];
    onChange?.({ ...safe, cells: cells.filter((_, i) => i !== idx) });
  };

  const setStyle = (patch) => {
    onChange?.({ ...safe, style: { ...style, ...patch } });
  };

  const openTouchEditor = (target) => {
    if (!touchEditing) return;
    setActiveTarget(target);
    onTogglePanel?.(false);
  };

  // ✅ templateId는 "T2B" 같은 fullId
  const group = (templateId || '').slice(0, 2); // T1/T2/T3
  const variant = (templateId || '').slice(2, 3) || 'A'; // A/B/C
  const premiumKey = getPremiumTemplateKey(style);

  return (
    <>
      {/* Render layer */}
      <div
        ref={wrapRef}
        style={{
          ...styles.layer,
          pointerEvents: touchEditing ? 'auto' : 'none',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: BASE_W,
            height: resolvedViewPageNumber ? pageHeight : Math.ceil((fullScrollHeight || pageHeight) / scale),
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'relative',
            pointerEvents: touchEditing ? 'auto' : 'none',
          }}
        >
          {premiumKey && (
            <PremiumTabletTemplate
              templateKey={premiumKey}
              lang={lang}
              data={safe}
              currency={currency}
              pageHeight={pageHeight}
              pageGap={pageGap}
              renderPageNumber={resolvedViewPageNumber}
              editing={touchEditing}
              onEditBrand={() => openTouchEditor({ type: 'brand' })}
              onEditRow={(index) => openTouchEditor({ type: 'row', index })}
              onEditCell={(index) => openTouchEditor({ type: 'cell', index })}
              onEditPhoto={(index) => openTouchEditor({ type: 'photo', index })}
            />
          )}

          {!premiumKey && group === 'T1' && (
            <PagedList
              variant={variant}
              title={safe.title}
              restaurantName={safe.restaurantName}
              logoSrc={safe.logoSrc}
              tagline={safe.tagline}
              phone={safe.phone}
              website={safe.website}
              footerText={safe.footerText}
              photos={safe.photos || []}
              rows={safe.rows || []}
              currency={currency}
              style={style}
              pageHeight={pageHeight}
              pageGap={pageGap}
              renderPageNumber={resolvedViewPageNumber}
              editing={touchEditing}
              onEditBrand={() => openTouchEditor({ type: 'brand' })}
              onEditRow={(index) => openTouchEditor({ type: 'row', index })}
              onEditPhoto={(index) => openTouchEditor({ type: 'photo', index })}
            />
          )}

          {!premiumKey && group === 'T2' && (
            <PagedPhotoList
              variant={variant}
              title={safe.title}
              restaurantName={safe.restaurantName}
              logoSrc={safe.logoSrc}
              tagline={safe.tagline}
              phone={safe.phone}
              website={safe.website}
              footerText={safe.footerText}
              rows={safe.rows || []}
              currency={currency}
              photos={safe.photos || []}
              caption={safe.caption}
              style={style}
              pageHeight={pageHeight}
              pageGap={pageGap}
              renderPageNumber={resolvedViewPageNumber}
              editing={touchEditing}
              onEditBrand={() => openTouchEditor({ type: 'brand' })}
              onEditRow={(index) => openTouchEditor({ type: 'row', index })}
              onEditPhoto={(index) => openTouchEditor({ type: 'photo', index })}
            />
          )}

          {!premiumKey && group === 'T3' && (
            <PagedGrid
              variant={variant}
              title={safe.title}
              restaurantName={safe.restaurantName}
              logoSrc={safe.logoSrc}
              tagline={safe.tagline}
              phone={safe.phone}
              website={safe.website}
              footerText={safe.footerText}
              photos={safe.photos || []}
              cells={safe.cells || []}
              currency={currency}
              columns={safe.columns || 2}
              style={style}
              pageHeight={pageHeight}
              pageGap={pageGap}
              renderPageNumber={resolvedViewPageNumber}
              editing={touchEditing}
              onEditBrand={() => openTouchEditor({ type: 'brand' })}
              onEditCell={(index) => openTouchEditor({ type: 'cell', index })}
              onEditPhoto={(index) => openTouchEditor({ type: 'photo', index })}
            />
          )}
        </div>
      </div>

      {/* Input panel */}
      {isEdit && panelOpen && !directTouchEdit && (
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

          <Section title={t.storeInfo}>
            <Field label={t.tagline}>
              <input
                value={safe.tagline || ''}
                onChange={(e) => onChange?.({ ...safe, tagline: e.target.value })}
                style={ui.input}
                placeholder="DINE-IN · TAKEOUT · DELIVERY"
              />
            </Field>

            <div style={ui.row2}>
              <Field label={t.phone}>
                <input
                  value={safe.phone || ''}
                  onChange={(e) => onChange?.({ ...safe, phone: e.target.value })}
                  style={ui.input}
                  placeholder="+1 555 123 4567"
                />
              </Field>

              <Field label={t.website}>
                <input
                  value={safe.website || ''}
                  onChange={(e) => onChange?.({ ...safe, website: e.target.value })}
                  style={ui.input}
                  placeholder="yourrestaurant.com"
                />
              </Field>
            </div>

            <Field label={t.footerText}>
              <input
                value={safe.footerText || ''}
                onChange={(e) => onChange?.({ ...safe, footerText: e.target.value })}
                style={ui.input}
                placeholder={lang === 'ko' ? '예: 매일 신선하게 준비합니다' : 'e.g., Fresh food made daily'}
              />
            </Field>
          </Section>

          <Section title={t.qrSettings}>
            <Field label={t.qrImage}>
              <div style={ui.logoRow}>
                <div style={ui.qrPreview}>
                  {safe.qrSrc ? (
                    <img src={safe.qrSrc} alt="order qr preview" style={ui.qrPreviewImg} draggable={false} />
                  ) : (
                    <div style={ui.logoEmpty}>{t.qrHint}</div>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                  <label style={ui.fileBtn}>
                    {t.upload}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => onPickQr(e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    style={{ ...ui.ghostBtn, opacity: safe.qrSrc ? 1 : 0.35 }}
                    onClick={() => safe.qrSrc && removeQr()}
                    disabled={!safe.qrSrc}
                  >
                    {t.remove}
                  </button>
                </div>
              </div>
            </Field>

            <Field label={t.orderUrl}>
              <input
                value={safe.orderUrl || ''}
                onChange={(e) => onChange?.({ ...safe, orderUrl: e.target.value })}
                style={ui.input}
                placeholder="https://your-order-site.com/table/12"
              />
            </Field>
            <div style={ui.miniHint}>{t.qrNote}</div>
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

          {/* ✅ 사진 업로드 입력 UI: 모든 템플릿에서 대표 사진/메뉴 사진으로 사용 */}
          {(group === 'T1' || group === 'T2' || group === 'T3') && (
            <Section title={t.photoSection}>
              <Field label={t.photos}>
                <div style={ui.photoGrid}>
                  {Array.from({ length: MAX_PHOTOS }).map((_, idx) => {
                    const src = safe.photos?.[idx] || null;
                    const slotLabel = photoSlotLabels[idx] || t.photoSlot(idx + 1);
                    return (
                      <div key={idx} style={ui.photoSlot}>
                        {src ? (
                          <>
                            <img
                              src={src}
                              alt={`photo-${idx}`}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              draggable={false}
                            />
                            <div style={ui.photoSlotLabel}>{slotLabel}</div>
                          </>
                        ) : (
                          <div style={ui.photoEmpty}>{slotLabel}</div>
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
                    value={r.section || ''}
                    onChange={(e) => updateRow(idx, { section: e.target.value })}
                    placeholder={t.sectionPH}
                    style={ui.rowSection}
                  />
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
                    value={c.section || ''}
                    onChange={(e) => updateCell(idx, { section: e.target.value })}
                    placeholder={t.sectionPH}
                    style={ui.rowSection}
                  />
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
            <button style={ui.secondaryBtn} onClick={() => onTogglePanel?.(false)}>{t.close}</button>
          </div>
        </div>
      )}

      {touchEditing && activeTarget && portalHost ? createPortal(
        <DirectEditSheet
          lang={lang}
          target={activeTarget}
          safe={safe}
          style={style}
          row={activeTarget.type === 'row' ? safe.rows?.[activeTarget.index] : null}
          cell={activeTarget.type === 'cell' ? safe.cells?.[activeTarget.index] : null}
          photoSrc={activeTarget.type === 'photo' ? safe.photos?.[activeTarget.index] : null}
          onClose={() => setActiveTarget(null)}
          onChange={(patch) => onChange?.({ ...safe, ...patch })}
          onChangeStyle={(patch) => setStyle(patch)}
          onChangeRow={(patch) => {
            if (Number.isInteger(activeTarget.index)) updateRow(activeTarget.index, patch);
          }}
          onChangeCell={(patch) => {
            if (Number.isInteger(activeTarget.index)) updateCell(activeTarget.index, patch);
          }}
          onPickLogo={onPickLogo}
          onRemoveLogo={removeLogo}
          onPickQr={onPickQr}
          onRemoveQr={removeQr}
          onPickPhoto={(file) => onPickPhoto(file, activeTarget.index)}
          onRemovePhoto={() => removePhoto(activeTarget.index)}
        />,
        portalHost
      ) : null}
    </>
  );
}

function DirectEditSheet({
  lang,
  target,
  safe,
  style,
  row,
  cell,
  photoSrc,
  onClose,
  onChange,
  onChangeStyle,
  onChangeRow,
  onChangeCell,
  onPickLogo,
  onRemoveLogo,
  onPickQr,
  onRemoveQr,
  onPickPhoto,
  onRemovePhoto,
}) {
  const ko = lang === 'ko';
  const title =
    target.type === 'brand' ? (ko ? '브랜드 수정' : 'Brand') :
    target.type === 'photo' ? (ko ? `사진 ${target.index + 1}` : `Photo ${target.index + 1}`) :
    ko ? '메뉴 항목 수정' : 'Menu item';
  const item = target.type === 'cell' ? cell : row;
  const updateItem = target.type === 'cell' ? onChangeCell : onChangeRow;

  return (
    <div style={touch.sheet} onMouseDown={(e) => e.stopPropagation()}>
      <div style={touch.handle} />
      <div style={touch.top}>
        <div>
          <div style={touch.kicker}>{ko ? '화면에서 선택됨' : 'Selected on board'}</div>
          <div style={touch.title}>{title}</div>
        </div>
        <button type="button" style={touch.close} onClick={onClose}>×</button>
      </div>

      {target.type === 'brand' && (
        <div style={touch.grid}>
          <TouchField label={ko ? '가게 이름' : 'Restaurant name'}>
            <input
              value={safe.restaurantName || ''}
              onChange={(e) => onChange?.({ restaurantName: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '메뉴 제목' : 'Menu title'}>
            <input
              value={safe.title || ''}
              onChange={(e) => onChange?.({ title: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '상단 문구' : 'Top tagline'}>
            <input
              value={safe.tagline || ''}
              onChange={(e) => onChange?.({ tagline: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '하단 문구' : 'Footer note'}>
            <input
              value={safe.footerText || ''}
              onChange={(e) => onChange?.({ footerText: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '전화번호' : 'Phone'}>
            <input
              value={safe.phone || ''}
              onChange={(e) => onChange?.({ phone: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '웹사이트' : 'Website'}>
            <input
              value={safe.website || ''}
              onChange={(e) => onChange?.({ website: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '주문 URL' : 'Order URL'}>
            <input
              value={safe.orderUrl || ''}
              onChange={(e) => onChange?.({ orderUrl: e.target.value })}
              style={touch.input}
              placeholder="https://your-order-site.com/table/12"
            />
          </TouchField>

          <TouchField label={ko ? '로고' : 'Logo'}>
            <div style={touch.mediaRow}>
              <div style={touch.logoPreview}>
                {safe.logoSrc ? (
                  <img src={safe.logoSrc} alt="" style={touch.previewImg} draggable={false} />
                ) : (
                  <span>{ko ? '로고 없음' : 'No logo'}</span>
                )}
              </div>
              <label style={touch.primaryLabel}>
                {ko ? '로고 변경' : 'Change logo'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => onPickLogo?.(e.target.files?.[0])}
                />
              </label>
              <button type="button" style={touch.secondaryBtn} onClick={onRemoveLogo}>
                {ko ? '삭제' : 'Remove'}
              </button>
            </div>
          </TouchField>

          <TouchField label={ko ? 'QR 코드' : 'QR code'}>
            <div style={touch.mediaRow}>
              <div style={touch.logoPreview}>
                {safe.qrSrc ? (
                  <img src={safe.qrSrc} alt="" style={touch.previewImgContain} draggable={false} />
                ) : (
                  <span>{ko ? 'QR 없음' : 'No QR'}</span>
                )}
              </div>
              <label style={touch.primaryLabel}>
                {ko ? 'QR 변경' : 'Change QR'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => onPickQr?.(e.target.files?.[0])}
                />
              </label>
              <button type="button" style={touch.secondaryBtn} onClick={onRemoveQr}>
                {ko ? '삭제' : 'Remove'}
              </button>
            </div>
          </TouchField>

          <TouchField label={ko ? '포인트 색' : 'Accent color'}>
            <input
              type="color"
              value={style.accentColor || '#f8d36a'}
              onChange={(e) => onChangeStyle?.({ accentColor: e.target.value })}
              style={touch.color}
            />
          </TouchField>
        </div>
      )}

      {(target.type === 'row' || target.type === 'cell') && (
        <div style={touch.grid}>
          <TouchField label={ko ? '카테고리' : 'Category'}>
            <input
              value={item?.section || ''}
              onChange={(e) => updateItem?.({ section: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '메뉴명' : 'Menu name'}>
            <input
              value={item?.name || ''}
              onChange={(e) => updateItem?.({ name: e.target.value })}
              style={touch.input}
            />
          </TouchField>

          <TouchField label={ko ? '가격' : 'Price'}>
            <input
              value={item?.price || ''}
              onChange={(e) => updateItem?.({ price: e.target.value })}
              style={touch.input}
              inputMode="decimal"
            />
          </TouchField>
        </div>
      )}

      {target.type === 'photo' && (
        <div style={touch.grid}>
          <div style={touch.photoPreview}>
            {photoSrc ? (
              <img src={photoSrc} alt="" style={touch.previewImg} draggable={false} />
            ) : (
              <span>{ko ? '사진 없음' : 'No photo'}</span>
            )}
          </div>

          <div style={touch.mediaActions}>
            <label style={touch.primaryLabel}>
              {ko ? '사진 변경' : 'Change photo'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => onPickPhoto?.(e.target.files?.[0])}
              />
            </label>
            <button type="button" style={touch.secondaryBtn} onClick={onRemovePhoto}>
              {ko ? '삭제' : 'Remove'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TouchField({ label, children }) {
  return (
    <label style={touch.field}>
      <span style={touch.label}>{label}</span>
      {children}
    </label>
  );
}

/* -------------------- PREMIUM 2026 TABLET TEMPLATES -------------------- */

function getPremiumTemplateKey(style = {}) {
  const key = String(style?.templateKey || '').slice(0, 3);
  return ['T1A', 'T2A', 'T3A'].includes(key) ? key : null;
}

function PremiumTabletTemplate({
  templateKey,
  lang = 'en',
  data,
  currency,
  pageHeight,
  pageGap = 40,
  renderPageNumber = null,
  editing = false,
  onEditBrand,
  onEditRow,
  onEditCell,
  onEditPhoto,
}) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const cells = Array.isArray(data.cells) ? data.cells : [];
  const items = (templateKey === 'T3A' ? cells : rows).map((item, index) => ({ ...item, __index: index }));
  const photos = getPremiumPhotos(templateKey, data.photos);
  const style = data.style || {};
  const touchable = editing ? editableSurfaceStyle : null;
  const pages = renderPageNumber ? [Number(renderPageNumber)] : [1, 2, 3];

  return (
    <>
      {pages.map((page) => {
        const top = renderPageNumber ? 0 : (page - 1) * (pageHeight + pageGap);
        return (
          <div key={page} style={{ position: 'absolute', left: 0, right: 0, top, height: pageHeight }}>
            {templateKey === 'T2A' ? (
              <PremiumKoreanPage
                page={page}
                lang={lang}
                data={data}
                items={items}
                photos={photos}
                currency={currency}
                style={style}
                touchable={touchable}
                editing={editing}
                onEditBrand={onEditBrand}
                onEditItem={onEditRow}
                onEditPhoto={onEditPhoto}
                pageHeight={pageHeight}
              />
            ) : templateKey === 'T3A' ? (
              <PremiumFusionPage
                page={page}
                lang={lang}
                data={data}
                items={items}
                photos={photos}
                currency={currency}
                style={style}
                touchable={touchable}
                editing={editing}
                onEditBrand={onEditBrand}
                onEditItem={onEditCell}
                onEditPhoto={onEditPhoto}
                pageHeight={pageHeight}
              />
            ) : (
              <PremiumSteakPage
                page={page}
                lang={lang}
                data={data}
                items={items}
                photos={photos}
                currency={currency}
                style={style}
                touchable={touchable}
                editing={editing}
                onEditBrand={onEditBrand}
                onEditItem={onEditRow}
                onEditPhoto={onEditPhoto}
                pageHeight={pageHeight}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function PremiumSteakPage({ page, lang, data, items, photos, currency, style, touchable, editing, onEditBrand, onEditItem, onEditPhoto, pageHeight }) {
  const ko = lang === 'ko';
  const pageItems = page === 1 ? items.slice(0, 10) : page === 2 ? items.slice(4, 24) : items.slice(18, 28);
  const slotLabels = getTemplatePhotoSlotLabels('T1A', lang);
  return (
    <div style={premium.root('steak', pageHeight)}>
      <PremiumBgPhoto src={photos[0]} mode="dark" />
      <div style={premium.steakVignette} />
      <PremiumHeader lang={lang} data={data} tone="dark" accent="#d7b46a" title={`A-${page}`} editing={editing} onEditBrand={onEditBrand} />
      {page === 1 ? (
        <>
          <div style={premium.steakHero}>
            <button type="button" style={{ position: 'relative', ...premium.steakHeroPhoto, ...touchable }} onClick={editing ? stopThen(() => onEditPhoto?.(0)) : undefined}>
              <img src={photos[0]} alt="" style={premium.imgCover} draggable={false} />
              {editing ? <div style={premium.photoSlotBadge('gold')}>{slotLabels[0]}</div> : null}
            </button>
            <div style={premium.steakHeroCard}>
              <div style={premium.steakEyebrow}>{ko ? '셰프 프라임 셀렉션' : "Chef's Prime Selection"}</div>
              <div style={premium.steakTitle}>{data.title || 'Prime Dinner Menu'}</div>
              <div style={premium.steakDesc}>{ko ? '대표 스테이크, 해산물, 와인 페어링을 호텔 다이닝 메뉴북처럼 큼직하게 보여줍니다.' : 'A hotel-style steakhouse menu book built around prime cuts, seafood, wine pairing, and table QR ordering.'}</div>
              <PremiumCategoryRail items={ko ? ['애피타이저', '스테이크', '해산물', '파스타', '와인'] : ['Appetizers', 'Steak', 'Seafood', 'Pasta', 'Wine']} mode="gold" />
            </div>
          </div>
          <div style={premium.pageOneStrip}>
            <PremiumPhotoButton src={photos[1]} styleObj={premium.stripPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(1) : null} slotLabel={editing ? slotLabels[1] : null} slotTone="gold" />
            <div style={premium.signatureStack('gold')}>
              <PremiumFeatureCard label={ko ? '시그니처' : 'Signature Dish'} item={pageItems[4] || pageItems[0]} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="gold" editing={editing} onEditItem={onEditItem} />
              <PremiumFeatureCard label={ko ? '셰프 추천' : "Chef's Choice"} item={pageItems[6] || pageItems[1]} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="gold" editing={editing} onEditItem={onEditItem} />
              <PremiumFeatureCard label={ko ? '베스트 셀러' : 'Best Seller'} item={pageItems[7] || pageItems[2]} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="gold" editing={editing} onEditItem={onEditItem} />
              <PremiumSectionColumns items={pageItems.slice(0, 6)} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="gold" editing={editing} onEditItem={onEditItem} columns={1} maxPerColumn={6} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={premium.menuPageHero}>
            <PremiumPhotoButton src={photos[page === 2 ? 1 : 2]} styleObj={premium.widePhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(page === 2 ? 1 : 2) : null} slotLabel={editing ? slotLabels[page === 2 ? 1 : 2] : null} slotTone="gold" />
            <div style={premium.pageIntro('gold')}>
              <div style={premium.pageKicker('gold')}>{page === 2 ? (ko ? '전체 메뉴 탐색' : 'Full Menu Discovery') : (ko ? '와인 · 디저트 · 시즌 메뉴' : 'Wine, Dessert & Seasonal Finish')}</div>
              <div style={premium.pageTitle}>{page === 2 ? (ko ? '스테이크, 해산물, 파스타' : 'Steak, Seafood & Pasta') : (ko ? '디저트, 와인, 음료' : 'Dessert, Wine & Beverage')}</div>
              <div style={premium.pageBody}>{ko ? '태블릿에서 메뉴를 확인한 뒤, 준비되면 테이블 QR을 스캔해 휴대폰에서 주문합니다.' : 'Browse the tablet menu, then scan QR when ready to order from your phone.'}</div>
            </div>
          </div>
          <PremiumSectionColumns items={pageItems} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="gold" editing={editing} onEditItem={onEditItem} columns={2} maxPerColumn={page === 3 ? 5 : 10} />
          {page === 3 ? (
            <div style={premium.featureBand('gold')}>
              <PremiumPhotoButton src={photos[1]} styleObj={premium.featureBandPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(1) : null} slotLabel={editing ? slotLabels[1] : null} slotTone="gold" />
              <div style={premium.featureBandCopy('gold')}>
                <div style={premium.featureBandKicker('gold')}>{ko ? '오늘의 페어링' : "Tonight's Pairing"}</div>
                <div style={premium.featureBandTitle('gold')}>{ko ? '와인 서비스와 디저트 페어링은 QR 주문 화면에서 바로 확인하세요.' : 'Reserve wine service and dessert pairing by scanning the QR.'}</div>
                <div style={premium.featureBandText('gold')}>{ko ? '태블릿은 메뉴북 역할에 집중하고, 주문과 결제는 손님의 휴대폰에서 이어집니다.' : "Tablet is for discovery. Orders and payment continue from the guest's phone."}</div>
              </div>
            </div>
          ) : null}
        </>
      )}
      <PremiumSteakQrDock lang={lang} phone={data.phone} qrSrc={data.qrSrc} orderUrl={data.orderUrl} footerText={data.footerText || 'Order on Your Phone'} disabled={editing} onEdit={editing ? onEditBrand : null} />
    </div>
  );
}

function PremiumKoreanPage({ page, lang, data, items, photos, currency, style, touchable, editing, onEditBrand, onEditItem, onEditPhoto, pageHeight }) {
  const ko = lang === 'ko';
  const pageItems = page === 1 ? items.slice(0, 12) : page === 2 ? items.slice(0, 22) : items.slice(14, 28);
  const slotLabels = getTemplatePhotoSlotLabels('T2A', lang);
  return (
    <div style={premium.root('korean', pageHeight)}>
      <PremiumBgPhoto src={photos[0]} mode="soft" />
      <div style={premium.koreanTexture} />
      <PremiumHeader lang={lang} data={data} tone="light" accent="#7a4b25" title={`B-${page}`} editing={editing} onEditBrand={onEditBrand} />
      {page === 1 ? (
        <>
          <div style={premium.koreanSobanStage}>
            <PremiumPhotoButton src={photos[0]} styleObj={premium.koreanSobanHero} touchable={touchable} onClick={editing ? () => onEditPhoto?.(0) : null} slotLabel={editing ? slotLabels[0] : null} slotTone="wood">
              <div style={premium.koreanPhotoLabel}>{ko ? '오늘의 반상 · 계절 한상' : 'Seasonal Bansang · House Table'}</div>
            </PremiumPhotoButton>
            <div style={premium.koreanSobanStory}>
              <div style={premium.koreanKicker}>{ko ? '소반에 담은 계절 한식' : 'Modern Korean Table'}</div>
              <div style={premium.koreanTitle}>{data.restaurantName || '한소반'}</div>
              <div style={premium.koreanBody}>{ko ? '전통 반상의 정갈함과 현대적인 플레이팅을 한 화면에 담은 프리미엄 태블릿 메뉴북입니다.' : 'A warm tablet menu book for Korean grill, soup, noodles, shareable plates, and table-specific QR ordering.'}</div>
              <div style={premium.koreanStoryGrid}>
                <PremiumFeatureCard label={ko ? '시그니처' : 'Signature Dish'} item={pageItems[0]} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="wood" editing={editing} onEditItem={onEditItem} compact />
                <PremiumFeatureCard label={ko ? '셰프 추천' : "Chef's Choice"} item={pageItems[1]} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="wood" editing={editing} onEditItem={onEditItem} compact />
              </div>
            </div>
          </div>
          <div style={premium.koreanBansangRow}>
            <PremiumPhotoButton src={photos[1]} styleObj={premium.koreanSidePhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(1) : null} slotLabel={editing ? slotLabels[1] : null} slotTone="wood" />
            <div style={premium.koreanBanchanPanel}>
              <div style={premium.panelKicker('wood')}>Banchan · Soup · Grill</div>
              <PremiumSectionColumns items={pageItems.slice(2, 10)} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="wood" editing={editing} onEditItem={onEditItem} columns={1} maxPerColumn={8} />
            </div>
            <PremiumPhotoButton src={photos[2]} styleObj={premium.koreanSidePhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(2) : null} slotLabel={editing ? slotLabels[2] : null} slotTone="wood" />
          </div>
        </>
      ) : (
        <>
          {page === 2 ? (
            <>
              <div style={premium.koreanMenuExplorer}>
                <div style={premium.koreanCategoryBook}>
                  <div style={premium.panelKicker('wood')}>{ko ? '전체 메뉴 탐색' : 'Full Menu Discovery'}</div>
                  <div style={premium.koreanBookTitle}>{ko ? '구이, 찌개, 면, 곁들임' : 'Grill, Soup, Noodles, Shareables'}</div>
                  <PremiumCategoryRail items={ko ? ['시그니처', '구이', '찌개', '면', '곁들임', '디저트'] : ['Signature', 'BBQ', 'Soup', 'Noodles', 'Shareable', 'Dessert']} mode="wood" />
                </div>
                <PremiumPhotoButton src={photos[1]} styleObj={premium.koreanTallPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(1) : null} slotLabel={editing ? slotLabels[1] : null} slotTone="wood" />
                <PremiumPhotoButton src={photos[2]} styleObj={premium.koreanTallPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(2) : null} slotLabel={editing ? slotLabels[2] : null} slotTone="wood" />
              </div>
              <PremiumSectionColumns items={pageItems} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="wood" editing={editing} onEditItem={onEditItem} columns={2} maxPerColumn={11} />
            </>
          ) : (
            <>
              <div style={premium.koreanClosingPage}>
                <PremiumPhotoButton src={photos[0]} styleObj={premium.koreanClosingPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(0) : null} slotLabel={editing ? slotLabels[0] : null} slotTone="wood" />
                <div style={premium.koreanClosingCopy}>
                  <div style={premium.panelKicker('wood')}>{ko ? '디저트 · 음료 · 계절 추천' : 'Dessert · Drinks · Seasonal'}</div>
                  <div style={premium.koreanBookTitle}>{ko ? '식혜, 호떡, 계절 반상 추천' : 'Dessert, Drinks, Seasonal Specials'}</div>
                  <div style={premium.koreanBody}>{ko ? '음식은 태블릿에서 천천히 보고, 주문은 테이블 QR을 스캔해 개인 휴대폰에서 진행합니다.' : 'Browse the menu book on the tablet, then scan the table QR to continue ordering on your phone.'}</div>
                  <PremiumSectionColumns items={pageItems} currency={currency} forceTwoDecimals={style.forceTwoDecimals} mode="wood" editing={editing} onEditItem={onEditItem} columns={1} maxPerColumn={8} />
                </div>
              </div>
            </>
          )}
          {page === 3 ? (
            <div style={premium.featureBand('wood')}>
              <PremiumPhotoButton src={photos[1]} styleObj={premium.featureBandPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(1) : null} slotLabel={editing ? slotLabels[1] : null} slotTone="wood" />
              <div style={premium.featureBandCopy('wood')}>
                <div style={premium.featureBandKicker('wood')}>{ko ? '계절 한상' : 'Seasonal Table'}</div>
                <div style={premium.featureBandTitle('wood')}>{ko ? '음료, 디저트, 오늘의 추천은 테이블 QR에서 바로 주문할 수 있습니다.' : 'Scan the table QR for drinks, dessert, and daily specials.'}</div>
                <div style={premium.featureBandText('wood')}>{ko ? '손님은 태블릿에서 메뉴를 보고, 주문은 본인 휴대폰에서 이어갑니다.' : 'Guests browse the menu book here, then continue ordering from their own phone.'}</div>
              </div>
            </div>
          ) : null}
        </>
      )}
      <PremiumKoreanQrDock lang={lang} phone={data.phone} qrSrc={data.qrSrc} orderUrl={data.orderUrl} footerText={data.footerText || 'Order on Your Phone'} disabled={editing} onEdit={editing ? onEditBrand : null} />
    </div>
  );
}

function PremiumFusionPage({ page, lang, data, items, photos, currency, style, touchable, editing, onEditBrand, onEditItem, onEditPhoto, pageHeight }) {
  const ko = lang === 'ko';
  const pageItems = page === 1 ? items.slice(0, 10) : page === 2 ? items.slice(0, 24) : items.slice(12, 30);
  const slotLabels = getTemplatePhotoSlotLabels('T3A', lang);
  return (
    <div style={premium.root('fusion', pageHeight)}>
      <PremiumBgPhoto src={photos[0]} mode="fusion" />
      <div style={premium.fusionOverlay} />
      <PremiumHeader lang={lang} data={data} tone="dark" accent="#ff3d9a" title={`C-${page}`} editing={editing} onEditBrand={onEditBrand} />
      {page === 1 ? (
        <>
          <div style={premium.fusionHero}>
            <div style={premium.fusionCopy}>
              <div style={premium.fusionKicker}>{ko ? '스시 · 라멘 · 이자카야 · 칵테일' : 'Sushi · Ramen · Izakaya · Cocktails'}</div>
              <div style={premium.fusionTitle}>{data.restaurantName || 'Neon Umami'}</div>
              <div style={premium.fusionBody}>{ko ? '사진 중심의 아시안 퓨전 메뉴북입니다. 손님은 태블릿에서 메뉴를 보고 QR로 휴대폰 주문을 이어갑니다.' : 'Visual-first Asian fusion menu for guests to discover dishes on tablet and order by QR.'}</div>
              <div style={premium.fusionPulse}>{ko ? '베스트 셀러 · 야식 · 쉐어 플레이트' : 'Best Seller · Late Night · Share Plates'}</div>
            </div>
            <PremiumPhotoButton src={photos[0]} styleObj={premium.fusionHeroPhoto} touchable={touchable} onClick={editing ? () => onEditPhoto?.(0) : null} slotLabel={editing ? slotLabels[0] : null} slotTone="neon" />
          </div>
          <div style={premium.fusionPageOne}>
            {[1, 2].map((photoIndex) => <PremiumPhotoButton key={photoIndex} src={photos[photoIndex]} styleObj={premium.fusionPhotoTile} touchable={touchable} onClick={editing ? () => onEditPhoto?.(photoIndex) : null} slotLabel={editing ? slotLabels[photoIndex] : null} slotTone="neon" />)}
            <PremiumTileMenu items={pageItems} currency={currency} forceTwoDecimals={style.forceTwoDecimals} editing={editing} onEditItem={onEditItem} />
          </div>
        </>
      ) : (
        <div style={premium.fusionGrid}>
          {[0, 1, 2, 3].map((photoIndex) => (
            <PremiumPhotoButton key={photoIndex} src={photos[photoIndex]} styleObj={premium.fusionPhotoTile} touchable={touchable} onClick={editing ? () => onEditPhoto?.(photoIndex) : null} slotLabel={editing ? slotLabels[photoIndex] : null} slotTone="neon" />
          ))}
          <div style={premium.fusionMenuPanel}>
            <PremiumTileMenu items={pageItems} currency={currency} forceTwoDecimals={style.forceTwoDecimals} editing={editing} onEditItem={onEditItem} />
          </div>
        </div>
      )}
      <PremiumFusionQrDock lang={lang} phone={data.phone} qrSrc={data.qrSrc} orderUrl={data.orderUrl} footerText={data.footerText || 'Order on Your Phone'} disabled={editing} onEdit={editing ? onEditBrand : null} />
    </div>
  );
}

function PremiumPhotoButton({ src, styleObj, touchable, onClick, children, slotLabel = null, slotTone = 'gold' }) {
  return (
    <button type="button" style={{ position: 'relative', ...styleObj, ...touchable }} onClick={onClick ? stopThen(onClick) : undefined}>
      <img src={src} alt="" style={premium.imgCover} draggable={false} />
      {children}
      {slotLabel ? <div style={premium.photoSlotBadge(slotTone)}>{slotLabel}</div> : null}
    </button>
  );
}

function brandMark(name) {
  const text = String(name || '').trim();
  if (!text) return 'MENU';
  if (/[가-힣]/.test(text)) return text.replace(/\s+/g, '').slice(0, 2);
  const initials = text
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return (initials || text.slice(0, 2)).toUpperCase();
}

function PremiumHeader({ lang, data, tone, accent, title, editing, onEditBrand }) {
  const dark = tone === 'dark';
  const ko = lang === 'ko';
  return (
    <button type="button" style={{ ...premium.header, ...(dark ? premium.headerDark : premium.headerLight), ...(editing ? editableSurfaceStyle : null) }} onClick={editing ? stopThen(onEditBrand) : undefined}>
      <div style={{ ...premium.logo, borderColor: accent }}>
        {data.logoSrc ? <img src={data.logoSrc} alt="" style={premium.imgCover} draggable={false} /> : <span>{brandMark(data.restaurantName)}</span>}
      </div>
      <div style={premium.headerText}>
        <div style={{ ...premium.brand, color: dark ? '#fffaf0' : '#2d1c10' }}>{data.restaurantName || 'Restaurant'}</div>
        <div style={{ ...premium.subtitle, color: dark ? 'rgba(255,246,222,0.72)' : 'rgba(82,52,30,0.72)' }}>
          {data.tagline || title}
        </div>
      </div>
      <div style={{ ...premium.headerPill, color: dark ? '#111' : '#fff', background: accent }}>
        {ko ? '메뉴북' : 'Menu Book'}
      </div>
    </button>
  );
}

function PremiumBgPhoto({ src, mode }) {
  return (
    <div style={premium.bgWrap}>
      <img src={src} alt="" style={{ ...premium.imgCover, filter: mode === 'soft' ? 'blur(22px) saturate(1.08)' : 'blur(28px) saturate(1.25)' }} draggable={false} />
    </div>
  );
}

function PremiumCategoryRail({ items, mode }) {
  return (
    <div style={premium.categoryRail}>
      {items.map((item) => (
        <div key={item} style={premium.categoryPill(mode)}>{item}</div>
      ))}
    </div>
  );
}

function PremiumFeatureCard({ label, item, currency, forceTwoDecimals, mode, editing, onEditItem, compact = false }) {
  if (!item) return null;
  return (
    <button
      type="button"
      style={{ ...premium.featureCard(mode, compact), ...(editing ? editableSurfaceStyle : null) }}
      onClick={editing ? stopThen(() => onEditItem?.(item.__index)) : undefined}
    >
      <div style={premium.featureCardLabel(mode)}>{label}</div>
      <div style={premium.featureCardName(mode)}>{item.name}</div>
      <div style={premium.featureCardMeta(mode)}>
        <span>{normalizeSection(item.section) || 'Signature'}</span>
        <strong>{formatPrice(item.price, currency, forceTwoDecimals)}</strong>
      </div>
    </button>
  );
}

function PremiumSectionColumns({ items, currency, forceTwoDecimals, mode, editing, onEditItem, columns, maxPerColumn }) {
  const visible = items.slice(0, columns * maxPerColumn);
  const buckets = Array.from({ length: columns }, (_, col) => visible.slice(col * maxPerColumn, (col + 1) * maxPerColumn));
  return (
    <div style={{ ...premium.menuColumns, gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {buckets.map((bucket, columnIndex) => (
        <div key={columnIndex} style={premium.menuColumn(mode)}>
          {bucket.map((item) => (
            <PremiumMenuRow
              key={item.__index}
              item={item}
              currency={currency}
              forceTwoDecimals={forceTwoDecimals}
              mode={mode}
              editing={editing}
              onEdit={() => onEditItem?.(item.__index)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PremiumMenuRow({ item, currency, forceTwoDecimals, mode, editing, onEdit }) {
  return (
    <button type="button" style={{ ...premium.menuRow(mode), ...(editing ? editableSurfaceStyle : null) }} onClick={editing ? stopThen(onEdit) : undefined}>
      <div style={premium.menuMeta(mode)}>
        <span>{normalizeSection(item.section) || 'Signature'}</span>
      </div>
      <div style={premium.menuRowMain}>
        <span style={premium.menuName(mode)}>{item.name}</span>
        <span style={premium.menuPrice(mode)}>{formatPrice(item.price, currency, forceTwoDecimals)}</span>
      </div>
    </button>
  );
}

function PremiumTileMenu({ items, currency, forceTwoDecimals, editing, onEditItem }) {
  return (
    <div style={premium.tileGrid}>
      {items.map((item) => (
        <button key={item.__index} type="button" style={{ ...premium.tileItem, ...(editing ? editableSurfaceStyle : null) }} onClick={editing ? stopThen(() => onEditItem?.(item.__index)) : undefined}>
          <div style={premium.tileSection}>{normalizeSection(item.section) || 'Fusion'}</div>
          <div style={premium.tileName}>{item.name}</div>
          <div style={premium.tilePrice}>{formatPrice(item.price, currency, forceTwoDecimals)}</div>
        </button>
      ))}
    </div>
  );
}

function PremiumSteakQrDock(props) {
  return <PremiumQrDock {...props} tone="gold" variant="steak" />;
}

function PremiumKoreanQrDock(props) {
  return <PremiumQrDock {...props} tone="wood" variant="korean" />;
}

function PremiumFusionQrDock(props) {
  return <PremiumQrDock {...props} tone="neon" variant="fusion" />;
}

function PremiumQrDock({ lang, tone, variant = 'steak', footerText, phone, qrSrc, orderUrl, disabled = false, onEdit = null }) {
  const ko = lang === 'ko';
  const href = normalizeHref(orderUrl);
  const title = normalizeQrTitle(footerText, lang);
  const content = (
    <>
      <div style={premium.qrBox(tone, variant)}>
        {qrSrc ? (
          <img src={qrSrc} alt="Scan QR to order" style={premium.qrImg} draggable={false} />
        ) : (
          <div style={premium.qrMissing(tone)}>
            <span>QR</span>
            <span style={premium.qrMissingSmall}>{ko ? '등록' : 'UPLOAD'}</span>
          </div>
        )}
      </div>
      <div style={premium.qrCopy(tone)}>
        <div style={premium.qrTitle(tone)}>{title}</div>
        <div style={premium.qrSub(tone)}>{ko ? '테이블 전용 QR 스캔 · 휴대폰 주문' : 'Scan the table QR · Table Specific Ordering'} {phone || ''}</div>
      </div>
    </>
  );

  if (href && !disabled) {
    return (
      <a style={premium.qrDock(tone, variant)} href={href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  if (onEdit) {
    return (
      <button type="button" style={{ ...premium.qrDock(tone, variant), ...editableSurfaceStyle }} onClick={stopThen(onEdit)}>
        {content}
      </button>
    );
  }

  return (
    <div style={premium.qrDock(tone, variant)}>
      {content}
    </div>
  );
}

function normalizeQrTitle(value, lang = 'en') {
  const text = String(value || '').trim();
  if (!text || /^fresh food made daily$/i.test(text) || /^scan qr to order$/i.test(text)) {
    return lang === 'ko' ? '휴대폰으로 주문하기' : 'Order on Your Phone';
  }
  if (lang === 'ko' && /^order on your phone$/i.test(text)) return '휴대폰으로 주문하기';
  return text;
}

function normalizeHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return raw;
}

function getPremiumPhotos(templateKey, photos = []) {
  const fallback = {
    T1A: ['/template-photos/steak-hero.jpg', '/template-photos/steak-board.jpg', '/template-photos/wine.jpg', '/template-photos/steak-hero.jpg'],
    T2A: ['/template-photos/korean-hero.jpg', '/template-photos/korean-table.jpg', '/template-photos/ramen.jpg', '/template-photos/korean-hero.jpg'],
    T3A: ['/template-photos/sushi-hero.jpg', '/template-photos/asian-plate.jpg', '/template-photos/ramen.jpg', '/template-photos/sushi-hero.jpg'],
  }[templateKey] || [];

  const source = Array.isArray(photos) ? photos : [];
  return Array.from({ length: MAX_PHOTOS }, (_, index) => {
    const src = source[index];
    if (src && !isGeneratedDemoPhoto(src)) return src;
    return fallback[index % fallback.length] || src || fallback[0] || '';
  });
}

function isGeneratedDemoPhoto(src) {
  return typeof src === 'string' && src.startsWith('data:image/svg+xml');
}

function getTemplatePhotoSlotLabels(templateKey, lang = 'en') {
  const ko = lang === 'ko';
  const key = String(templateKey || '').slice(0, 3);
  const labels = {
    T1A: ko
      ? ['메인 스테이크 히어로', '스테이크 보드', '와인 페어링', '디저트 컷', '해산물 플레이트', '파스타 컷', '바/인테리어', '시즌 스페셜']
      : ['Main steak hero', 'Steak board', 'Wine pairing', 'Dessert plate', 'Seafood plate', 'Pasta detail', 'Bar interior', 'Seasonal special'],
    T2A: ko
      ? ['한상 대표 사진', '구이/갈비 사진', '음료/공간 사진', '반찬 디테일', '찌개/국물 사진', '면/밥 사진', '디저트 사진', '매장 분위기']
      : ['Bansang hero', 'Grill / galbi photo', 'Drink / room photo', 'Banchan detail', 'Soup photo', 'Noodle / rice photo', 'Dessert photo', 'Dining room mood'],
    T3A: ko
      ? ['퓨전 대표 비주얼', '쉐어 플레이트', '칵테일/음료', '스시 클로즈업', '라멘 사진', '이자카야 안주', '야식 추천', '네온 무드']
      : ['Fusion hero visual', 'Share plate', 'Cocktail / drink', 'Sushi close-up', 'Ramen photo', 'Izakaya bites', 'Late-night special', 'Neon mood'],
  }[key] || [];

  return Array.from({ length: MAX_PHOTOS }, (_, index) => labels[index] || (ko ? `메뉴 사진 ${index + 1}` : `Menu photo ${index + 1}`));
}

function stopThen(fn) {
  return (event) => {
    event?.stopPropagation?.();
    fn?.();
  };
}

/* -------------------- RENDER: PAGES -------------------- */

function PagedList({
  title,
  restaurantName,
  logoSrc,
  tagline,
  phone,
  website,
  footerText,
  photos,
  rows,
  currency,
  style,
  pageHeight,
  pageGap,
  variant,
  renderPageNumber = null,
  editing = false,
  onEditBrand,
  onEditRow,
  onEditPhoto,
}) {
  const rowH = estimateRowH(style);
  const headerH = estimateHeaderH(style);

  const paddingTop = DEFAULT_PAGE_PADDING_TOP;
  const paddingX = DEFAULT_PAGE_PADDING_X;

  const usableH = pageHeight - paddingTop - DEFAULT_FOOTER_SPACE;
  const perPage = Math.max(
    1,
    Math.floor((usableH - headerH - FEATURE_RIBBON_H - FEATURE_RIBBON_GAP) / (rowH + (style.rowGap || 14)))
  );
  const indexedRows = (Array.isArray(rows) ? rows : []).map((row, index) => ({ ...row, __index: index }));
  const pages = chunkToPageSet(indexedRows, perPage, getMinTemplatePages(style));
  const requestedPageIndex = Number(renderPageNumber) > 0 ? Math.floor(Number(renderPageNumber)) - 1 : null;

  return (
    <>
      {pages.map((pageRows, pi) => {
        if (requestedPageIndex !== null && pi !== requestedPageIndex) return null;
        const top = requestedPageIndex !== null ? 0 : pi * (pageHeight + pageGap);
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
            <TemplateBackdrop style={style} variant={variant} kind="T1" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <Header
                title={title}
                restaurantName={restaurantName}
                logoSrc={logoSrc}
                tagline={tagline}
                style={style}
                continued={pi > 0}
                pageIndex={pi + 1}
                kind="T1"
                variant={variant}
                editing={editing}
                onEdit={onEditBrand}
              />
              <FeatureRibbon
                rows={rows}
                photos={photos}
                currency={currency}
                style={style}
                kind="T1"
                variant={variant}
                editing={editing}
                onEditPhoto={() => onEditPhoto?.(0)}
              />
              <div style={{ marginTop: 24, display: 'grid', gap: style.rowGap }}>
                {pageRows.map((r, i) => {
                  const prev = pageRows[i - 1];
                  const section = normalizeSection(r.section);
                  const showSection = section && section !== normalizeSection(prev?.section);
                  return (
                    <div key={i} style={{ display: 'grid', gap: showSection ? 10 : 0 }}>
                      {showSection ? <SectionHeading label={section} style={style} variant={variant} /> : null}
                      <LineItem
                        name={r.name || ''}
                        price={formatPrice(r.price, currency, style.forceTwoDecimals)}
                        style={style}
                        variant={variant}
                        editing={editing}
                        onEdit={() => onEditRow?.(r.__index)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <TemplateFooter phone={phone} website={website} footerText={footerText} style={style} variant={variant} />
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
function PagedPhotoList({
  title,
  restaurantName,
  logoSrc,
  tagline,
  phone,
  website,
  footerText,
  rows,
  currency,
  photos,
  caption,
  style,
  pageHeight,
  pageGap,
  variant,
  renderPageNumber = null,
  editing = false,
  onEditBrand,
  onEditRow,
  onEditPhoto,
}) {
  const paddingTop = 70;
  const paddingX = 70;

  const usableH = pageHeight - paddingTop - DEFAULT_FOOTER_SPACE;
  const headerH = estimateHeaderH(style);

  // ✅ 블록당 메뉴: 3~4개 (항목이 많으면 자동으로 블록 늘어남)
  const ITEMS_PER_BLOCK = variant === 'B' ? 3 : 4;

  const targetBlocksPerPage = 3.5; // 3~4
  const available = Math.max(400, usableH - headerH - 24);
  const blockGap = variant === 'A' ? 18 : variant === 'B' ? 16 : 20;
  const blockH = Math.floor(
    (available - FEATURE_RIBBON_H - FEATURE_RIBBON_GAP - blockGap * (Math.ceil(targetBlocksPerPage) - 1)) / targetBlocksPerPage
  );

  const blocksPerPage = clampNum(Math.floor((available + blockGap) / (blockH + blockGap)), 3, 4);

  const indexedRows = (Array.isArray(rows) ? rows : []).map((row, index) => ({ ...row, __index: index }));
  const blocks = chunk(indexedRows, ITEMS_PER_BLOCK);
  const pages = chunkToPageSet(blocks, blocksPerPage, getMinTemplatePages(style));
  const requestedPageIndex = Number(renderPageNumber) > 0 ? Math.floor(Number(renderPageNumber)) - 1 : null;

  const ph = Array.isArray(photos) ? photos.filter(Boolean) : [];
  const getPhotoForBlock = (bi) => {
    if (ph.length === 0) return null;
    return ph[bi % ph.length] || null;
  };

  return (
    <>
      {pages.map((pageBlocks, pi) => {
        if (requestedPageIndex !== null && pi !== requestedPageIndex) return null;
        const top = requestedPageIndex !== null ? 0 : pi * (pageHeight + pageGap);

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
            <TemplateBackdrop style={style} variant={variant} kind="T2" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <Header
                title={title}
                restaurantName={restaurantName}
                logoSrc={logoSrc}
                tagline={tagline}
                style={style}
                continued={pi > 0}
                pageIndex={pi + 1}
                kind="T2"
                variant={variant}
                editing={editing}
                onEdit={onEditBrand}
              />
              <FeatureRibbon
                rows={rows}
                photos={photos}
                currency={currency}
                style={style}
                kind="T2"
                variant={variant}
                editing={editing}
                onEditPhoto={() => onEditPhoto?.(0)}
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
                      editing={editing}
                      photoIndex={globalBlockIndex % MAX_PHOTOS}
                      onEditPhoto={onEditPhoto}
                      onEditRow={onEditRow}
                    />
                  );
                })}
              </div>
            </div>
            <TemplateFooter phone={phone} website={website} footerText={footerText} style={style} variant={variant} />
          </div>
        );
      })}
    </>
  );
}

function PagedGrid({
  title,
  restaurantName,
  logoSrc,
  tagline,
  phone,
  website,
  footerText,
  photos,
  cells,
  currency,
  columns = 2,
  style,
  pageHeight,
  pageGap,
  variant,
  renderPageNumber = null,
  editing = false,
  onEditBrand,
  onEditCell,
  onEditPhoto,
}) {
  const col = Math.max(2, Math.min(3, Number(columns) || 2));
  const paddingTop = 70;
  const paddingX = 70;

  const headerH = estimateHeaderH(style);

  const cardH = variant === 'A' ? 172 : variant === 'B' ? 160 : 188;
  const gap = variant === 'A' ? 18 : variant === 'B' ? 14 : 22;

  const usableH = pageHeight - paddingTop - DEFAULT_FOOTER_SPACE;
  const rowsPerPage = Math.max(1, Math.floor((usableH - headerH - FEATURE_RIBBON_H - FEATURE_RIBBON_GAP) / (cardH + gap)));
  const perPage = rowsPerPage * col;

  const indexedCells = (Array.isArray(cells) ? cells : []).map((cell, index) => ({ ...cell, __index: index }));
  const pages = chunkToPageSet(indexedCells, perPage, getMinTemplatePages(style));
  const requestedPageIndex = Number(renderPageNumber) > 0 ? Math.floor(Number(renderPageNumber)) - 1 : null;

  return (
    <>
      {pages.map((pageCells, pi) => {
        if (requestedPageIndex !== null && pi !== requestedPageIndex) return null;
        const top = requestedPageIndex !== null ? 0 : pi * (pageHeight + pageGap);
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
            <TemplateBackdrop style={style} variant={variant} kind="T3" />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <Header
                title={title}
                restaurantName={restaurantName}
                logoSrc={logoSrc}
                tagline={tagline}
                style={style}
                continued={pi > 0}
                pageIndex={pi + 1}
                kind="T3"
                variant={variant}
                editing={editing}
                onEdit={onEditBrand}
              />
              <FeatureRibbon
                rows={cells}
                photos={photos}
                currency={currency}
                style={style}
                kind="T3"
                variant={variant}
                editing={editing}
                onEditPhoto={() => onEditPhoto?.(0)}
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
                  <div
                    key={i}
                    style={{ ...gridCard(style, variant, cardH), ...(editing ? editableSurfaceStyle : null) }}
                    onClick={editing ? (e) => {
                      e.stopPropagation();
                      onEditCell?.(c.__index);
                    } : undefined}
                    role={editing ? 'button' : undefined}
                    tabIndex={editing ? 0 : undefined}
                  >
                    {normalizeSection(c.section) ? (
                      <div style={gridSection(style, variant)}>{normalizeSection(c.section)}</div>
                    ) : null}
                    <div style={gridName(style, variant)}>{c.name || ''}</div>
                    <div style={gridPrice(style, variant)}>
                      {formatPrice(c.price, currency, style.forceTwoDecimals)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <TemplateFooter phone={phone} website={website} footerText={footerText} style={style} variant={variant} />
          </div>
        );
      })}
    </>
  );
}

function FeatureRibbon({ rows, photos, currency, style, kind, variant, editing = false, onEditPhoto }) {
  const theme = getBoardTheme(kind, variant, style);
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row?.name) : [];
  const picks = safeRows.slice(0, 2);
  const sections = [...new Set(safeRows.map((row) => normalizeSection(row.section)).filter(Boolean))].slice(0, 4);
  const photoSrc = Array.isArray(photos) ? photos.find(Boolean) : null;

  return (
    <div style={featureRibbonStyle(style, theme)}>
      <div style={featureHeroStyle(theme)}>
        <div
          style={{ ...featureMediaStyle(theme), ...(editing ? editableSurfaceStyle : null) }}
          onClick={editing ? (e) => {
            e.stopPropagation();
            onEditPhoto?.();
          } : undefined}
          role={editing ? 'button' : undefined}
          tabIndex={editing ? 0 : undefined}
        >
          {photoSrc ? (
            <img
              src={photoSrc}
              alt="featured"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              draggable={false}
            />
          ) : (
            <MenuVisual theme={theme} />
          )}
        </div>
        <div style={featureHeroCopyStyle(theme)}>
          <div style={featureEyebrowStyle(theme)}>{theme.eyebrow}</div>
          <div style={featureTitleStyle(style, theme)}>{theme.featureTitle}</div>
          <div style={featureSubStyle(theme)}>{theme.featureSub}</div>
        </div>
      </div>

      <div style={featurePicksStyle(theme)}>
        {(picks.length ? picks : [{ name: theme.sampleItem, price: '12.99' }, { name: theme.sampleItemAlt, price: '9.99' }]).map((item, index) => (
          <div key={index} style={featurePickRowStyle(theme)}>
            <div style={featurePickNameStyle(style, theme)}>{item.name}</div>
            <div style={featurePickPriceStyle(style, theme)}>
              {formatPrice(item.price, currency, style.forceTwoDecimals)}
            </div>
          </div>
        ))}
      </div>

      <div style={featureSideStyle(theme)}>
        <div style={featureCategoriesStyle}>
          {(sections.length ? sections : theme.categories).slice(0, 4).map((section) => (
            <span key={section} style={featureCategoryPillStyle(theme)}>{section}</span>
          ))}
        </div>
        <div style={templateIdentityCardStyle(theme)}>
          <div style={templateIdentityLabelStyle(theme)}>{theme.label}</div>
          <div style={templateIdentityCopyStyle(theme)}>{theme.boardNote}</div>
        </div>
      </div>
    </div>
  );
}

function MenuVisual({ theme }) {
  return (
    <div style={menuVisualStyle(theme)}>
      <div style={menuVisualPlateStyle(theme)} />
      <div style={menuVisualAccentStyle(theme)} />
    </div>
  );
}

function QrMark({ theme }) {
  const cells = Array.from({ length: 25 });
  return (
    <div style={qrMarkStyle(theme)}>
      {cells.map((_, index) => (
        <span key={index} style={qrCellStyle(theme, index)} />
      ))}
    </div>
  );
}

/* -------------------- T2 BLOCK -------------------- */

function PhotoMenuBlock({
  variant,
  style,
  height,
  photoSrc,
  caption,
  rows,
  currency,
  editing = false,
  photoIndex = 0,
  onEditPhoto,
  onEditRow,
}) {
  if (variant === 'C') {
    return (
      <div style={{ ...blockWrap(style, variant), minHeight: height }}>
        <div
          style={{ ...blockPhotoBanner(style), ...(editing ? editableSurfaceStyle : null) }}
          onClick={editing ? (e) => {
            e.stopPropagation();
            onEditPhoto?.(photoIndex);
          } : undefined}
          role={editing ? 'button' : undefined}
          tabIndex={editing ? 0 : undefined}
        >
          {photoSrc ? (
            <img
              src={photoSrc}
              alt="menu"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              draggable={false}
            />
          ) : (
            <MenuVisual theme={getBoardTheme(null, variant, style)} />
          )}
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: Math.max(10, (style.rowGap || 14) - 4) }}>
          {rows.map((r, i) => {
            const section = normalizeSection(r.section);
            const showSection = section && section !== normalizeSection(rows[i - 1]?.section);
            return (
              <div key={i} style={{ display: 'grid', gap: showSection ? 7 : 0 }}>
                {showSection ? <SectionHeading label={section} style={style} variant={variant} compact /> : null}
                <div
                  style={{ ...miniLine(style, variant), ...(editing ? editableSurfaceStyle : null) }}
                  onClick={editing ? (e) => {
                    e.stopPropagation();
                    onEditRow?.(r.__index);
                  } : undefined}
                  role={editing ? 'button' : undefined}
                  tabIndex={editing ? 0 : undefined}
                >
                  <div style={miniName(style, variant)}>{r.name || ''}</div>
                  <div style={miniPrice(style, variant)}>
                    {formatPrice(r.price, currency, style.forceTwoDecimals)}
                  </div>
                </div>
              </div>
            );
          })}
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
          <div
            style={{ ...blockPhotoBox(style, variant), ...(editing ? editableSurfaceStyle : null) }}
            onClick={editing ? (e) => {
              e.stopPropagation();
              onEditPhoto?.(photoIndex);
            } : undefined}
            role={editing ? 'button' : undefined}
            tabIndex={editing ? 0 : undefined}
          >
            {photoSrc ? (
              <img
                src={photoSrc}
                alt="menu"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                draggable={false}
              />
            ) : (
              <MenuVisual theme={getBoardTheme(null, variant, style)} />
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
            {rows.map((r, i) => {
              const section = normalizeSection(r.section);
              const showSection = section && section !== normalizeSection(rows[i - 1]?.section);
              return (
                <div key={i} style={{ display: 'grid', gap: showSection ? 7 : 0 }}>
                  {showSection ? <SectionHeading label={section} style={style} variant={variant} compact /> : null}
                  <div
                    style={{ ...miniLine(style, variant), ...(editing ? editableSurfaceStyle : null) }}
                    onClick={editing ? (e) => {
                      e.stopPropagation();
                      onEditRow?.(r.__index);
                    } : undefined}
                    role={editing ? 'button' : undefined}
                    tabIndex={editing ? 0 : undefined}
                  >
                    <div style={miniName(style, variant)}>{r.name || ''}</div>
                    <div style={miniPrice(style, variant)}>
                      {formatPrice(r.price, currency, style.forceTwoDecimals)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {photoOnRight ? (
          <div
            style={{ ...blockPhotoBox(style, variant), ...(editing ? editableSurfaceStyle : null) }}
            onClick={editing ? (e) => {
              e.stopPropagation();
              onEditPhoto?.(photoIndex);
            } : undefined}
            role={editing ? 'button' : undefined}
            tabIndex={editing ? 0 : undefined}
          >
            {photoSrc ? (
              <img
                src={photoSrc}
                alt="menu"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                draggable={false}
              />
            ) : (
              <MenuVisual theme={getBoardTheme(null, variant, style)} />
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', alignContent: 'start', gap: 10 }}>
            {rows.map((r, i) => {
              const section = normalizeSection(r.section);
              const showSection = section && section !== normalizeSection(rows[i - 1]?.section);
              return (
                <div key={i} style={{ display: 'grid', gap: showSection ? 7 : 0 }}>
                  {showSection ? <SectionHeading label={section} style={style} variant={variant} compact /> : null}
                  <div
                    style={{ ...miniLine(style, variant), ...(editing ? editableSurfaceStyle : null) }}
                    onClick={editing ? (e) => {
                      e.stopPropagation();
                      onEditRow?.(r.__index);
                    } : undefined}
                    role={editing ? 'button' : undefined}
                    tabIndex={editing ? 0 : undefined}
                  >
                    <div style={miniName(style, variant)}>{r.name || ''}</div>
                    <div style={miniPrice(style, variant)}>
                      {formatPrice(r.price, currency, style.forceTwoDecimals)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function blockWrap(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  const shadow = '0 18px 40px rgba(0,0,0,0.30)';

  return {
    borderRadius: 8,
    background: theme.card,
    border: `1px solid ${theme.border}`,
    boxShadow: shadow,
    padding: 14,
    overflow: 'hidden',
    boxSizing: 'border-box',
    backdropFilter: 'blur(8px)',
  };
}

function blockPhotoBox(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${theme.border}`,
    background: theme.surfaceStrong,
    boxShadow: '0 10px 26px rgba(0,0,0,0.22)',
    minHeight: 220,
    display: 'grid',
    placeItems: 'center',
  };
}

function blockPhotoBanner(style) {
  const theme = getBoardTheme(null, null, style);
  return {
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${theme.border}`,
    background: theme.surfaceStrong,
    boxShadow: '0 10px 26px rgba(0,0,0,0.22)',
    height: 252,
    display: 'grid',
    placeItems: 'center',
  };
}

function miniLine(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 14,
    alignItems: 'baseline',
    padding: variant === 'B' ? '10px 12px' : '10px 12px',
    borderRadius: 8,
    background: theme.surface,
    border: `1px solid ${theme.border}`,
  };
}

function miniName(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.ink,
    fontSize: variant === 'B' ? 34 : 32,
    fontWeight: 950,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    letterSpacing: 0,
  };
}

function miniPrice(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.accent,
    fontSize: variant === 'B' ? 34 : 30,
    fontWeight: 1000,
    opacity: 0.98,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

/* -------------------- PIECES -------------------- */

function Header({ title, restaurantName, logoSrc, tagline, style, continued, pageIndex, kind, variant, editing = false, onEdit }) {
  const theme = getBoardTheme(kind, variant, style);

  return (
    <div>
      <div
        style={{ ...brandRow(style, variant, theme), ...(editing ? editableSurfaceStyle : null) }}
        onClick={editing ? (e) => {
          e.stopPropagation();
          onEdit?.();
        } : undefined}
        role={editing ? 'button' : undefined}
        tabIndex={editing ? 0 : undefined}
      >
        <div style={brandLogoWrap(style, variant, theme)}>
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="logo"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              draggable={false}
            />
          ) : (
            <div style={brandLogoEmpty(style, theme)}>LOGO</div>
          )}
        </div>

        <div style={brandNameWrap(style, variant)}>
          <div style={brandName(style, variant, theme)}>
            {(restaurantName || '').trim() || (style?.fallbackRestaurantName || '') || 'Restaurant Name'}
          </div>
          <div style={brandSub(style, variant, theme)}>{title || 'Menu'}</div>
          {tagline ? <div style={brandTagline(style, variant, theme)}>{tagline}</div> : null}
        </div>

        <div style={brandChip(style, variant, theme)}>
          <QrMark theme={theme} />
          <div style={brandChipCopyStyle(theme)}>
            <div style={brandChipTitleStyle(theme)}>{theme.scanTitle}</div>
            <div style={brandChipSubStyle(theme)}>{theme.scanSub}</div>
          </div>
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

function SectionHeading({ label, style, variant, compact = false }) {
  return (
    <div style={sectionHeadingStyle(style, variant, compact)}>
      <span style={sectionHeadingText(style, variant, compact)}>{label}</span>
    </div>
  );
}

function TemplateFooter({ phone, website, footerText, style, variant }) {
  const left = footerText || website || '';
  const right = phone || '';

  if (!left && !right) return null;

  return (
    <div style={footerBar(style, variant)}>
      <div style={footerTextStyle(style, variant)}>{left}</div>
      <div style={footerPhoneStyle(style, variant)}>{right}</div>
    </div>
  );
}

function TemplateBackdrop({ style, variant, kind }) {
  const theme = getBoardTheme(kind, variant, style);

  return (
    <div style={templateBackdrop(style, variant, kind, theme)}>
      <div style={templateBackdropShape(style, variant, 'one', theme)} />
      <div style={templateBackdropShape(style, variant, 'two', theme)} />
      <div style={templateBackdropPattern(style, variant, kind, theme)} />
    </div>
  );
}

function LineItem({ name, price, style, variant, editing = false, onEdit }) {
  return (
    <div
      style={{ ...lineStyle(style, variant), ...(editing ? editableSurfaceStyle : null) }}
      onClick={editing ? (e) => {
        e.stopPropagation();
        onEdit?.();
      } : undefined}
      role={editing ? 'button' : undefined}
      tabIndex={editing ? 0 : undefined}
    >
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
    minPages: 3,
    fallbackRestaurantName: lang === 'ko' ? '한소반' : 'Hansoban',
  };

  const style = { ...baseStyle, ...(data.style || {}), templateKey: data?.style?.templateKey || templateId };
  const premiumKey = getPremiumTemplateKey(style);
  if (premiumKey) {
    style.minPages = 3;
    style.uiScale = style.uiScale || 0.94;
  }
  const group = (templateId || '').slice(0, 2); // T1/T2/T3
  let photos =
    Array.isArray(data.photos) ? [...data.photos] :
    data.photoSrc ? [data.photoSrc] : [];

  while (photos.length < MAX_PHOTOS) photos.push(null);
  photos = photos.slice(0, MAX_PHOTOS);
  if (premiumKey) {
    photos = getPremiumPhotos(premiumKey, photos);
  }

  const common = {
    restaurantName: data.restaurantName ?? (lang === 'ko' ? '한소반' : 'Hansoban'),
    logoSrc: data.logoSrc ?? null,
    tagline: data.tagline ?? (lang === 'ko' ? 'DINE-IN · TAKEOUT · DELIVERY' : 'DINE-IN · TAKEOUT · DELIVERY'),
    phone: data.phone ?? '+1 555 123 4567',
    website: data.website ?? 'yourrestaurant.com',
    orderUrl: data.orderUrl ?? '',
    qrSrc: data.qrSrc ?? null,
    footerText: data.footerText ?? (lang === 'ko' ? 'Fresh food made daily' : 'Fresh food made daily'),
    photos,
    photoSrc: photos[0] || null,
    caption: data.caption ?? (lang === 'ko' ? '대표 사진을 업로드하세요' : 'Upload featured photos'),
  };

  if (group === 'T1') {
    const rows = premiumKey
      ? mergePremiumRows(premiumKey, data.rows, lang)
      : (Array.isArray(data.rows) ? data.rows : []);
    return {
      ...common,
      title: data.title ?? (lang === 'ko' ? '오늘의 메뉴' : 'Today’s Menu'),
      currency: data.currency ?? '$',
      rows,
      style,
    };
  }

  if (group === 'T2') {
    const rows = premiumKey
      ? mergePremiumRows(premiumKey, data.rows, lang)
      : (Array.isArray(data.rows) ? data.rows : []);
    return {
      ...common,
      title: data.title ?? (lang === 'ko' ? '추천 메뉴' : 'Featured'),
      currency: data.currency ?? '$',
      rows,
      style,
    };
  }

  const cells = premiumKey
    ? mergePremiumRows(premiumKey, data.cells, lang)
    : (Array.isArray(data.cells) ? data.cells : []);

  return {
    ...common,
    title: data.title ?? (lang === 'ko' ? '메뉴' : 'Menu'),
    currency: data.currency ?? '$',
    columns: clampNum(data.columns ?? 2, 2, 3),
    cells,
    style,
  };
}

function mergePremiumRows(templateKey, savedItems, lang) {
  const saved = Array.isArray(savedItems) ? savedItems.filter((item) => item?.name || item?.price || item?.section) : [];
  const fallback = getPremiumDefaultRows(templateKey, lang);
  const minimum = templateKey === 'T3A' ? 30 : 28;
  if (saved.length < 20) return fallback.slice(0, minimum);
  const merged = [...saved];
  fallback.forEach((item) => {
    if (merged.length >= minimum) return;
    const exists = merged.some((row) => String(row?.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase());
    if (!exists) merged.push(item);
  });
  return merged.slice(0, minimum);
}

function getPremiumDefaultRows(templateKey, lang) {
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

  return (sets[templateKey] || sets.T1A).map(([section, name, price]) => ({ section, name, price }));
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

function chunkToPageSet(arr, maxPerPage, minPages = 1) {
  const items = Array.isArray(arr) ? arr : [];
  const safeMax = Math.max(1, Number(maxPerPage) || 1);
  const requiredPages = Math.max(
    Math.max(1, Number(minPages) || 1),
    Math.ceil(items.length / safeMax) || 1
  );
  const perPage = Math.max(1, Math.ceil(items.length / requiredPages) || 1);
  const pages = Array.from({ length: requiredPages }, (_, index) => {
    const start = index * perPage;
    return items.slice(start, start + perPage);
  });

  return pages.length ? pages : [[]];
}

function getMinTemplatePages(style) {
  return clampNum(style?.minPages ?? 1, 1, 12);
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeSection(value) {
  return String(value || '').trim();
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
      const names = {
        T1A: '클래식 레스토랑 메뉴',
        T1B: '패스트 캐주얼 보드',
        T1C: '모던 카페 메뉴',
        T2A: '시그니처 음식 사진형',
        T2B: '버거 프로모션 보드',
        T2C: '시즌 스페셜 사진형',
        T3A: '카페 타일 보드',
        T3B: '퀵서비스 그리드',
        T3C: '프리미엄 카드 메뉴',
      };
      const base = g === 'T1' ? '리스트형' : g === 'T2' ? '사진 + 리스트' : '그리드형';
      return names[id] || `${base} · ${v}`;
    },

    brand: '상단(로고/가게명)',
    restaurantName: '가게 이름',
    logo: '로고 이미지',
    logoHint: '로고 업로드',
    logoNote: '로고는 원형으로 잘려서 표시됩니다. 정사각형 이미지를 추천해요.',

    basic: '기본',
    storeInfo: '매장 정보',
    tagline: '상단 문구',
    phone: '전화번호',
    website: '웹사이트',
    qrSettings: 'QR 주문 설정',
    qrImage: '실제 QR 코드 이미지',
    qrHint: 'QR 업로드',
    orderUrl: '주문 URL',
    qrNote: '업로드한 QR 이미지는 모든 페이지에 자동 적용됩니다. 주문 URL을 넣으면 QR 영역을 터치해 주문 웹사이트로 이동할 수 있습니다.',
    footerText: '하단 문구',
    style: '스타일',
    photoSection: '대표 사진 / 메뉴 사진',
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
    sectionPH: '섹션',
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
    photoHint: '사진은 상단 추천 영역, 사진형 메뉴 블록, 템플릿 비주얼에 자동으로 사용됩니다.',

    columns: '컬럼 수',
    note: '참고',
    gridHint: '항목이 많아지면 자동으로 다음 페이지로 넘어갑니다.',

    off: 'OFF',
    on: 'ON',

    hint: '※ 메뉴판을 누르면 이 패널이 다시 열립니다. 하단 “저장”을 눌러야 반영됩니다.',
    close: '패널 닫기',
  };

  const en = {
    templateInput: 'Template Input',
    templateName: (id) => {
      const g = (id || '').slice(0, 2);
      const v = (id || '').slice(2, 3) || 'A';
      const names = {
        T1A: 'Classic Restaurant Menu',
        T1B: 'Fast Casual Board',
        T1C: 'Modern Cafe Menu',
        T2A: 'Signature Photo Menu',
        T2B: 'Burger Promo Board',
        T2C: 'Seasonal Specials Stack',
        T3A: 'Cafe Tile Board',
        T3B: 'Quick Service Grid',
        T3C: 'Premium Card Menu',
      };
      const base = g === 'T1' ? 'List' : g === 'T2' ? 'Photo + List' : 'Grid';
      return names[id] || `${base} · ${v}`;
    },

    brand: 'Header (Logo / Name)',
    restaurantName: 'Restaurant name',
    logo: 'Logo image',
    logoHint: 'Upload logo',
    logoNote: 'Logo is displayed as a circle. Square images work best.',

    basic: 'Basic',
    storeInfo: 'Store info',
    tagline: 'Top tagline',
    phone: 'Phone',
    website: 'Website',
    qrSettings: 'QR ordering settings',
    qrImage: 'Real QR code image',
    qrHint: 'Upload QR',
    orderUrl: 'Order URL',
    qrNote: 'The uploaded QR image is applied to every page. Add an order URL so guests can tap the QR area to open the ordering website.',
    footerText: 'Footer note',
    style: 'Style',
    photoSection: 'Featured / menu photos',
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
    sectionPH: 'Section',
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
    photoHint: 'Photos are used in the featured strip, photo menu blocks, and template visuals.',

    columns: 'Columns',
    note: 'Note',
    gridHint: 'Auto paginates when there are many items.',

    off: 'OFF',
    on: 'ON',

    hint: '* Tap the menu board to reopen this panel. Press “Save” at the bottom to apply.',
    close: 'Close panel',
  };

  return lang === 'en' ? en : ko;
}

/* -------------------- RENDER STYLES (variants) -------------------- */

function getBoardTheme(kind, variant, style = {}) {
  const key = String(style?.templateKey || `${kind || 'T1'}${variant || style?.variant || 'A'}`).slice(0, 3);
  const accent = style?.accentColor || '#f8d36a';

  const themes = {
    T1A: {
      label: 'Steakhouse',
      eyebrow: 'Chef Highlight',
      featureTitle: 'Prime Cuts & Dinner Favorites',
      featureSub: 'Bold sections, clear pricing, and premium contrast for dining rooms.',
      scanTitle: 'SCAN QR',
      scanSub: 'Mobile order',
      categories: ['STARTERS', 'STEAKS', 'SIDES', 'WINE'],
      sampleItem: 'Prime Rib Plate',
      sampleItemAlt: 'House Caesar',
      bg: `radial-gradient(circle at 82% 14%, ${withAlpha(accent, 0.30)}, transparent 31%), linear-gradient(135deg, #20150f 0%, #080706 54%, #2d2117 100%)`,
      surface: 'rgba(13,10,8,0.72)',
      surfaceStrong: 'rgba(5,4,3,0.88)',
      card: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(88,55,28,0.18))',
      border: 'rgba(248,211,106,0.26)',
      muted: 'rgba(255,246,222,0.72)',
      ink: '#fff7e6',
      darkInk: '#18120a',
      pattern: 'wood',
    },
    T1B: {
      label: 'Fast Food',
      eyebrow: 'Combo Spotlight',
      featureTitle: 'Fast Counter Menu With Big Prices',
      featureSub: 'Made for burgers, chicken, combos, and quick decisions.',
      scanTitle: 'QR ORDER',
      scanSub: 'Skip the line',
      categories: ['COMBOS', 'BURGERS', 'SIDES', 'DRINKS'],
      sampleItem: 'Double Combo',
      sampleItemAlt: 'Crispy Tenders',
      bg: `radial-gradient(circle at 82% 18%, ${withAlpha(accent, 0.50)}, transparent 28%), linear-gradient(135deg, #26080a 0%, #0b0b10 48%, #41120a 100%)`,
      surface: 'rgba(16,16,20,0.78)',
      surfaceStrong: 'rgba(0,0,0,0.86)',
      card: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(239,68,68,0.22))',
      border: 'rgba(255,255,255,0.20)',
      muted: 'rgba(255,255,255,0.72)',
      ink: '#ffffff',
      darkInk: '#111111',
      pattern: 'burst',
    },
    T1C: {
      label: 'Cafe',
      eyebrow: 'Morning Favorites',
      featureTitle: 'Coffee, Brunch & Bakery Board',
      featureSub: 'A calm cafe menu with soft panels and readable category flow.',
      scanTitle: 'SCAN MENU',
      scanSub: 'Order ahead',
      categories: ['COFFEE', 'BRUNCH', 'BAKERY', 'TEA'],
      sampleItem: 'Honey Latte',
      sampleItemAlt: 'Avocado Toast',
      bg: `radial-gradient(circle at 18% 16%, ${withAlpha(accent, 0.34)}, transparent 32%), linear-gradient(145deg, #10221f 0%, #f7f3e9 48%, #223b34 100%)`,
      surface: 'rgba(12,28,25,0.76)',
      surfaceStrong: 'rgba(10,24,22,0.90)',
      card: 'linear-gradient(180deg, rgba(255,255,255,0.14), rgba(12,28,25,0.22))',
      border: 'rgba(255,255,255,0.24)',
      muted: 'rgba(236,253,245,0.78)',
      ink: '#ffffff',
      darkInk: '#0f241f',
      pattern: 'tile',
    },
    T2A: {
      label: 'Korean',
      eyebrow: 'House Special',
      featureTitle: 'Signature Plates With Photo Focus',
      featureSub: 'Built for Korean restaurants, BBQ, soups, noodles, and shared plates.',
      scanTitle: 'QR 주문',
      scanSub: '휴대폰 주문',
      categories: ['SIGNATURE', 'BBQ', 'SOUP', 'NOODLES'],
      sampleItem: 'Galbi Combo',
      sampleItemAlt: 'Kimchi Stew',
      bg: `radial-gradient(circle at 82% 12%, ${withAlpha(accent, 0.34)}, transparent 30%), linear-gradient(145deg, #111111 0%, #050505 52%, #18302c 100%)`,
      surface: 'rgba(0,0,0,0.64)',
      surfaceStrong: 'rgba(0,0,0,0.86)',
      card: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(20,83,75,0.20))',
      border: 'rgba(255,255,255,0.22)',
      muted: 'rgba(240,253,250,0.76)',
      ink: '#ffffff',
      darkInk: '#111827',
      pattern: 'marble',
    },
    T2B: {
      label: 'Burger',
      eyebrow: 'Limited Combo',
      featureTitle: 'Hero Food Photos & Price Badges',
      featureSub: 'Photo-heavy board for burgers, fried chicken, tacos, and combo meals.',
      scanTitle: 'SCAN DEALS',
      scanSub: 'Mobile order',
      categories: ['BURGERS', 'CHICKEN', 'COMBOS', 'SAUCES'],
      sampleItem: 'Smash Burger',
      sampleItemAlt: 'Loaded Fries',
      bg: `radial-gradient(circle at 76% 18%, ${withAlpha(accent, 0.55)}, transparent 26%), linear-gradient(145deg, #111827 0%, #050505 45%, #4b1111 100%)`,
      surface: 'rgba(5,5,7,0.78)',
      surfaceStrong: 'rgba(0,0,0,0.90)',
      card: 'linear-gradient(135deg, rgba(239,68,68,0.30), rgba(255,255,255,0.08))',
      border: 'rgba(248,113,113,0.35)',
      muted: 'rgba(255,237,213,0.80)',
      ink: '#ffffff',
      darkInk: '#111111',
      pattern: 'diagonal',
    },
    T2C: {
      label: 'Seasonal',
      eyebrow: 'Fresh This Week',
      featureTitle: 'Seasonal Specials Menu Board',
      featureSub: 'Bright photo sections for seafood, lunch specials, brunch, or new items.',
      scanTitle: 'SCAN QR',
      scanSub: 'See specials',
      categories: ['NEW', 'LUNCH', 'SEAFOOD', 'DRINKS'],
      sampleItem: 'Market Plate',
      sampleItemAlt: 'House Lemonade',
      bg: `radial-gradient(circle at 18% 14%, ${withAlpha(accent, 0.46)}, transparent 31%), linear-gradient(145deg, #071a2d 0%, #0f2a3a 48%, #3b2432 100%)`,
      surface: 'rgba(7,26,45,0.74)',
      surfaceStrong: 'rgba(5,15,27,0.90)',
      card: 'linear-gradient(135deg, rgba(56,189,248,0.22), rgba(244,114,182,0.10))',
      border: 'rgba(186,230,253,0.28)',
      muted: 'rgba(224,242,254,0.78)',
      ink: '#ffffff',
      darkInk: '#082f49',
      pattern: 'wave',
    },
    T3A: {
      label: 'Cafe Tiles',
      eyebrow: 'Cafe Picks',
      featureTitle: 'Tile Board For Drinks & Desserts',
      featureSub: 'Compact, polished tiles for cafes, bakeries, teas, and dessert shops.',
      scanTitle: 'QR MENU',
      scanSub: 'Order phone',
      categories: ['COFFEE', 'TEA', 'DESSERT', 'BAKERY'],
      sampleItem: 'Cloud Latte',
      sampleItemAlt: 'Cheesecake',
      bg: `radial-gradient(circle at 78% 12%, ${withAlpha(accent, 0.38)}, transparent 29%), linear-gradient(145deg, #20152f 0%, #101827 52%, #1f3b37 100%)`,
      surface: 'rgba(25,20,39,0.74)',
      surfaceStrong: 'rgba(17,24,39,0.90)',
      card: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(192,132,252,0.14))',
      border: 'rgba(216,180,254,0.28)',
      muted: 'rgba(245,240,255,0.78)',
      ink: '#ffffff',
      darkInk: '#21122f',
      pattern: 'dot',
    },
    T3B: {
      label: 'Quick Service',
      eyebrow: 'Pick Fast',
      featureTitle: 'Dense Food Court Menu Grid',
      featureSub: 'Clean fast-selection board for bowls, tacos, wings, and side-heavy menus.',
      scanTitle: 'SCAN QR',
      scanSub: 'Quick order',
      categories: ['BOWLS', 'TACOS', 'WINGS', 'SIDES'],
      sampleItem: 'Chicken Bowl',
      sampleItemAlt: 'Street Tacos',
      bg: `radial-gradient(circle at 18% 16%, ${withAlpha(accent, 0.42)}, transparent 30%), linear-gradient(145deg, #052e16 0%, #06110b 50%, #172554 100%)`,
      surface: 'rgba(5,46,22,0.70)',
      surfaceStrong: 'rgba(2,16,9,0.90)',
      card: 'linear-gradient(135deg, rgba(34,197,94,0.20), rgba(255,255,255,0.09))',
      border: 'rgba(134,239,172,0.26)',
      muted: 'rgba(220,252,231,0.78)',
      ink: '#ffffff',
      darkInk: '#04130a',
      pattern: 'grid',
    },
    T3C: {
      label: 'Pub / Bar',
      eyebrow: 'Night Specials',
      featureTitle: 'Premium Pub, Bar & Tapas Board',
      featureSub: 'Dramatic cards for cocktails, share plates, happy hour, and dinner specials.',
      scanTitle: 'SCAN QR',
      scanSub: 'Bar menu',
      categories: ['COCKTAIL', 'BEER', 'TAPAS', 'DINNER'],
      sampleItem: 'Signature Cocktail',
      sampleItemAlt: 'Truffle Pasta',
      bg: `radial-gradient(circle at 82% 18%, ${withAlpha(accent, 0.38)}, transparent 30%), linear-gradient(145deg, #120817 0%, #050505 48%, #3a1b12 100%)`,
      surface: 'rgba(18,8,23,0.74)',
      surfaceStrong: 'rgba(0,0,0,0.90)',
      card: 'linear-gradient(135deg, rgba(244,114,182,0.18), rgba(251,191,36,0.10))',
      border: 'rgba(244,114,182,0.30)',
      muted: 'rgba(253,244,255,0.78)',
      ink: '#ffffff',
      darkInk: '#1f0d18',
      pattern: 'neon',
    },
  };

  const picked = themes[key] || themes.T1A;
  return {
    ...picked,
    boardNote: picked.boardNote || 'Designed as a complete digital menu board for dining room screens.',
    key,
    accent,
  };
}

function brandRow(style, variant, theme) {
  const board = theme || getBoardTheme(null, variant, style);
  return {
    display: 'grid',
    gridTemplateColumns: '88px 1fr 232px',
    gap: 16,
    alignItems: 'center',
    padding: '12px 14px',
    borderRadius: 8,
    background: board.surface,
    border: `1px solid ${board.border}`,
    boxShadow: '0 18px 40px rgba(0,0,0,0.32)',
    backdropFilter: 'blur(8px)',
  };
}

function brandLogoWrap(style, variant, theme) {
  const board = theme || getBoardTheme(null, variant, style);
  return {
    width: 78,
    height: 78,
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${board.border}`,
    background: board.surfaceStrong,
    boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
    display: 'grid',
    placeItems: 'center',
  };
}

function brandLogoEmpty(style, theme) {
  const board = theme || getBoardTheme(null, null, style);
  return {
    color: board.muted,
    fontWeight: 1000,
    fontSize: 16,
    letterSpacing: 0,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

function brandNameWrap(style, variant) {
  return { display: 'grid', gap: 2, alignContent: 'center' };
}

function brandName(style, variant, theme) {
  const board = theme || getBoardTheme(null, variant, style);
  return {
    color: board.ink,
    fontSize: variant === 'B' ? 44 : 46,
    fontWeight: 1000,
    lineHeight: 1.04,
    letterSpacing: 0,
    fontFamily: style.fontFamily,
    textShadow: '0 8px 22px rgba(0,0,0,0.55)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 560,
  };
}

function brandSub(style, variant, theme) {
  const board = theme || getBoardTheme(null, variant, style);
  return {
    color: board.muted,
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: 0,
    fontFamily: style.fontFamily,
    textShadow: '0 6px 18px rgba(0,0,0,0.55)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 560,
  };
}

function brandTagline(style, variant, theme) {
  const board = theme || getBoardTheme(null, variant, style);
  return {
    marginTop: 5,
    color: board.accent,
    fontSize: variant === 'B' ? 15 : 16,
    fontWeight: 950,
    letterSpacing: 1.2,
    fontFamily: style.fontFamily,
    textTransform: 'uppercase',
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 560,
  };
}

function brandChip(style, variant, theme) {
  const board = theme || getBoardTheme(null, variant, style);
  return {
    minHeight: 78,
    padding: '9px 10px',
    borderRadius: 8,
    border: `1px solid ${board.border}`,
    background: board.surfaceStrong,
    color: board.ink,
    fontWeight: 950,
    fontSize: 14,
    letterSpacing: 0,
    textTransform: 'uppercase',
    boxShadow: '0 10px 24px rgba(0,0,0,0.22)',
    display: 'grid',
    gridTemplateColumns: '58px 1fr',
    alignItems: 'center',
    gap: 10,
  };
}

function brandChipCopyStyle() {
  return { display: 'grid', gap: 2, minWidth: 0 };
}

function brandChipTitleStyle(theme) {
  return {
    color: theme.accent,
    fontSize: 15,
    fontWeight: 1000,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };
}

function brandChipSubStyle(theme) {
  return {
    color: theme.muted,
    fontSize: 12,
    fontWeight: 850,
    lineHeight: 1.15,
    textTransform: 'none',
  };
}

function featureRibbonStyle(style, theme) {
  return {
    height: FEATURE_RIBBON_H,
    marginTop: FEATURE_RIBBON_GAP,
    display: 'grid',
    gridTemplateColumns: '1.22fr 1fr 0.92fr',
    gap: 14,
    padding: 12,
    borderRadius: 8,
    boxSizing: 'border-box',
    background: theme.surface,
    border: `1px solid ${theme.border}`,
    boxShadow: '0 18px 38px rgba(0,0,0,0.30)',
    backdropFilter: 'blur(8px)',
    fontFamily: style.fontFamily,
    overflow: 'hidden',
  };
}

function featureHeroStyle(theme) {
  return {
    display: 'grid',
    gridTemplateColumns: '132px 1fr',
    gap: 13,
    minWidth: 0,
    alignItems: 'stretch',
  };
}

function featureMediaStyle(theme) {
  return {
    borderRadius: 8,
    overflow: 'hidden',
    border: `1px solid ${theme.border}`,
    background: theme.surfaceStrong,
    boxShadow: '0 12px 24px rgba(0,0,0,0.26)',
  };
}

function featureHeroCopyStyle() {
  return {
    display: 'grid',
    alignContent: 'center',
    gap: 7,
    minWidth: 0,
  };
}

function featureEyebrowStyle(theme) {
  return {
    width: 'fit-content',
    padding: '5px 8px',
    borderRadius: 6,
    background: theme.accent,
    color: theme.darkInk,
    fontSize: 13,
    fontWeight: 1000,
    lineHeight: 1,
    textTransform: 'uppercase',
  };
}

function featureTitleStyle(style, theme) {
  return {
    color: theme.ink,
    fontSize: 25,
    fontWeight: 1000,
    lineHeight: 1.05,
    fontFamily: style.fontFamily,
    textShadow: '0 6px 18px rgba(0,0,0,0.45)',
  };
}

function featureSubStyle(theme) {
  return {
    color: theme.muted,
    fontSize: 14,
    fontWeight: 850,
    lineHeight: 1.25,
  };
}

function featurePicksStyle(theme) {
  return {
    display: 'grid',
    gridTemplateRows: '1fr 1fr',
    gap: 10,
    minWidth: 0,
  };
}

function featurePickRowStyle(theme) {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    gap: 10,
    padding: '11px 12px',
    borderRadius: 8,
    background: theme.card,
    border: `1px solid ${theme.border}`,
    minWidth: 0,
  };
}

function featurePickNameStyle(style, theme) {
  return {
    color: theme.ink,
    fontSize: 22,
    fontWeight: 1000,
    lineHeight: 1.08,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textShadow: '0 4px 14px rgba(0,0,0,0.45)',
    fontFamily: style.fontFamily,
  };
}

function featurePickPriceStyle(style, theme) {
  return {
    color: theme.accent,
    fontSize: 22,
    fontWeight: 1000,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    textShadow: '0 4px 14px rgba(0,0,0,0.45)',
    fontFamily: style.fontFamily,
  };
}

function featureSideStyle(theme) {
  return {
    display: 'grid',
    gridTemplateRows: '1fr auto',
    gap: 10,
    minWidth: 0,
  };
}

const featureCategoriesStyle = {
  display: 'flex',
  alignContent: 'flex-start',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  gap: 7,
  minWidth: 0,
};

function featureCategoryPillStyle(theme) {
  return {
    display: 'inline-flex',
    padding: '7px 8px',
    borderRadius: 6,
    background: theme.surfaceStrong,
    border: `1px solid ${theme.border}`,
    color: theme.muted,
    fontSize: 12,
    fontWeight: 950,
    lineHeight: 1,
    textTransform: 'uppercase',
  };
}

function templateIdentityCardStyle(theme) {
  return {
    borderRadius: 8,
    padding: '12px 13px',
    background: theme.surfaceStrong,
    border: `1px solid ${theme.border}`,
  };
}

function templateIdentityLabelStyle(theme) {
  return {
    color: theme.accent,
    fontSize: 14,
    fontWeight: 1000,
    lineHeight: 1,
    textTransform: 'uppercase',
  };
}

function templateIdentityCopyStyle(theme) {
  return {
    marginTop: 5,
    color: theme.muted,
    fontSize: 12,
    fontWeight: 850,
    lineHeight: 1.25,
  };
}

function menuVisualStyle(theme) {
  return {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 120,
    background: `radial-gradient(circle at 50% 44%, ${withAlpha(theme.accent, 0.82)} 0 22%, transparent 23%), radial-gradient(circle at 58% 46%, rgba(255,255,255,0.82) 0 7%, transparent 8%), ${theme.card}`,
    overflow: 'hidden',
  };
}

function menuVisualPlateStyle(theme) {
  return {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 999,
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    border: '10px solid rgba(255,255,255,0.78)',
    boxShadow: '0 14px 24px rgba(0,0,0,0.32)',
  };
}

function menuVisualAccentStyle(theme) {
  return {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    height: 14,
    borderRadius: 999,
    background: theme.accent,
    opacity: 0.95,
  };
}

function qrMarkStyle(theme) {
  return {
    width: 52,
    height: 52,
    borderRadius: 6,
    padding: 5,
    background: '#fff',
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gridTemplateRows: 'repeat(5, 1fr)',
    gap: 2,
    boxSizing: 'border-box',
    boxShadow: '0 8px 18px rgba(0,0,0,0.28)',
  };
}

function qrCellStyle(theme, index) {
  const on = [0, 1, 3, 4, 5, 7, 8, 10, 12, 14, 16, 17, 19, 20, 22, 23, 24].includes(index);
  return {
    borderRadius: 1,
    background: on ? theme.darkInk : 'transparent',
  };
}

function sectionHeadingStyle(style, variant, compact) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: compact ? 8 : 12,
    minHeight: compact ? 24 : 34,
    marginTop: compact ? 0 : 8,
    fontFamily: style.fontFamily,
  };
}

function sectionHeadingText(style, variant, compact) {
  const theme = getBoardTheme(null, variant, style);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: compact ? '4px 9px' : '7px 14px',
    borderRadius: 6,
    background: theme.accent,
    color: theme.darkInk,
    fontSize: compact ? 16 : 22,
    fontWeight: 1000,
    letterSpacing: 0,
    lineHeight: 1,
    textTransform: 'uppercase',
    boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
  };
}

function footerBar(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    position: 'absolute',
    left: DEFAULT_PAGE_PADDING_X,
    right: DEFAULT_PAGE_PADDING_X,
    bottom: 46,
    zIndex: 2,
    minHeight: 66,
    borderRadius: 8,
    padding: '12px 18px',
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 16,
    alignItems: 'center',
    background: theme.surfaceStrong,
    border: `1px solid ${theme.border}`,
    boxShadow: '0 16px 36px rgba(0,0,0,0.30)',
    backdropFilter: 'blur(8px)',
    fontFamily: style.fontFamily,
  };
}

function footerTextStyle(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.muted,
    fontSize: 19,
    fontWeight: 950,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textShadow: '0 4px 14px rgba(0,0,0,0.45)',
  };
}

function footerPhoneStyle(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.accent,
    fontSize: 24,
    fontWeight: 1000,
    whiteSpace: 'nowrap',
    textShadow: '0 4px 14px rgba(0,0,0,0.45)',
  };
}

function templateBackdrop(style, variant, kind, theme) {
  return {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    overflow: 'hidden',
    background: theme.bg,
    pointerEvents: 'none',
  };
}

function templateBackdropShape(style, variant, which, theme) {
  const isOne = which === 'one';
  return {
    position: 'absolute',
    width: isOne ? 420 : 260,
    height: isOne ? 420 : 260,
    borderRadius: theme.pattern === 'grid' ? 8 : 999,
    right: isOne ? -120 : 'auto',
    left: isOne ? 'auto' : -88,
    top: isOne ? 110 : 'auto',
    bottom: isOne ? 'auto' : 150,
    border: `28px solid ${withAlpha(theme.accent, isOne ? 0.36 : 0.18)}`,
    opacity: isOne ? 0.7 : 0.55,
    filter: 'blur(0.5px)',
  };
}

function templateBackdropPattern(style, variant, kind, theme) {
  const texture = {
    wood: [
      `linear-gradient(100deg, transparent 0 46%, ${withAlpha(theme.accent, 0.12)} 46% 47%, transparent 47% 100%)`,
      'repeating-linear-gradient(92deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 28px)',
    ],
    burst: [
      `linear-gradient(135deg, transparent 0 40%, ${withAlpha(theme.accent, 0.28)} 40% 43%, transparent 43% 100%)`,
      'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 46px)',
    ],
    tile: [
      `linear-gradient(90deg, ${withAlpha(theme.accent, 0.12)} 1px, transparent 1px)`,
      `linear-gradient(0deg, ${withAlpha(theme.accent, 0.10)} 1px, transparent 1px)`,
    ],
    marble: [
      `linear-gradient(115deg, transparent 0 40%, ${withAlpha(theme.accent, 0.18)} 40% 41%, transparent 41% 100%)`,
      'radial-gradient(circle at 30% 18%, rgba(255,255,255,0.22) 0 1px, transparent 2px)',
    ],
    diagonal: [
      `repeating-linear-gradient(135deg, ${withAlpha(theme.accent, 0.18)} 0 3px, transparent 3px 42px)`,
      'radial-gradient(circle at 12% 82%, rgba(255,255,255,0.12), transparent 26%)',
    ],
    wave: [
      `radial-gradient(ellipse at 20% 40%, ${withAlpha(theme.accent, 0.18)}, transparent 34%)`,
      'repeating-linear-gradient(110deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 32px)',
    ],
    dot: [
      `radial-gradient(circle, ${withAlpha(theme.accent, 0.20)} 0 2px, transparent 3px)`,
      'linear-gradient(135deg, rgba(255,255,255,0.06), transparent 40%)',
    ],
    grid: [
      `linear-gradient(90deg, ${withAlpha(theme.accent, 0.14)} 1px, transparent 1px)`,
      `linear-gradient(0deg, ${withAlpha(theme.accent, 0.14)} 1px, transparent 1px)`,
    ],
    neon: [
      `linear-gradient(115deg, transparent 0 45%, ${withAlpha(theme.accent, 0.22)} 45% 46%, transparent 46% 100%)`,
      'radial-gradient(circle at 70% 78%, rgba(255,255,255,0.10), transparent 24%)',
    ],
  }[theme.pattern] || [];

  return {
    position: 'absolute',
    inset: 0,
    opacity: variant === 'B' ? 0.18 : 0.12,
    backgroundImage: texture.join(', '),
    backgroundSize: theme.pattern === 'grid' || theme.pattern === 'tile' ? '72px 72px, 72px 72px' : '100% 100%, 52px 52px',
  };
}

function withAlpha(hex, alpha) {
  const raw = String(hex || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(raw.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function ruleStyle(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    height: variant === 'B' ? 3 : 2,
    background: theme.accent,
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
  const theme = getBoardTheme(null, variant, style);
  const shadow = '0 16px 34px rgba(0,0,0,0.26)';

  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 16,
    alignItems: 'baseline',
    padding: variant === 'B' ? '12px 14px' : '14px 16px',
    borderRadius: 8,
    background: theme.card,
    border: `1px solid ${theme.border}`,
    boxShadow: shadow,
    fontFamily: style.fontFamily,
    backdropFilter: 'blur(8px)',
  };
}

function nameStyle(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.ink,
    fontSize: variant === 'B' ? 40 : 44,
    fontWeight: 950,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    letterSpacing: 0,
  };
}

function priceStyle(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.accent,
    fontSize: variant === 'B' ? 38 : 42,
    fontWeight: 1000,
    opacity: 0.95,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

function photoPlaceholderStyle(style) {
  const theme = getBoardTheme(null, null, style);
  return {
    color: theme.muted,
    fontWeight: 900,
    fontSize: 22,
    padding: 20,
    textAlign: 'center',
    lineHeight: style.lineSpacing,
    fontFamily: style.fontFamily,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    background: theme.card,
    width: '100%',
    height: '100%',
    display: 'grid',
    placeItems: 'center',
  };
}

function gridCard(style, variant, minH) {
  const theme = getBoardTheme(null, variant, style);
  const shadow = '0 16px 34px rgba(0,0,0,0.26)';

  return {
    borderRadius: 8,
    padding: variant === 'B' ? 14 : 18,
    background: theme.card,
    border: `1px solid ${theme.border}`,
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
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.ink,
    fontSize: variant === 'B' ? 34 : 36,
    fontWeight: 1000,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
    letterSpacing: 0,
  };
}

function gridSection(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    display: 'inline-flex',
    width: 'fit-content',
    padding: '5px 10px',
    borderRadius: 6,
    background: theme.accent,
    color: theme.darkInk,
    fontSize: variant === 'B' ? 15 : 16,
    fontWeight: 1000,
    letterSpacing: 0,
    textTransform: 'uppercase',
    boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
  };
}

function gridPrice(style, variant) {
  const theme = getBoardTheme(null, variant, style);
  return {
    color: theme.accent,
    fontSize: variant === 'B' ? 32 : 34,
    fontWeight: 1000,
    opacity: 0.95,
    lineHeight: style.lineSpacing,
    textShadow: '0 4px 14px rgba(0,0,0,0.55)',
  };
}

const editableSurfaceStyle = {
  cursor: 'pointer',
  outline: '2px solid rgba(45,212,191,0.0)',
  transition: 'outline-color 0.12s ease, box-shadow 0.12s ease',
  pointerEvents: 'auto',
};

/* -------------------- LAYER/PANEL styles -------------------- */

const styles = {
  layer: {
    position: 'absolute',
    inset: 0,
    zIndex: 45,
    pointerEvents: 'none',
  },
};

const premium = {
  root: (mode, pageHeight) => ({
    position: 'absolute',
    inset: 0,
    width: BASE_W,
    height: pageHeight,
    overflow: 'hidden',
    boxSizing: 'border-box',
    padding: mode === 'korean' ? '46px 48px 42px' : '48px 50px 42px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background:
      mode === 'korean'
        ? '#efe3cf'
        : mode === 'fusion'
        ? '#080816'
        : '#080604',
    color: mode === 'korean' ? '#2c1d12' : '#fff',
  }),
  bgWrap: {
    position: 'absolute',
    inset: -40,
    opacity: 0.32,
    pointerEvents: 'none',
  },
  imgCover: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  photoSlotBadge: (tone) => ({
    position: 'absolute',
    left: 18,
    top: 18,
    zIndex: 3,
    maxWidth: 'calc(100% - 36px)',
    minHeight: 38,
    padding: '0 14px',
    borderRadius: tone === 'wood' ? 12 : 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tone === 'wood' ? '#3a2515' : '#ffffff',
    background:
      tone === 'wood'
        ? 'rgba(255,251,244,0.90)'
        : tone === 'neon'
        ? 'linear-gradient(90deg, rgba(255,61,154,0.82), rgba(0,229,255,0.58))'
        : 'linear-gradient(90deg, rgba(215,180,106,0.92), rgba(95,58,20,0.82))',
    border:
      tone === 'wood'
        ? '1px solid rgba(122,75,37,0.20)'
        : '1px solid rgba(255,255,255,0.20)',
    boxShadow: tone === 'wood' ? '0 14px 34px rgba(84,52,24,0.18)' : '0 16px 42px rgba(0,0,0,0.34)',
    fontSize: 14,
    fontWeight: 1000,
    lineHeight: 1,
    letterSpacing: 0,
    textTransform: 'uppercase',
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  }),
  steakVignette: {
    position: 'absolute',
    inset: 0,
    background:
      'radial-gradient(circle at 78% 18%, rgba(215,180,106,0.24), transparent 29%), linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.72)), linear-gradient(90deg, rgba(0,0,0,0.94), rgba(0,0,0,0.30) 56%, rgba(0,0,0,0.86))',
    pointerEvents: 'none',
  },
  koreanTexture: {
    position: 'absolute',
    inset: 0,
    background:
      'linear-gradient(90deg, rgba(122,75,37,0.10) 1px, transparent 1px), linear-gradient(180deg, rgba(255,255,255,0.34), rgba(222,197,159,0.55)), radial-gradient(circle at 14% 86%, rgba(122,75,37,0.20), transparent 31%)',
    backgroundSize: '48px 48px, 100% 100%, 100% 100%',
    pointerEvents: 'none',
  },
  fusionOverlay: {
    position: 'absolute',
    inset: 0,
    background:
      'radial-gradient(circle at 18% 12%, rgba(0,229,255,0.22), transparent 26%), radial-gradient(circle at 82% 18%, rgba(255,61,154,0.30), transparent 32%), linear-gradient(145deg, rgba(8,8,22,0.90), rgba(4,3,14,0.64) 42%, rgba(10,3,18,0.95))',
    pointerEvents: 'none',
  },
  header: {
    position: 'relative',
    zIndex: 2,
    width: '100%',
    minHeight: 104,
    border: 'none',
    borderRadius: 24,
    padding: '18px 20px',
    display: 'grid',
    gridTemplateColumns: '72px 1fr auto',
    gap: 18,
    alignItems: 'center',
    textAlign: 'left',
    cursor: 'default',
    boxSizing: 'border-box',
  },
  headerDark: {
    background: 'rgba(0,0,0,0.46)',
    boxShadow: '0 22px 70px rgba(0,0,0,0.34)',
    border: '1px solid rgba(255,255,255,0.12)',
    backdropFilter: 'blur(18px)',
  },
  headerLight: {
    background: 'rgba(255,251,244,0.78)',
    boxShadow: '0 22px 70px rgba(84,52,24,0.16)',
    border: '1px solid rgba(122,75,37,0.18)',
    backdropFilter: 'blur(18px)',
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    border: '2px solid',
    background: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    fontSize: 13,
    fontWeight: 1000,
    letterSpacing: 0.2,
  },
  headerText: {
    minWidth: 0,
  },
  brand: {
    fontSize: 43,
    fontWeight: 1000,
    lineHeight: 1,
    letterSpacing: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 17,
    fontWeight: 900,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  headerPill: {
    minWidth: 148,
    minHeight: 46,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    padding: '0 18px',
    fontSize: 16,
    fontWeight: 1000,
    textTransform: 'uppercase',
  },
  steakHero: {
    position: 'relative',
    zIndex: 1,
    marginTop: 30,
    height: 690,
    display: 'grid',
    gridTemplateColumns: '1.15fr 0.85fr',
    gap: 24,
  },
  steakHeroPhoto: {
    appearance: 'none',
    border: '1px solid rgba(215,180,106,0.34)',
    borderRadius: 34,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    boxShadow: '0 38px 110px rgba(0,0,0,0.50)',
  },
  steakHeroCard: {
    borderRadius: 34,
    padding: 34,
    display: 'grid',
    alignContent: 'center',
    gap: 18,
    background: 'linear-gradient(180deg, rgba(11,8,5,0.82), rgba(48,31,16,0.62))',
    border: '1px solid rgba(215,180,106,0.34)',
    boxShadow: '0 30px 90px rgba(0,0,0,0.36)',
    backdropFilter: 'blur(14px)',
  },
  steakEyebrow: {
    color: '#d7b46a',
    fontSize: 18,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  steakTitle: {
    color: '#fff6df',
    fontSize: 66,
    fontWeight: 1000,
    lineHeight: 0.96,
    letterSpacing: 0,
  },
  steakDesc: {
    color: 'rgba(255,246,222,0.74)',
    fontSize: 22,
    fontWeight: 750,
    lineHeight: 1.34,
  },
  steakMain: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 1080,
    display: 'grid',
    gridTemplateColumns: '0.92fr 1.45fr',
    gap: 24,
  },
  pageOneStrip: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 880,
    display: 'grid',
    gridTemplateColumns: '0.9fr 1.1fr',
    gap: 24,
  },
  signatureStack: (mode) => ({
    display: 'grid',
    gap: 14,
    minHeight: 0,
    alignContent: 'start',
  }),
  featureCard: (mode, compact) => ({
    appearance: 'none',
    width: '100%',
    minHeight: compact ? 132 : 150,
    borderRadius: mode === 'wood' ? 24 : 22,
    padding: compact ? '18px 20px' : '20px 22px',
    display: 'grid',
    gap: compact ? 8 : 10,
    textAlign: 'left',
    boxSizing: 'border-box',
    background:
      mode === 'wood'
        ? 'linear-gradient(135deg, rgba(255,251,244,0.90), rgba(231,216,190,0.70))'
        : mode === 'gold'
        ? 'linear-gradient(135deg, rgba(215,180,106,0.20), rgba(0,0,0,0.46))'
        : 'linear-gradient(135deg, rgba(255,61,154,0.22), rgba(0,229,255,0.10))',
    border:
      mode === 'wood'
        ? '1px solid rgba(122,75,37,0.18)'
        : mode === 'gold'
        ? '1px solid rgba(215,180,106,0.28)'
        : '1px solid rgba(255,255,255,0.14)',
    boxShadow: mode === 'wood' ? '0 18px 48px rgba(84,52,24,0.14)' : '0 24px 70px rgba(0,0,0,0.28)',
    backdropFilter: 'blur(14px)',
  }),
  featureCardLabel: (mode) => ({
    color: mode === 'wood' ? '#7a4b25' : mode === 'gold' ? '#d7b46a' : '#49f5ff',
    fontSize: 13,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 1,
  }),
  featureCardName: (mode) => ({
    color: mode === 'wood' ? '#2d1c10' : '#fff',
    fontSize: mode === 'wood' ? 28 : 25,
    fontWeight: 1000,
    lineHeight: 1.05,
    letterSpacing: 0,
  }),
  featureCardMeta: (mode) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    color: mode === 'wood' ? 'rgba(45,28,16,0.68)' : 'rgba(255,255,255,0.68)',
    fontSize: 17,
    fontWeight: 900,
  }),
  stripPhoto: {
    appearance: 'none',
    border: '1px solid rgba(215,180,106,0.28)',
    borderRadius: 28,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    boxShadow: '0 24px 70px rgba(0,0,0,0.38)',
  },
  menuPageHero: {
    position: 'relative',
    zIndex: 1,
    marginTop: 30,
    height: 620,
    display: 'grid',
    gridTemplateColumns: '1.05fr 0.95fr',
    gap: 24,
    marginBottom: 24,
  },
  widePhoto: {
    appearance: 'none',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 32,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    boxShadow: '0 30px 90px rgba(0,0,0,0.40)',
  },
  pageIntro: (mode) => ({
    borderRadius: 32,
    padding: 34,
    display: 'grid',
    alignContent: 'center',
    gap: 14,
    background: mode === 'wood' ? 'rgba(255,251,244,0.78)' : 'rgba(0,0,0,0.48)',
    border: mode === 'wood' ? '1px solid rgba(122,75,37,0.16)' : '1px solid rgba(255,255,255,0.12)',
    boxShadow: mode === 'wood' ? '0 22px 70px rgba(84,52,24,0.16)' : '0 28px 80px rgba(0,0,0,0.36)',
    backdropFilter: 'blur(16px)',
  }),
  pageKicker: (mode) => ({
    color: mode === 'wood' ? '#7a4b25' : mode === 'gold' ? '#d7b46a' : '#49f5ff',
    fontSize: 18,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  }),
  pageTitle: {
    color: 'inherit',
    fontSize: 56,
    fontWeight: 1000,
    lineHeight: 1,
    letterSpacing: 0,
  },
  pageBody: {
    color: 'rgba(255,255,255,0.70)',
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.34,
  },
  steakPhotoColumn: {
    display: 'grid',
    gap: 24,
  },
  steakSidePhoto: {
    appearance: 'none',
    border: '1px solid rgba(215,180,106,0.28)',
    borderRadius: 28,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    minHeight: 0,
    boxShadow: '0 24px 70px rgba(0,0,0,0.38)',
  },
  koreanHero: {
    position: 'relative',
    zIndex: 1,
    marginTop: 30,
    height: 610,
    display: 'grid',
    gridTemplateColumns: '0.98fr 1.02fr',
    gap: 26,
  },
  koreanSobanStage: {
    position: 'relative',
    zIndex: 1,
    marginTop: 26,
    height: 760,
    display: 'grid',
    gridTemplateColumns: '1.12fr 0.88fr',
    gap: 26,
  },
  koreanSobanHero: {
    appearance: 'none',
    border: 'none',
    borderRadius: 38,
    padding: 0,
    overflow: 'hidden',
    background: '#fff',
    boxShadow: '0 36px 92px rgba(84,52,24,0.25)',
    position: 'relative',
  },
  koreanSobanStory: {
    borderRadius: 38,
    padding: 38,
    display: 'grid',
    alignContent: 'center',
    gap: 18,
    background: 'linear-gradient(180deg, rgba(255,251,244,0.88), rgba(240,224,197,0.72))',
    border: '1px solid rgba(122,75,37,0.18)',
    boxShadow: '0 28px 80px rgba(84,52,24,0.16)',
    backdropFilter: 'blur(16px)',
  },
  koreanStoryGrid: {
    display: 'grid',
    gap: 12,
    marginTop: 8,
  },
  koreanBansangRow: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 760,
    display: 'grid',
    gridTemplateColumns: '0.72fr 1.05fr 0.72fr',
    gap: 20,
  },
  koreanBanchanPanel: {
    minHeight: 0,
    borderRadius: 30,
    padding: 16,
    background: 'rgba(255,251,244,0.78)',
    border: '1px solid rgba(122,75,37,0.16)',
    boxShadow: '0 20px 58px rgba(84,52,24,0.14)',
    backdropFilter: 'blur(14px)',
    display: 'grid',
    gap: 12,
    alignContent: 'start',
  },
  panelKicker: (mode) => ({
    color: mode === 'wood' ? '#7a4b25' : mode === 'gold' ? '#d7b46a' : '#49f5ff',
    fontSize: 15,
    fontWeight: 1000,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  }),
  koreanMenuExplorer: {
    position: 'relative',
    zIndex: 1,
    marginTop: 26,
    marginBottom: 22,
    height: 560,
    display: 'grid',
    gridTemplateColumns: '1.15fr 0.82fr 0.82fr',
    gap: 18,
  },
  koreanCategoryBook: {
    borderRadius: 32,
    padding: 30,
    display: 'grid',
    alignContent: 'center',
    gap: 18,
    background: 'rgba(255,251,244,0.82)',
    border: '1px solid rgba(122,75,37,0.16)',
    boxShadow: '0 22px 64px rgba(84,52,24,0.14)',
    backdropFilter: 'blur(14px)',
  },
  koreanBookTitle: {
    color: '#2d1c10',
    fontSize: 44,
    fontWeight: 1000,
    lineHeight: 1.02,
    letterSpacing: 0,
  },
  koreanTallPhoto: {
    appearance: 'none',
    border: 'none',
    borderRadius: 30,
    padding: 0,
    overflow: 'hidden',
    background: '#fff',
    minHeight: 0,
    boxShadow: '0 24px 64px rgba(84,52,24,0.18)',
  },
  koreanClosingPage: {
    position: 'relative',
    zIndex: 1,
    marginTop: 28,
    height: 980,
    display: 'grid',
    gridTemplateColumns: '0.92fr 1.08fr',
    gap: 24,
  },
  koreanClosingPhoto: {
    appearance: 'none',
    border: 'none',
    borderRadius: 36,
    padding: 0,
    overflow: 'hidden',
    background: '#fff',
    boxShadow: '0 30px 80px rgba(84,52,24,0.20)',
  },
  koreanClosingCopy: {
    borderRadius: 36,
    padding: 28,
    display: 'grid',
    alignContent: 'start',
    gap: 16,
    background: 'rgba(255,251,244,0.82)',
    border: '1px solid rgba(122,75,37,0.16)',
    boxShadow: '0 24px 70px rgba(84,52,24,0.15)',
    backdropFilter: 'blur(14px)',
  },
  koreanMainPhoto: {
    appearance: 'none',
    border: 'none',
    borderRadius: 36,
    padding: 0,
    overflow: 'hidden',
    background: '#fff',
    boxShadow: '0 34px 90px rgba(84,52,24,0.25)',
    position: 'relative',
  },
  koreanPhotoLabel: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 22,
    padding: '14px 16px',
    borderRadius: 18,
    background: 'rgba(255,251,244,0.88)',
    color: '#33200f',
    fontSize: 20,
    fontWeight: 1000,
    boxShadow: '0 18px 42px rgba(84,52,24,0.16)',
  },
  koreanHeroCopy: {
    borderRadius: 36,
    padding: 38,
    display: 'grid',
    alignContent: 'center',
    gap: 18,
    background: 'rgba(255,251,244,0.76)',
    border: '1px solid rgba(122,75,37,0.16)',
    boxShadow: '0 28px 80px rgba(84,52,24,0.16)',
    backdropFilter: 'blur(16px)',
  },
  koreanKicker: {
    color: '#7a4b25',
    fontSize: 18,
    fontWeight: 1000,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  koreanTitle: {
    color: '#2d1c10',
    fontSize: 58,
    fontWeight: 1000,
    lineHeight: 1,
    letterSpacing: 0,
  },
  koreanBody: {
    color: 'rgba(45,28,16,0.70)',
    fontSize: 23,
    fontWeight: 760,
    lineHeight: 1.36,
  },
  koreanMain: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 1130,
    display: 'grid',
    gridTemplateColumns: '0.72fr 1.28fr',
    gap: 24,
  },
  koreanFeatureRow: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 920,
    display: 'grid',
    gridTemplateColumns: '0.72fr 0.72fr 1.16fr',
    gap: 18,
  },
  koreanMenuGallery: {
    position: 'relative',
    zIndex: 1,
    marginTop: 26,
    marginBottom: 22,
    height: 520,
    display: 'grid',
    gridTemplateColumns: '1.2fr 0.9fr 0.9fr',
    gap: 18,
  },
  koreanGalleryPhoto: {
    appearance: 'none',
    border: 'none',
    borderRadius: 28,
    padding: 0,
    overflow: 'hidden',
    background: '#fff',
    minHeight: 0,
    boxShadow: '0 20px 52px rgba(84,52,24,0.18)',
  },
  koreanPhotoStack: {
    display: 'grid',
    gap: 18,
  },
  koreanSidePhoto: {
    appearance: 'none',
    border: 'none',
    borderRadius: 26,
    padding: 0,
    overflow: 'hidden',
    background: '#fff',
    minHeight: 0,
    boxShadow: '0 20px 52px rgba(84,52,24,0.18)',
  },
  fusionHero: {
    position: 'relative',
    zIndex: 1,
    marginTop: 28,
    height: 620,
    display: 'grid',
    gridTemplateColumns: '0.9fr 1.1fr',
    gap: 24,
  },
  fusionCopy: {
    borderRadius: 34,
    padding: 34,
    display: 'grid',
    alignContent: 'center',
    gap: 18,
    background: 'linear-gradient(135deg, rgba(255,61,154,0.22), rgba(0,229,255,0.08))',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 28px 80px rgba(0,0,0,0.42)',
    backdropFilter: 'blur(16px)',
  },
  fusionKicker: {
    color: '#49f5ff',
    fontSize: 18,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  fusionTitle: {
    color: '#fff',
    fontSize: 64,
    fontWeight: 1000,
    lineHeight: 0.96,
    letterSpacing: 0,
  },
  fusionBody: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 22,
    fontWeight: 760,
    lineHeight: 1.34,
  },
  fusionPulse: {
    width: 'fit-content',
    minHeight: 46,
    padding: '0 18px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    background: 'linear-gradient(90deg, rgba(255,61,154,0.35), rgba(0,229,255,0.18))',
    border: '1px solid rgba(255,255,255,0.16)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  fusionHeroPhoto: {
    appearance: 'none',
    border: '1px solid rgba(255,61,154,0.36)',
    borderRadius: 34,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    boxShadow: '0 34px 100px rgba(255,61,154,0.18), 0 30px 90px rgba(0,0,0,0.46)',
  },
  fusionGrid: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 1120,
    display: 'grid',
    gridTemplateColumns: '0.68fr 0.68fr 1.2fr',
    gridTemplateRows: '1fr 1fr',
    gap: 18,
  },
  fusionPageOne: {
    position: 'relative',
    zIndex: 1,
    marginTop: 24,
    height: 920,
    display: 'grid',
    gridTemplateColumns: '0.72fr 0.72fr 1.14fr',
    gap: 18,
  },
  fusionPhotoTile: {
    appearance: 'none',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 28,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    minHeight: 0,
    boxShadow: '0 24px 70px rgba(0,0,0,0.38)',
  },
  fusionMenuPanel: {
    gridColumn: '3 / 4',
    gridRow: '1 / 3',
    borderRadius: 30,
    padding: 18,
    background: 'rgba(2,3,18,0.66)',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 26px 86px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(16px)',
    overflow: 'hidden',
  },
  categoryRail: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryPill: (mode) => ({
    minHeight: 42,
    padding: '0 15px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background:
      mode === 'wood'
        ? 'rgba(122,75,37,0.12)'
        : mode === 'gold'
        ? 'rgba(215,180,106,0.15)'
        : 'rgba(255,61,154,0.16)',
    border:
      mode === 'wood'
        ? '1px solid rgba(122,75,37,0.22)'
        : mode === 'gold'
        ? '1px solid rgba(215,180,106,0.30)'
        : '1px solid rgba(255,255,255,0.14)',
    color: mode === 'wood' ? '#5a351a' : mode === 'gold' ? '#f7d989' : '#ffffff',
    fontSize: 15,
    fontWeight: 1000,
    textTransform: 'uppercase',
  }),
  menuColumns: {
    display: 'grid',
    gap: 14,
    minWidth: 0,
  },
  menuColumn: (mode) => ({
    display: 'grid',
    alignContent: 'start',
    gap: mode === 'wood' ? 10 : 9,
    borderRadius: mode === 'wood' ? 26 : 24,
    padding: mode === 'wood' ? 14 : 12,
    background:
      mode === 'wood'
        ? 'rgba(255,251,244,0.76)'
        : 'rgba(0,0,0,0.44)',
    border:
      mode === 'wood'
        ? '1px solid rgba(122,75,37,0.14)'
        : '1px solid rgba(255,255,255,0.11)',
    boxShadow:
      mode === 'wood'
        ? '0 20px 58px rgba(84,52,24,0.13)'
        : '0 24px 70px rgba(0,0,0,0.28)',
    backdropFilter: 'blur(14px)',
  }),
  menuRow: (mode) => ({
    appearance: 'none',
    width: '100%',
    minHeight: mode === 'wood' ? 62 : 58,
    borderRadius: mode === 'wood' ? 17 : 16,
    border:
      mode === 'wood'
        ? '1px solid rgba(122,75,37,0.12)'
        : mode === 'gold'
        ? '1px solid rgba(215,180,106,0.17)'
        : '1px solid rgba(255,255,255,0.12)',
    background:
      mode === 'wood'
        ? 'rgba(255,255,255,0.56)'
        : mode === 'gold'
        ? 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(215,180,106,0.07))'
        : 'rgba(255,255,255,0.06)',
    padding: '9px 12px',
    display: 'grid',
    gap: 3,
    textAlign: 'left',
    boxSizing: 'border-box',
  }),
  menuMeta: (mode) => ({
    color: mode === 'wood' ? 'rgba(122,75,37,0.72)' : mode === 'gold' ? 'rgba(215,180,106,0.78)' : '#49f5ff',
    fontSize: 10,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  }),
  menuRowMain: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    alignItems: 'baseline',
  },
  menuName: (mode) => ({
    color: mode === 'wood' ? '#2d1c10' : '#ffffff',
    fontSize: mode === 'wood' ? 20 : 18,
    fontWeight: 950,
    lineHeight: 1.14,
    overflow: 'visible',
    whiteSpace: 'normal',
  }),
  menuPrice: (mode) => ({
    color: mode === 'wood' ? '#7a4b25' : mode === 'gold' ? '#d7b46a' : '#ff3d9a',
    fontSize: mode === 'wood' ? 20 : 19,
    fontWeight: 1000,
    whiteSpace: 'nowrap',
  }),
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 11,
    height: '100%',
    alignContent: 'start',
  },
  tileItem: {
    appearance: 'none',
    minHeight: 67,
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,61,154,0.10))',
    padding: '10px 11px',
    textAlign: 'left',
    display: 'grid',
    gap: 3,
  },
  tileSection: {
    color: '#49f5ff',
    fontSize: 10,
    fontWeight: 1000,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  tileName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 1000,
    lineHeight: 1.06,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  tilePrice: {
    color: '#ffca3d',
    fontSize: 17,
    fontWeight: 1000,
  },
  featureBand: (mode) => ({
    position: 'relative',
    zIndex: 1,
    marginTop: 22,
    height: 300,
    display: 'grid',
    gridTemplateColumns: '0.72fr 1.28fr',
    gap: 18,
    borderRadius: 30,
    padding: 16,
    boxSizing: 'border-box',
    background:
      mode === 'wood'
        ? 'rgba(255,251,244,0.72)'
        : mode === 'gold'
        ? 'linear-gradient(135deg, rgba(215,180,106,0.16), rgba(0,0,0,0.42))'
        : 'linear-gradient(135deg, rgba(255,61,154,0.18), rgba(0,229,255,0.10))',
    border:
      mode === 'wood'
        ? '1px solid rgba(122,75,37,0.16)'
        : mode === 'gold'
        ? '1px solid rgba(215,180,106,0.24)'
        : '1px solid rgba(255,255,255,0.14)',
    boxShadow: mode === 'wood' ? '0 20px 60px rgba(84,52,24,0.14)' : '0 24px 74px rgba(0,0,0,0.32)',
    backdropFilter: 'blur(16px)',
  }),
  featureBandPhoto: {
    appearance: 'none',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 24,
    padding: 0,
    overflow: 'hidden',
    background: '#111',
    minHeight: 0,
  },
  featureBandCopy: (mode) => ({
    display: 'grid',
    alignContent: 'center',
    gap: 12,
    minWidth: 0,
    color: mode === 'wood' ? '#2d1c10' : '#fff',
  }),
  featureBandKicker: (mode) => ({
    color: mode === 'wood' ? '#7a4b25' : mode === 'gold' ? '#d7b46a' : '#49f5ff',
    fontSize: 16,
    fontWeight: 1000,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  }),
  featureBandTitle: () => ({
    color: 'inherit',
    fontSize: 32,
    fontWeight: 1000,
    lineHeight: 1.06,
    letterSpacing: 0,
  }),
  featureBandText: (mode) => ({
    color: mode === 'wood' ? 'rgba(45,28,16,0.66)' : 'rgba(255,255,255,0.68)',
    fontSize: 18,
    fontWeight: 820,
    lineHeight: 1.25,
  }),
  qrDock: (tone, variant = 'steak') => ({
    position: 'absolute',
    zIndex: 4,
    left: variant === 'korean' ? 116 : variant === 'fusion' ? 132 : 92,
    right: variant === 'korean' ? 116 : variant === 'fusion' ? 132 : 92,
    bottom: variant === 'fusion' ? 34 : 30,
    minHeight: variant === 'steak' ? 166 : variant === 'fusion' ? 148 : 156,
    borderRadius: variant === 'fusion' ? 999 : variant === 'korean' ? 26 : 34,
    appearance: 'none',
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns:
      variant === 'steak'
        ? '138px minmax(0, 620px)'
        : variant === 'fusion'
        ? '112px minmax(0, 560px)'
        : '118px minmax(0, 590px)',
    gap: variant === 'fusion' ? 20 : 26,
    alignItems: 'center',
    justifyContent: 'center',
    justifyItems: 'center',
    padding: variant === 'fusion' ? '18px 26px' : variant === 'steak' ? '20px 28px' : '18px 24px',
    boxSizing: 'border-box',
    textDecoration: 'none',
    textAlign: 'center',
    background:
      tone === 'wood'
        ? 'linear-gradient(135deg, rgba(255,251,244,0.96), rgba(238,221,192,0.88))'
        : tone === 'neon'
        ? 'linear-gradient(90deg, rgba(255,61,154,0.40), rgba(16,21,52,0.86) 48%, rgba(0,229,255,0.26))'
        : 'linear-gradient(135deg, rgba(14,10,6,0.86), rgba(67,44,18,0.74))',
    border:
      tone === 'wood'
        ? '1px solid rgba(122,75,37,0.22)'
        : tone === 'neon'
        ? '1px solid rgba(255,255,255,0.22)'
        : '1px solid rgba(215,180,106,0.34)',
    boxShadow:
      tone === 'wood'
        ? '0 22px 72px rgba(84,52,24,0.20)'
        : tone === 'neon'
        ? '0 22px 80px rgba(255,61,154,0.20), 0 26px 90px rgba(0,0,0,0.45)'
        : '0 28px 95px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.10)',
    backdropFilter: 'blur(18px)',
  }),
  qrBox: (tone, variant = 'steak') => ({
    width: variant === 'steak' ? 128 : variant === 'fusion' ? 104 : 112,
    height: variant === 'steak' ? 128 : variant === 'fusion' ? 104 : 112,
    borderRadius: variant === 'fusion' ? 28 : variant === 'korean' ? 18 : 24,
    display: 'grid',
    placeItems: 'center',
    background: '#ffffff',
    boxShadow: tone === 'wood' ? '0 12px 32px rgba(84,52,24,0.18)' : '0 14px 42px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    padding: 8,
    boxSizing: 'border-box',
  }),
  qrImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  qrMissing: (tone) => ({
    width: '100%',
    height: '100%',
    borderRadius: 15,
    border: `2px dashed ${tone === 'wood' ? 'rgba(122,75,37,0.35)' : 'rgba(17,24,39,0.25)'}`,
    color: tone === 'wood' ? '#7a4b25' : '#111827',
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 2,
    fontSize: 28,
    fontWeight: 1000,
    lineHeight: 1,
  }),
  qrMissingSmall: {
    fontSize: 11,
    letterSpacing: 0.8,
  },
  qrCopy: () => ({
    minWidth: 0,
    width: '100%',
    display: 'grid',
    justifyItems: 'center',
    textAlign: 'center',
  }),
  qrTitle: (tone) => ({
    color: tone === 'wood' ? '#2d1c10' : '#ffffff',
    fontSize: tone === 'neon' ? 34 : tone === 'wood' ? 36 : 40,
    fontWeight: 1000,
    lineHeight: 1,
    textAlign: 'center',
  }),
  qrSub: (tone) => ({
    marginTop: 10,
    color: tone === 'wood' ? 'rgba(45,28,16,0.68)' : 'rgba(255,255,255,0.68)',
    fontSize: tone === 'neon' ? 18 : 20,
    fontWeight: 850,
    overflow: 'hidden',
    whiteSpace: 'normal',
    textAlign: 'center',
    lineHeight: 1.18,
  }),
};

const touch = {
  sheet: {
    position: 'fixed',
    left: '50%',
    bottom: 86,
    transform: 'translateX(-50%)',
    zIndex: 100000,
    width: 'min(720px, calc(100vw - 28px))',
    maxHeight: 'min(560px, calc(100vh - 150px))',
    overflow: 'auto',
    padding: 16,
    borderRadius: 18,
    background: 'rgba(255,255,255,0.97)',
    border: '1px solid rgba(17,24,39,0.12)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.34)',
    backdropFilter: 'blur(12px)',
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    color: '#111827',
  },
  handle: {
    width: 52,
    height: 5,
    borderRadius: 999,
    background: '#cbd5e1',
    margin: '0 auto 12px',
  },
  top: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  kicker: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 3,
    color: '#111827',
    fontSize: 21,
    fontWeight: 1000,
    lineHeight: 1.12,
  },
  close: {
    width: 42,
    height: 42,
    borderRadius: 10,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    fontSize: 26,
    fontWeight: 900,
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  },
  grid: {
    display: 'grid',
    gap: 12,
  },
  field: {
    display: 'grid',
    gap: 7,
  },
  label: {
    color: '#334155',
    fontSize: 12,
    fontWeight: 950,
  },
  input: {
    width: '100%',
    minHeight: 48,
    padding: '12px 13px',
    borderRadius: 12,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#111827',
    fontSize: 18,
    fontWeight: 850,
    outline: 'none',
    boxSizing: 'border-box',
  },
  color: {
    width: 72,
    height: 46,
    border: '1px solid #cbd5e1',
    borderRadius: 12,
    background: '#fff',
    padding: 4,
  },
  mediaRow: {
    display: 'grid',
    gridTemplateColumns: '82px 1fr auto',
    gap: 10,
    alignItems: 'center',
  },
  logoPreview: {
    width: 82,
    height: 82,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #d1d5db',
    background: '#f8fafc',
    display: 'grid',
    placeItems: 'center',
    color: '#64748b',
    fontSize: 12,
    fontWeight: 900,
  },
  photoPreview: {
    width: '100%',
    height: 230,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #d1d5db',
    background: '#f8fafc',
    display: 'grid',
    placeItems: 'center',
    color: '#64748b',
    fontWeight: 900,
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  previewImgContain: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: '#fff',
  },
  mediaActions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  primaryLabel: {
    minHeight: 46,
    padding: '0 16px',
    borderRadius: 12,
    border: '1px solid rgba(15,118,110,0.20)',
    background: '#0f766e',
    color: '#fff',
    fontWeight: 950,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  secondaryBtn: {
    minHeight: 46,
    padding: '0 16px',
    borderRadius: 12,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    fontWeight: 950,
    cursor: 'pointer',
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

  itemRow: { display: 'grid', gridTemplateColumns: '24px 96px 1fr 96px 36px', gap: 8, alignItems: 'center' },
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
  rowSection: {
    minWidth: 0,
    padding: '10px 10px',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.10)',
    fontWeight: 900,
    outline: 'none',
    color: '#0f766e',
    background: 'rgba(15,118,110,0.05)',
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
  qrPreview: {
    width: 118,
    height: 118,
    borderRadius: 18,
    overflow: 'hidden',
    border: '1px solid rgba(0,0,0,0.10)',
    background: '#fff',
    boxShadow: '0 8px 18px rgba(0,0,0,0.06)',
    display: 'grid',
    placeItems: 'center',
    padding: 8,
    boxSizing: 'border-box',
  },
  qrPreviewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
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
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    border: '1px solid rgba(0,0,0,0.10)',
    background: 'rgba(0,0,0,0.03)',
    height: 140,
    display: 'grid',
    gridTemplateRows: '1fr auto',
  },
  photoSlotLabel: {
    position: 'absolute',
    left: 8,
    top: 8,
    right: 8,
    minHeight: 26,
    borderRadius: 999,
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(17,24,39,0.72)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 1000,
    textAlign: 'center',
    lineHeight: 1,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
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
