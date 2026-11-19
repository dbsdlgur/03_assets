(() => {
 const {
  indexToCol,
  formatCellRef,
  formatNumber,
  formatWon,
  evaluateCell,
  parseCellRef,
  formulaReferences,
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
 } = window.VaultPure;

 const $ = sel => document.querySelector(sel);
 const newId = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
 const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
 const changed = () => parent.vaultHost?.changed();

 const THEME_NAMES = ['green', 'lightgreen', 'amber', 'sky', 'lightyellow', 'blue', 'gray', 'red', 'navy'];

  function defaultSheet(name = 'Money') {
  return {
   id: newId(),
   name,
   rows: 30,
   cols: 12,
   cells: {},
   themes: {},
   formats: {},
   hiddenRows: [],
   hiddenCols: [],
   freezeFirstRow: false,
   negativeTheme: true,
  };
 }

 // 기존 금고의 다른 필드(비밀번호·이력 등)는 손대지 않고 그대로 보존한다.
 function normalize(input) {
  const s = structuredClone(input && typeof input === 'object' ? input : { schema: 1 });
  const rawMoney = s.money && typeof s.money === 'object' ? s.money : {};
  const sheets = Array.isArray(rawMoney.sheets) && rawMoney.sheets.length
   ? rawMoney.sheets.map((sh, i) => {
      const rows = Number.isInteger(sh?.rows) && sh.rows >= 1 ? sh.rows : 30;
      const cols = Number.isInteger(sh?.cols) && sh.cols >= 1 ? sh.cols : 12;
      const hiddenRows = Array.isArray(sh?.hiddenRows)
       ? [...new Set(sh.hiddenRows.filter(r => Number.isInteger(r) && r >= 0 && r < rows))] : [];
      const hiddenCols = Array.isArray(sh?.hiddenCols)
       ? [...new Set(sh.hiddenCols.filter(c => Number.isInteger(c) && c >= 0 && c < cols))] : [];
      const themes = {};
      if (sh?.themes && typeof sh.themes === 'object') {
       for (const [k, v] of Object.entries(sh.themes)) {
        if (THEME_NAMES.includes(v)) themes[k] = v;
       }
      }
      const formats = {};
      if (sh?.formats && typeof sh.formats === 'object') {
       for (const [k, v] of Object.entries(sh.formats)) {
        if (v === 'won') formats[k] = 'won';
       }
      }
      return {
       id: typeof sh?.id === 'string' && sh.id ? sh.id : newId(),
       name: typeof sh?.name === 'string' && sh.name.trim() ? sh.name.trim() : `Sheet ${i + 1}`,
       rows,
       cols,
       cells: sh?.cells && typeof sh.cells === 'object' ? { ...sh.cells } : {},
       themes,
       formats,
       hiddenRows,
       hiddenCols,
       freezeFirstRow: Boolean(sh?.freezeFirstRow),
       negativeTheme: sh?.negativeTheme !== false,
      };
     })
   : [defaultSheet('Money')];
  const activeSheetId = sheets.some(sh => sh.id === rawMoney.activeSheetId) ? rawMoney.activeSheetId : sheets[0].id;
  s.money = { activeSheetId, sheets, editLocked: rawMoney.editLocked === true };
  return s;
 }

 let state = normalize({ schema: 1 });
 let selected = { col: 0, row: 0 };
 let selectionEnd = { col: 0, row: 0 };
 let selectionDragMode = null;
 let isLocked = state.money.editLocked;
 let editing = false;
 let committing = false;
 let activeEditor = null;
 let dragStart = null;
 let refSpan = null;
 const undoStack = [];
 const redoStack = [];
 const MAX_UNDO = 50;

 function pushUndo() {
  undoStack.push({
   money: structuredClone(state.money),
   selected: { ...selected },
   selectionEnd: { ...selectionEnd },
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
 }

 function undo() {
  if (isLocked) return;
  if (!undoStack.length) return;
  redoStack.push({
   money: structuredClone(state.money),
   selected: { ...selected },
   selectionEnd: { ...selectionEnd },
  });
  const snap = undoStack.pop();
  state.money = snap.money;
  selected = snap.selected;
  selectionEnd = snap.selectionEnd;
  changed();
  renderAll();
 }

 function redo() {
  if (isLocked) return;
  if (!redoStack.length) return;
  undoStack.push({
   money: structuredClone(state.money),
   selected: { ...selected },
   selectionEnd: { ...selectionEnd },
  });
  const snap = redoStack.pop();
  state.money = snap.money;
  selected = snap.selected;
  selectionEnd = snap.selectionEnd;
  changed();
  renderAll();
 }

 const sheetWrap = $('#sheetWrap');
 const cellRefEl = $('#cellRef');
 const formulaInput = $('#formulaInput');
 const sheetTabsEl = $('#sheetTabs');

 // Zoom is a viewing preference and stays available while editing is locked.
 let sheetZoom = 1;
 let pinch = null;
 const clampZoom = value => Math.max(0.5, Math.min(2, Math.round(value * 100) / 100));
 function setSheetZoom(value, point = { x: sheetWrap.clientWidth / 2, y: sheetWrap.clientHeight / 2 }, origin = null) {
  const next = clampZoom(value);
  const content = origin || { x: (sheetWrap.scrollLeft + point.x) / sheetZoom, y: (sheetWrap.scrollTop + point.y) / sheetZoom };
  sheetZoom = next;
  const table = sheetWrap.querySelector('.sheet-table');
  if (table) table.style.zoom = String(next);
  sheetWrap.scrollLeft = content.x * next - point.x;
  sheetWrap.scrollTop = content.y * next - point.y;
  $('#zoomResetBtn').textContent = `${Math.round(next * 100)}%`;
  $('#zoomOutBtn').disabled = next <= 0.5;
  $('#zoomInBtn').disabled = next >= 2;
 }
 $('#zoomOutBtn').addEventListener('click', () => setSheetZoom(sheetZoom - 0.1));
 $('#zoomInBtn').addEventListener('click', () => setSheetZoom(sheetZoom + 0.1));
 $('#zoomResetBtn').addEventListener('click', () => setSheetZoom(1));
 function touchView(touches) {
  const [a, b] = touches;
  const rect = sheetWrap.getBoundingClientRect();
  return {
   distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
   point: { x: (a.clientX + b.clientX) / 2 - rect.left - sheetWrap.clientLeft, y: (a.clientY + b.clientY) / 2 - rect.top - sheetWrap.clientTop },
  };
 }
 sheetWrap.addEventListener('touchstart', e => {
  if (e.touches.length !== 2) { pinch = null; return; }
  const view = touchView(e.touches);
  if (!view.distance) return;
  e.preventDefault();
  dragStart = null;
  selectionDragMode = null;
  pinch = { distance: view.distance, zoom: sheetZoom, origin: { x: (sheetWrap.scrollLeft + view.point.x) / sheetZoom, y: (sheetWrap.scrollTop + view.point.y) / sheetZoom } };
 }, { passive: false });
 sheetWrap.addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const view = touchView(e.touches);
  setSheetZoom(pinch.zoom * view.distance / pinch.distance, view.point, pinch.origin);
 }, { passive: false });
 const endPinch = () => { pinch = null; };
 sheetWrap.addEventListener('touchend', endPinch);
 sheetWrap.addEventListener('touchcancel', endPinch);
 sheetWrap.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = sheetWrap.getBoundingClientRect();
  setSheetZoom(sheetZoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left - sheetWrap.clientLeft, y: e.clientY - rect.top - sheetWrap.clientTop });
 }, { passive: false });

 function setEditLocked(locked, notify = true) {
  // Finish an in-progress edit before entering read-only mode.
  activeEditor?.blur();
  if (document.activeElement === formulaInput) formulaInput.blur();
  const didChange = state.money.editLocked !== locked;
  isLocked = locked;
  state.money.editLocked = locked;
  dragStart = null;
  selectionDragMode = null;
  dragSheetIdx = -1;
  clearRefHighlight();
  $('#sheetToolbar').hidden = locked;
  $('#sheetTabActions').hidden = locked;
  formulaInput.readOnly = locked;
  for (const control of document.querySelectorAll('#sheetToolbar button, #sheetToolbar input, #sheetTabActions button')) {
   control.disabled = locked;
  }
  for (const tab of sheetTabsEl.querySelectorAll('.sheet-tab')) tab.draggable = !locked;
  const button = $('#editLockBtn');
  button.setAttribute('aria-pressed', String(locked));
  button.textContent = locked ? '잠금 해제' : '잠금';
  button.title = locked ? '편집 잠금 해제' : '편집 잠금';
  refreshSelection();
  updateSheetActions();
  if (notify && didChange) changed();
 }
 $('#editLockBtn').addEventListener('click', () => setEditLocked(!isLocked));

 const activeSheet = () => state.money.sheets.find(s => s.id === state.money.activeSheetId) || state.money.sheets[0];

 function visibleIndices(total, hiddenList) {
  const hidden = new Set(hiddenList || []);
  const list = [];
  for (let i = 0; i < total; i++) if (!hidden.has(i)) list.push(i);
  return list;
 }

 function nearestVisible(target, total, hiddenList) {
  const visible = visibleIndices(total, hiddenList);
  if (!visible.length) return 0;
  let best = visible[0];
  let bestDist = Math.abs(best - target);
  for (const idx of visible) {
   const d = Math.abs(idx - target);
   if (d < bestDist) { best = idx; bestDist = d; }
  }
  return best;
 }

 function clampSelection(sheet) {
  selected.col = nearestVisible(Math.max(0, Math.min(sheet.cols - 1, selected.col)), sheet.cols, sheet.hiddenCols);
  selected.row = nearestVisible(Math.max(0, Math.min(sheet.rows - 1, selected.row)), sheet.rows, sheet.hiddenRows);
  selectionEnd.col = nearestVisible(Math.max(0, Math.min(sheet.cols - 1, selectionEnd.col)), sheet.cols, sheet.hiddenCols);
  selectionEnd.row = nearestVisible(Math.max(0, Math.min(sheet.rows - 1, selectionEnd.row)), sheet.rows, sheet.hiddenRows);
 }

 function getSelectionBounds(sheet) {
  clampSelection(sheet);
  return {
   minCol: Math.min(selected.col, selectionEnd.col),
   maxCol: Math.max(selected.col, selectionEnd.col),
   minRow: Math.min(selected.row, selectionEnd.row),
   maxRow: Math.max(selected.row, selectionEnd.row),
  };
 }

 function showUpdatedAt() {
  const at = state.updatedAt ? new Date(state.updatedAt) : null;
  const label = $('#updatedAt');
  const valid = at && !isNaN(at);
  const pad = n => String(n).padStart(2, '0');
  label.textContent = valid ? `${pad(at.getMonth() + 1)}.${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}` : '';
  label.title = valid ? '저장 ' + at.toLocaleString('ko-KR') : '';
  label.setAttribute('aria-label', label.title);
  if (valid) label.dateTime = at.toISOString();
  else label.removeAttribute('datetime');
 }

 function setCellValue(sheet, key, value) {
  if (isLocked) return;
  const next = String(value ?? '');
  const prev = String(sheet.cells[key] ?? '');
  if (next === prev) return false;
  if (next === '') delete sheet.cells[key];
  else sheet.cells[key] = next;
  changed();
  return true;
 }

 function updateFormulaBar() {
  const sheet = activeSheet();
  const bounds = getSelectionBounds(sheet);
  const key = formatCellRef(selected.col, selected.row);
  if (bounds.minCol === bounds.maxCol && bounds.minRow === bounds.maxRow) {
   cellRefEl.textContent = key;
  } else {
   cellRefEl.textContent = `${formatCellRef(bounds.minCol, bounds.minRow)}:${formatCellRef(bounds.maxCol, bounds.maxRow)}`;
  }
  formulaInput.value = sheet.cells[key] ?? '';
 }

 function updateToolbarState(sheet) {
  const hiddenCount = (sheet.hiddenRows?.length || 0) + (sheet.hiddenCols?.length || 0);
  const unhideBtn = $('#unhideAllBtn');
  unhideBtn.disabled = isLocked || hiddenCount === 0;
  unhideBtn.textContent = `해제 (${hiddenCount})`;
  unhideBtn.setAttribute('aria-label', `숨김 해제 (${hiddenCount})`);
  $('#freezeRowBtn').setAttribute('aria-pressed', String(Boolean(sheet.freezeFirstRow)));
  $('#negThemeBtn').setAttribute('aria-pressed', String(sheet.negativeTheme !== false));
  const activeKey = formatCellRef(selected.col, selected.row);
  $('#wonBtn').setAttribute('aria-pressed', String(sheet.formats?.[activeKey] === 'won'));
 }

 function cellElement(col, row) {
  return sheetWrap.querySelector(`td[data-col="${col}"][data-row="${row}"]`);
 }

 // 선택 이동은 값·수식·테마를 다시 그리지 않는다.
 function refreshSelection() {
  const sheet = activeSheet();
  const bounds = getSelectionBounds(sheet);
  const isSingle = bounds.minCol === bounds.maxCol && bounds.minRow === bounds.maxRow;
  for (const td of sheetWrap.querySelectorAll('td[data-key]')) {
   const col = Number(td.dataset.col);
   const row = Number(td.dataset.row);
   const isSelected = col === selected.col && row === selected.row;
   const inRange = !isSingle && col >= bounds.minCol && col <= bounds.maxCol && row >= bounds.minRow && row <= bounds.maxRow;
   td.classList.toggle('is-selected', isSelected);
   td.classList.toggle('is-in-range', inRange && !isSelected);
  }
  for (const th of sheetWrap.querySelectorAll('thead th[data-col]')) {
   const c = Number(th.dataset.col);
   th.classList.toggle('is-active-header', c >= bounds.minCol && c <= bounds.maxCol);
  }
  for (const th of sheetWrap.querySelectorAll('tbody th[data-row]')) {
   const r = Number(th.dataset.row);
   th.classList.toggle('is-active-header', r >= bounds.minRow && r <= bounds.maxRow);
  }
  updateFormulaBar();
  updateToolbarState(sheet);
  updateFormulaReferences();
 }

 function updateFormulaReferences(draft = null) {
  const sheet = activeSheet();
  const bounds = getSelectionBounds(sheet);
  const editor = activeEditor || (document.activeElement === formulaInput ? formulaInput : null);
  let references = [];
  if (draft !== null || editor) {
   references = formulaReferences(draft ?? editor.value);
  } else {
   // 행·범위 선택 시 그 안의 수식들이 직접 참조하는 셀을 함께 표시한다.
   for (const [key, value] of Object.entries(sheet.cells)) {
    if (typeof value !== 'string' || !value.startsWith('=')) continue;
    const cell = parseCellRef(key);
    if (cell && cell.col >= bounds.minCol && cell.col <= bounds.maxCol && cell.row >= bounds.minRow && cell.row <= bounds.maxRow) {
     references.push(...formulaReferences(value));
    }
   }
  }
  // 보이는 셀만 검사하므로 아주 큰 범위를 참조해도 범위 전체를 생성하지 않는다.
  for (const td of sheetWrap.querySelectorAll('td[data-key]')) {
   const col = Number(td.dataset.col), row = Number(td.dataset.row);
   td.classList.toggle('is-formula-reference', references.some(ref => col >= ref.minCol && col <= ref.maxCol && row >= ref.minRow && row <= ref.maxRow));
  }
 }

 function refreshDisplay() {
  const sheet = activeSheet();
  for (const td of sheetWrap.querySelectorAll('td[data-key]')) {
   const key = td.dataset.key;
   const isSelected = Number(td.dataset.col) === selected.col && Number(td.dataset.row) === selected.row;
   const cellTheme = sheet.themes?.[key];
   for (const t of THEME_NAMES) td.classList.toggle(`theme-${t}`, cellTheme === t);
   if (editing && isSelected) {
    td.classList.remove('is-negative');
    continue;
   }
   const res = evaluateCell(key, sheet.cells);
   const rawStr = String(sheet.cells[key] ?? '');
   const isWon = sheet.formats?.[key] === 'won' || (!rawStr.startsWith('=') && rawStr.includes('₩'));
   const fractionDigits = rawStr.startsWith('=') && rawStr.includes('/') ? 0 : 6;
   const displayText = res.isNumber
    ? (isWon ? formatWon(res.numeric, fractionDigits) : formatNumber(res.numeric, fractionDigits))
    : res.display;
   // 같은 텍스트를 대입해도 텍스트 노드가 교체되므로 실제 변경 때만 갱신한다.
   if (td.textContent !== displayText) td.textContent = displayText;
   td.classList.toggle('is-number', res.isNumber);
   td.classList.toggle('is-error', Boolean(res.error));
   td.classList.toggle('is-negative', sheet.negativeTheme !== false && res.isNumber && res.numeric < 0);
   const title = rawStr.startsWith('=') ? `${rawStr} → ${displayText}` : '';
   if (td.title !== title) td.title = title;
  }
  refreshSelection();
 }

 function selectCell(col, row, scrollIntoView = true, extend = false) {
  const sheet = activeSheet();
  const targetCol = nearestVisible(Math.max(0, Math.min(sheet.cols - 1, col)), sheet.cols, sheet.hiddenCols);
  const targetRow = nearestVisible(Math.max(0, Math.min(sheet.rows - 1, row)), sheet.rows, sheet.hiddenRows);
  if (extend) {
   selectionEnd = { col: targetCol, row: targetRow };
  } else {
   selected = { col: targetCol, row: targetRow };
   selectionEnd = { col: targetCol, row: targetRow };
  }
  refreshSelection();
  if (scrollIntoView) {
   cellElement(targetCol, targetRow)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
 }

 function getFormulaEditor() {
  if (activeEditor && activeEditor.value.startsWith('=')) return activeEditor;
  if (document.activeElement === formulaInput && formulaInput.value.startsWith('=')) return formulaInput;
  return null;
 }

 function clearRefHighlight() {
  for (const td of sheetWrap.querySelectorAll('td.is-ref-highlight')) {
   td.classList.remove('is-ref-highlight');
  }
 }

 function highlightRefRange(a, b) {
  clearRefHighlight();
  const minCol = Math.min(a.col, b.col), maxCol = Math.max(a.col, b.col);
  const minRow = Math.min(a.row, b.row), maxRow = Math.max(a.row, b.row);
  for (let r = minRow; r <= maxRow; r++) {
   for (let c = minCol; c <= maxCol; c++) {
    cellElement(c, r)?.classList.add('is-ref-highlight');
   }
  }
 }

 function formatRefOrRange(a, b) {
  if (a.col === b.col && a.row === b.row) return formatCellRef(a.col, a.row);
  const minCol = Math.min(a.col, b.col), maxCol = Math.max(a.col, b.col);
  const minRow = Math.min(a.row, b.row), maxRow = Math.max(a.row, b.row);
  return `${formatCellRef(minCol, minRow)}:${formatCellRef(maxCol, maxRow)}`;
 }

 function applyPointedRef(input, a, b) {
  const refText = formatRefOrRange(a, b);
  const val = input.value;
  let start, end;

  if (refSpan && input.selectionStart === refSpan.end && input.selectionEnd === refSpan.end) {
   start = refSpan.start;
   end = refSpan.end;
  } else {
   const pos = input.selectionStart ?? val.length;
   const selEnd = input.selectionEnd ?? pos;
   const before = val.slice(0, pos);
   const trailingRef = pos === selEnd && /[=+\-*/(,]\s*([A-Za-z]+[1-9]\d*(?::[A-Za-z]+[1-9]\d*)?)$/.exec(before);
   if (trailingRef) {
    start = pos - trailingRef[1].length;
    end = pos;
   } else {
    start = pos;
    end = selEnd;
   }
  }

  input.value = val.slice(0, start) + refText + val.slice(end);
  refSpan = { start, end: start + refText.length };
  input.setSelectionRange(refSpan.end, refSpan.end);
  if (input === activeEditor) formulaInput.value = input.value;
  highlightRefRange(a, b);
  updateFormulaReferences(input.value);
 }

 function startEdit(initialText = null) {
  if (isLocked || editing) return;
  const sheet = activeSheet();
  clampSelection(sheet);
  const td = cellElement(selected.col, selected.row);
  if (!td) return;
  const key = formatCellRef(selected.col, selected.row);
  const original = sheet.cells[key] ?? '';
  editing = true;
  refSpan = null;
  td.classList.add('is-editing');
  td.textContent = '';

  const input = el('input', {
   type: 'text',
   className: 'cell-editor',
   autocomplete: 'off',
   spellcheck: false,
   value: initialText !== null ? initialText : original,
  });
  activeEditor = input;
  if (initialText !== null) formulaInput.value = input.value;

  const finish = (commit, move = null) => {
   if (committing || !editing) return;
   committing = true;
   editing = false;
   activeEditor = null;
   dragStart = null;
   refSpan = null;
   clearRefHighlight();
   td.classList.remove('is-editing');
   if (commit && input.value !== String(sheet.cells[key] ?? '')) {
    pushUndo();
    setCellValue(sheet, key, input.value);
   }
   input.remove();
   refreshDisplay();
   committing = false;
   if (move) moveSelection(move.dc, move.dr);
   sheetWrap.focus({ preventScroll: true });
  };

  input.addEventListener('input', () => {
   refSpan = null;
   formulaInput.value = input.value;
   updateFormulaReferences(input.value);
  });

  input.addEventListener('keydown', e => {
   if (e.key === 'Enter') {
    e.preventDefault();
    finish(true, { dc: 0, dr: e.shiftKey ? -1 : 1 });
   } else if (e.key === 'Tab') {
    e.preventDefault();
    finish(true, { dc: e.shiftKey ? -1 : 1, dr: 0 });
   } else if (e.key === 'Escape') {
    e.preventDefault();
    finish(false);
   }
  });

  input.addEventListener('blur', () => {
   finish(true);
  });

  td.append(input);
  input.focus();
  if (initialText === null) input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
  updateFormulaReferences(input.value);
 }

 function moveSelection(dc, dr, extend = false) {
  const sheet = activeSheet();
  const cols = visibleIndices(sheet.cols, sheet.hiddenCols);
  const rows = visibleIndices(sheet.rows, sheet.hiddenRows);
  const base = extend ? selectionEnd : selected;
  const ci = Math.max(0, cols.indexOf(base.col));
  const ri = Math.max(0, rows.indexOf(base.row));
  const nextCol = cols[Math.max(0, Math.min(cols.length - 1, ci + dc))] ?? base.col;
  const nextRow = rows[Math.max(0, Math.min(rows.length - 1, ri + dr))] ?? base.row;
  selectCell(nextCol, nextRow, true, extend);
 }

 let cellClickEditReady = false;
 let didDragSelection = false;

 function commitEditorsBeforeSelection() {
  activeEditor?.blur();
  if (document.activeElement === formulaInput) formulaInput.blur();
 }

 function renderGrid() {
  const sheet = activeSheet();
  clampSelection(sheet);
  editing = false;
  activeEditor = null;
  dragStart = null;
  selectionDragMode = null;
  cellClickEditReady = false;
  didDragSelection = false;

  const visCols = visibleIndices(sheet.cols, sheet.hiddenCols);
  const visRows = visibleIndices(sheet.rows, sheet.hiddenRows);

  const table = el('table', { className: 'sheet-table' });
  table.style.zoom = String(sheetZoom);
  if (sheet.freezeFirstRow) table.classList.add('is-frozen-first');

  const thead = el('thead');
  const headRow = el('tr');
  const corner = el('th', { className: 'corner-cell', textContent: '' });
  corner.addEventListener('click', () => {
   if (getFormulaEditor() || editing) return;
   selected = { col: visCols[0] ?? 0, row: visRows[0] ?? 0 };
   selectionEnd = { col: visCols[visCols.length - 1] ?? 0, row: visRows[visRows.length - 1] ?? 0 };
   refreshSelection();
   sheetWrap.focus({ preventScroll: true });
  });
  headRow.append(corner);

  for (let ci = 0; ci < visCols.length; ci++) {
   const c = visCols[ci];
   const th = el('th', { textContent: indexToCol(c) });
   th.dataset.col = String(c);
   const hiddenBefore = (ci === 0 && c > 0) || (ci > 0 && c - visCols[ci - 1] > 1);
   const hiddenAfter = ci === visCols.length - 1 && c < sheet.cols - 1;
   if (hiddenBefore) th.classList.add('has-hidden-col-before');
   if (hiddenAfter) th.classList.add('has-hidden-col-after');
   th.addEventListener('mousedown', e => {
    if (e.button !== 0 || getFormulaEditor()) return;
    e.preventDefault();
    commitEditorsBeforeSelection();
    if (e.shiftKey) {
     selected.row = visRows[0] ?? 0;
     selectionEnd = { col: c, row: visRows[visRows.length - 1] ?? 0 };
    } else {
     selected = { col: c, row: visRows[0] ?? 0 };
     selectionEnd = { col: c, row: visRows[visRows.length - 1] ?? 0 };
     selectionDragMode = 'cols';
    }
    refreshSelection();
    sheetWrap.focus({ preventScroll: true });
   });
   headRow.append(th);
  }
  thead.append(headRow);

  const tbody = el('tbody');
  for (let ri = 0; ri < visRows.length; ri++) {
   const r = visRows[ri];
   const tr = el('tr');
   const hiddenRowBefore = (ri === 0 && r > 0) || (ri > 0 && r - visRows[ri - 1] > 1);
   const hiddenRowAfter = ri === visRows.length - 1 && r < sheet.rows - 1;
   if (hiddenRowBefore) tr.classList.add('has-hidden-row-before');
   if (hiddenRowAfter) tr.classList.add('has-hidden-row-after');
   const rowTh = el('th', { textContent: String(r + 1) });
   rowTh.dataset.row = String(r);
   rowTh.addEventListener('mousedown', e => {
    if (e.button !== 0 || getFormulaEditor()) return;
    e.preventDefault();
    commitEditorsBeforeSelection();
    if (e.shiftKey) {
     selected.col = visCols[0] ?? 0;
     selectionEnd = { col: visCols[visCols.length - 1] ?? 0, row: r };
    } else {
     selected = { col: visCols[0] ?? 0, row: r };
     selectionEnd = { col: visCols[visCols.length - 1] ?? 0, row: r };
     selectionDragMode = 'rows';
    }
    refreshSelection();
    sheetWrap.focus({ preventScroll: true });
   });
   tr.append(rowTh);

   for (let ci = 0; ci < visCols.length; ci++) {
    const c = visCols[ci];
    const key = formatCellRef(c, r);
    const td = el('td');
    td.dataset.col = String(c);
    td.dataset.row = String(r);
    td.dataset.key = key;
    if ((ci === 0 && c > 0) || (ci > 0 && c - visCols[ci - 1] > 1)) td.classList.add('has-hidden-col-before');
    if (ci === visCols.length - 1 && c < sheet.cols - 1) td.classList.add('has-hidden-col-after');
    td.addEventListener('mousedown', e => {
     if (e.button !== 0) return;
     // 입력칸 자체를 누르면 선택을 바꾸지 않고 커서만 이동한다.
     if (e.target === activeEditor) return;
     const editor = getFormulaEditor();
     if (editor) {
      e.preventDefault();
      dragStart = { col: c, row: r };
      applyPointedRef(editor, dragStart, dragStart);
      return;
     }
     // Commit against the old selection before changing the selected cell.
     commitEditorsBeforeSelection();
     didDragSelection = false;
     cellClickEditReady = !e.shiftKey && selected.col === c && selected.row === r && selectionEnd.col === c && selectionEnd.row === r;
     if (!cellClickEditReady) {
      selectCell(c, r, false, e.shiftKey);
      if (!e.shiftKey) selectionDragMode = 'cells';
      sheetWrap.focus({ preventScroll: true });
     } else {
      selectionDragMode = 'cells';
     }
    });
    td.addEventListener('click', () => {
     if (editing || getFormulaEditor()) return;
     if (cellClickEditReady && !didDragSelection) startEdit();
     cellClickEditReady = false;
     didDragSelection = false;
    });
    td.addEventListener('dblclick', () => {
     if (getFormulaEditor()) return;
     selectCell(c, r, false);
     startEdit();
    });
    tr.append(td);
   }
   tbody.append(tr);
  }

  table.append(thead, tbody);
  sheetWrap.replaceChildren(table);
  refreshDisplay();
 }

 function moveSheet(fromIdx, toIdx) {
  if (isLocked) return;
  const sheets = state.money.sheets;
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= sheets.length || toIdx >= sheets.length || fromIdx === toIdx) return;
  pushUndo();
  const [moved] = sheets.splice(fromIdx, 1);
  sheets.splice(toIdx, 0, moved);
  changed();
  renderSheetTabs();
 }

 let dragSheetIdx = -1;

 function renderSheetTabs() {
  sheetTabsEl.textContent = '';
  const sheets = state.money.sheets;
  sheets.forEach((sheet, idx) => {
   const btn = el('button', {
    type: 'button',
    className: 'sheet-tab',
    textContent: sheet.name,
    draggable: !isLocked,
   });
   btn.setAttribute('role', 'tab');
   const active = sheet.id === state.money.activeSheetId;
   btn.setAttribute('aria-selected', String(active));
   btn.addEventListener('click', () => {
    if (state.money.activeSheetId === sheet.id) return;
    state.money.activeSheetId = sheet.id;
    selected = { col: 0, row: 0 };
    selectionEnd = { col: 0, row: 0 };
    changed();
    renderSheetTabs();
    renderGrid();
   });
   btn.addEventListener('dragstart', e => {
    if (isLocked) { e.preventDefault(); return; }
    dragSheetIdx = idx;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
   });
   btn.addEventListener('dragover', e => {
    if (dragSheetIdx < 0 || dragSheetIdx === idx) return;
    e.preventDefault();
    btn.classList.add('is-drag-over');
   });
   btn.addEventListener('dragleave', () => {
    btn.classList.remove('is-drag-over');
   });
   btn.addEventListener('drop', e => {
    e.preventDefault();
    btn.classList.remove('is-drag-over');
    if (dragSheetIdx >= 0 && dragSheetIdx !== idx) moveSheet(dragSheetIdx, idx);
    dragSheetIdx = -1;
   });
   btn.addEventListener('dragend', () => {
    dragSheetIdx = -1;
    for (const elTab of sheetTabsEl.querySelectorAll('.is-drag-over')) elTab.classList.remove('is-drag-over');
   });
   sheetTabsEl.append(btn);
  });
  updateSheetActions();
 }

 function updateSheetActions() {
  const sheets = state.money.sheets;
  const activeIdx = sheets.findIndex(s => s.id === state.money.activeSheetId);
  $('#delSheetBtn').disabled = isLocked || sheets.length <= 1;
  $('#moveSheetLeftBtn').disabled = isLocked || activeIdx <= 0;
  $('#moveSheetRightBtn').disabled = isLocked || activeIdx < 0 || activeIdx >= sheets.length - 1;
 }

 function renderAll() {
  renderSheetTabs();
  renderGrid();
  showUpdatedAt();
 }

 function clearSelectedCells() {
  if (isLocked) return;
  const sheet = activeSheet();
  const bounds = getSelectionBounds(sheet);
  let hasAny = false;
  for (let r = bounds.minRow; r <= bounds.maxRow && !hasAny; r++) {
   for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
    if (sheet.cells[formatCellRef(c, r)]) { hasAny = true; break; }
   }
  }
  if (!hasAny) return;
  pushUndo();
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
   for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
    setCellValue(sheet, formatCellRef(c, r), '');
   }
  }
  refreshDisplay();
 }

 // 키보드 탐색 · 직접 입력 · 삭제 · 복사
 sheetWrap.addEventListener('keydown', e => {
  if (editing || document.activeElement === formulaInput) return;
  const sheet = activeSheet();

  if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(0, -1, e.shiftKey); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(0, 1, e.shiftKey); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelection(-1, 0, e.shiftKey); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(1, 0, e.shiftKey); return; }
  if (e.key === 'Tab') { e.preventDefault(); moveSelection(e.shiftKey ? -1 : 1, 0); return; }
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') {
   e.preventDefault();
   clearSelectedCells();
   return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
   const bounds = getSelectionBounds(sheet);
   const hiddenCols = new Set(sheet.hiddenCols || []);
   const hiddenRows = new Set(sheet.hiddenRows || []);
   const lines = [];
   for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
    if (hiddenRows.has(r)) continue;
    const cols = [];
    for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
     if (hiddenCols.has(c)) continue;
     cols.push(sheet.cells[formatCellRef(c, r)] ?? '');
    }
    lines.push(cols.join('\t'));
   }
   navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
   return;
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
   e.preventDefault();
   startEdit(e.key);
  }
 });

 // 엑셀·구글시트에서 복사한 탭/줄바꿈 데이터 붙여넣기
 sheetWrap.addEventListener('paste', e => {
  if (isLocked) { e.preventDefault(); return; }
  if (editing || document.activeElement === formulaInput) return;
  const text = e.clipboardData?.getData('text/plain');
  if (text == null) return;
  e.preventDefault();
  pushUndo();
  const sheet = activeSheet();
  const rows = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
  const needRows = selected.row + rows.length;
  const maxCols = Math.max(...rows.map(r => r.length));
  const needCols = selected.col + maxCols;
  let resized = false;
  if (needRows > sheet.rows) { sheet.rows = needRows; resized = true; }
  if (needCols > sheet.cols) { sheet.cols = needCols; resized = true; }
  for (let r = 0; r < rows.length; r++) {
   for (let c = 0; c < rows[r].length; c++) {
    setCellValue(sheet, formatCellRef(selected.col + c, selected.row + r), rows[r][c]);
   }
  }
  if (resized) renderGrid();
  else refreshDisplay();
 });

 // 수식 입력 중 셀·드래그 범위 선택 및 일반 셀·열·행 드래그 선택
 sheetWrap.addEventListener('mousemove', e => {
  if (dragStart) {
   const editor = getFormulaEditor();
   if (!editor) { dragStart = null; return; }
   const td = e.target.closest('td[data-col]');
   if (!td) return;
   applyPointedRef(editor, dragStart, { col: Number(td.dataset.col), row: Number(td.dataset.row) });
   return;
  }
  if (!selectionDragMode) return;
  if (selectionDragMode === 'cells') {
   const td = e.target.closest('td[data-col]');
   if (!td) return;
   const c = Number(td.dataset.col), r = Number(td.dataset.row);
   if (selectionEnd.col !== c || selectionEnd.row !== r) {
    didDragSelection = true;
    selectionEnd = { col: c, row: r };
    refreshSelection();
   }
  } else if (selectionDragMode === 'cols') {
   const cell = e.target.closest('[data-col]');
   if (!cell) return;
   const c = Number(cell.dataset.col);
   if (selectionEnd.col !== c) {
    selectionEnd.col = c;
    refreshSelection();
   }
  } else if (selectionDragMode === 'rows') {
   const cell = e.target.closest('[data-row]');
   if (!cell) return;
   const r = Number(cell.dataset.row);
   if (selectionEnd.row !== r) {
    selectionEnd.row = r;
    refreshSelection();
   }
  }
 });

 window.addEventListener('mouseup', () => {
  dragStart = null;
  selectionDragMode = null;
 });

 // 수식 입력줄
 formulaInput.addEventListener('focus', () => updateFormulaReferences());
 formulaInput.addEventListener('input', () => {
  refSpan = null;
  updateFormulaReferences(formulaInput.value);
 });

 formulaInput.addEventListener('keydown', e => {
  if (isLocked) return;
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);
  if (e.key === 'Enter') {
   e.preventDefault();
   refSpan = null;
   dragStart = null;
   clearRefHighlight();
   if (formulaInput.value !== String(sheet.cells[key] ?? '')) {
    pushUndo();
    setCellValue(sheet, key, formulaInput.value);
   }
   refreshDisplay();
   selectCell(selected.col, selected.row + 1);
   sheetWrap.focus({ preventScroll: true });
  } else if (e.key === 'Escape') {
   e.preventDefault();
   refSpan = null;
   dragStart = null;
   clearRefHighlight();
   updateFormulaBar();
   sheetWrap.focus({ preventScroll: true });
  }
 });

 formulaInput.addEventListener('blur', () => {
  if (isLocked) return;
  refSpan = null;
  dragStart = null;
  clearRefHighlight();
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);
  if (formulaInput.value !== String(sheet.cells[key] ?? '')) {
   pushUndo();
   setCellValue(sheet, key, formulaInput.value);
   refreshDisplay();
  } else {
   updateFormulaReferences();
  }
 });

 // 전역 되돌리기 / 다시 실행 (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y)
 window.addEventListener('keydown', e => {
  if (editing || document.activeElement === formulaInput) return;
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
   e.preventDefault();
   undo();
  } else if ((k === 'z' && e.shiftKey) || k === 'y') {
   e.preventDefault();
   redo();
  }
 });

 // 툴바 버튼
 $('#addRowBtn').addEventListener('click', () => {
  if (isLocked) return;
  pushUndo();
  const sheet = activeSheet();
  const atRow = selected.row + 1;
  sheet.cells = insertRow(sheet.cells, atRow);
  sheet.themes = insertRow(sheet.themes, atRow);
  sheet.formats = insertRow(sheet.formats, atRow);
  sheet.hiddenRows = sheet.hiddenRows.map(r => r >= atRow ? r + 1 : r);
  sheet.rows += 1;
  changed();
  renderGrid();
  selectCell(selected.col, atRow);
 });

 $('#addColBtn').addEventListener('click', () => {
  if (isLocked) return;
  pushUndo();
  const sheet = activeSheet();
  const atCol = selected.col + 1;
  sheet.cells = insertCol(sheet.cells, atCol);
  sheet.themes = insertCol(sheet.themes, atCol);
  sheet.formats = insertCol(sheet.formats, atCol);
  sheet.hiddenCols = sheet.hiddenCols.map(c => c >= atCol ? c + 1 : c);
  sheet.cols += 1;
  changed();
  renderGrid();
  selectCell(atCol, selected.row);
 });

 $('#delRowBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  if (sheet.rows <= 1) return;
  pushUndo();
  sheet.cells = deleteRow(sheet.cells, selected.row);
  sheet.themes = deleteRow(sheet.themes, selected.row);
  sheet.formats = deleteRow(sheet.formats, selected.row);
  sheet.hiddenRows = sheet.hiddenRows.filter(r => r !== selected.row).map(r => (r > selected.row ? r - 1 : r));
  sheet.rows -= 1;
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#delColBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  if (sheet.cols <= 1) return;
  pushUndo();
  sheet.cells = deleteCol(sheet.cells, selected.col);
  sheet.themes = deleteCol(sheet.themes, selected.col);
  sheet.formats = deleteCol(sheet.formats, selected.col);
  sheet.hiddenCols = sheet.hiddenCols.filter(c => c !== selected.col).map(c => (c > selected.col ? c - 1 : c));
  sheet.cols -= 1;
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#hideRowBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  const bounds = getSelectionBounds(sheet);
  const vis = visibleIndices(sheet.rows, sheet.hiddenRows);
  const toHide = vis.filter(r => r >= bounds.minRow && r <= bounds.maxRow);
  if (!toHide.length || vis.length - toHide.length < 1) return;
  pushUndo();
  for (const r of toHide) {
   if (!sheet.hiddenRows.includes(r)) sheet.hiddenRows.push(r);
  }
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#hideColBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  const bounds = getSelectionBounds(sheet);
  const vis = visibleIndices(sheet.cols, sheet.hiddenCols);
  const toHide = vis.filter(c => c >= bounds.minCol && c <= bounds.maxCol);
  if (!toHide.length || vis.length - toHide.length < 1) return;
  pushUndo();
  for (const c of toHide) {
   if (!sheet.hiddenCols.includes(c)) sheet.hiddenCols.push(c);
  }
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#unhideAllBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  if (!sheet.hiddenRows.length && !sheet.hiddenCols.length) return;
  pushUndo();
  sheet.hiddenRows = [];
  sheet.hiddenCols = [];
  changed();
  renderGrid();
 });

 $('#freezeRowBtn').addEventListener('click', () => {
  if (isLocked) return;
  pushUndo();
  const sheet = activeSheet();
  sheet.freezeFirstRow = !sheet.freezeFirstRow;
  changed();
  renderGrid();
 });

 $('#negThemeBtn').addEventListener('click', () => {
  if (isLocked) return;
  pushUndo();
  const sheet = activeSheet();
  sheet.negativeTheme = sheet.negativeTheme === false;
  changed();
  refreshDisplay();
 });

 $('#wonBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  if (!sheet.formats) sheet.formats = {};
  const bounds = getSelectionBounds(sheet);
  let allWon = true;
  for (let r = bounds.minRow; r <= bounds.maxRow && allWon; r++) {
   for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
    if (sheet.formats[formatCellRef(c, r)] !== 'won') { allWon = false; break; }
   }
  }
  pushUndo();
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
   for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
    const k = formatCellRef(c, r);
    if (allWon) delete sheet.formats[k];
    else sheet.formats[k] = 'won';
   }
  }
  changed();
  refreshDisplay();
  sheetWrap.focus({ preventScroll: true });
 });

 function applyTheme(themeName) {
  if (isLocked) return;
  const sheet = activeSheet();
  if (!sheet.themes) sheet.themes = {};
  pushUndo();
  const bounds = getSelectionBounds(sheet);
  const minCol = bounds.minCol;
  const maxCol = bounds.maxCol;
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
   for (let c = minCol; c <= maxCol; c++) {
    const k = formatCellRef(c, r);
    if (themeName) sheet.themes[k] = themeName;
    else delete sheet.themes[k];
   }
  }
  changed();
  refreshDisplay();
  sheetWrap.focus({ preventScroll: true });
 }

 for (const btn of document.querySelectorAll('.theme-swatch[data-theme]')) {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
 }
 $('#clearThemeBtn').addEventListener('click', () => applyTheme(''));

 $('#moveSheetLeftBtn').addEventListener('click', () => {
  if (isLocked) return;
  const idx = state.money.sheets.findIndex(s => s.id === state.money.activeSheetId);
  if (idx > 0) moveSheet(idx, idx - 1);
 });

 $('#moveSheetRightBtn').addEventListener('click', () => {
  if (isLocked) return;
  const idx = state.money.sheets.findIndex(s => s.id === state.money.activeSheetId);
  if (idx >= 0 && idx < state.money.sheets.length - 1) moveSheet(idx, idx + 1);
 });

 $('#addSheetBtn').addEventListener('click', () => {
  if (isLocked) return;
  pushUndo();
  const nextNum = state.money.sheets.length + 1;
  const sheet = defaultSheet(`Sheet ${nextNum}`);
  state.money.sheets.push(sheet);
  state.money.activeSheetId = sheet.id;
  selected = { col: 0, row: 0 };
  selectionEnd = { col: 0, row: 0 };
  changed();
  renderAll();
 });

 $('#renameSheetBtn').addEventListener('click', () => {
  if (isLocked) return;
  const sheet = activeSheet();
  const name = prompt('시트 제목을 입력하세요.', sheet.name);
  if (!name || !name.trim() || name.trim() === sheet.name) return;
  pushUndo();
  sheet.name = name.trim();
  changed();
  renderSheetTabs();
 });

 $('#delSheetBtn').addEventListener('click', () => {
  if (isLocked) return;
  if (state.money.sheets.length <= 1) return;
  const sheet = activeSheet();
  const hasData = Object.keys(sheet.cells).length > 0;
  if (hasData && !confirm(`"${sheet.name}" 시트를 삭제할까요?`)) return;
  pushUndo();
  state.money.sheets = state.money.sheets.filter(s => s.id !== sheet.id);
  state.money.activeSheetId = state.money.sheets[0].id;
  selected = { col: 0, row: 0 };
  selectionEnd = { col: 0, row: 0 };
  changed();
  renderAll();
 });

 window.vaultApi = {
  load(input) {
   state = normalize(input);
   isLocked = state.money.editLocked;
   undoStack.length = 0;
   redoStack.length = 0;
   selected = { col: 0, row: 0 };
   selectionEnd = { col: 0, row: 0 };
   renderAll();
   setEditLocked(isLocked, false);
  },
  serialize() {
   const snapshot = structuredClone(state);
   for (const sh of snapshot.money.sheets) {
    for (const [k, v] of Object.entries(sh.cells)) {
     if (v === '' || v == null) delete sh.cells[k];
    }
   }
   return snapshot;
  },
  saved(updatedAt) {
   state.updatedAt = updatedAt;
   showUpdatedAt();
  },
 };

 renderAll();
})();
