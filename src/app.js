(() => {
 const {
  indexToCol,
  formatCellRef,
  evaluateCell,
  deleteRow,
  deleteCol,
 } = window.VaultPure;

 const $ = sel => document.querySelector(sel);
 const newId = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
 const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
 const changed = () => parent.vaultHost?.changed();

 const THEME_NAMES = ['green', 'amber', 'blue', 'gray'];

 function defaultSheet(name = 'Money') {
  return {
   id: newId(),
   name,
   rows: 30,
   cols: 12,
   cells: {},
   themes: {},
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
      return {
       id: typeof sh?.id === 'string' && sh.id ? sh.id : newId(),
       name: typeof sh?.name === 'string' && sh.name.trim() ? sh.name.trim() : `Sheet ${i + 1}`,
       rows,
       cols,
       cells: sh?.cells && typeof sh.cells === 'object' ? { ...sh.cells } : {},
       themes,
       hiddenRows,
       hiddenCols,
       freezeFirstRow: Boolean(sh?.freezeFirstRow),
       negativeTheme: sh?.negativeTheme !== false,
      };
     })
   : [defaultSheet('Money')];
  const activeSheetId = sheets.some(sh => sh.id === rawMoney.activeSheetId) ? rawMoney.activeSheetId : sheets[0].id;
  s.money = { activeSheetId, sheets };
  return s;
 }

 let state = normalize({ schema: 1 });
 let selected = { col: 0, row: 0 };
 let editing = false;
 let committing = false;
 let activeEditor = null;
 let dragStart = null;
 let refSpan = null;

 const sheetWrap = $('#sheetWrap');
 const cellRefEl = $('#cellRef');
 const formulaInput = $('#formulaInput');
 const sheetTabsEl = $('#sheetTabs');
 const themeRowMode = $('#themeRowMode');

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
 }

 function showUpdatedAt() {
  const at = state.updatedAt ? new Date(state.updatedAt) : null;
  $('#updatedAt').textContent = at && !isNaN(at) ? '저장 ' + at.toLocaleString('ko-KR') : '';
 }

 function setCellValue(sheet, key, value) {
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
  clampSelection(sheet);
  const key = formatCellRef(selected.col, selected.row);
  cellRefEl.textContent = key;
  formulaInput.value = sheet.cells[key] ?? '';
 }

 function updateToolbarState(sheet) {
  const hiddenCount = (sheet.hiddenRows?.length || 0) + (sheet.hiddenCols?.length || 0);
  const unhideBtn = $('#unhideAllBtn');
  unhideBtn.disabled = hiddenCount === 0;
  unhideBtn.textContent = hiddenCount ? `숨김 해제 (${hiddenCount})` : '숨김 해제';
  $('#freezeRowBtn').setAttribute('aria-pressed', String(Boolean(sheet.freezeFirstRow)));
  $('#negThemeBtn').setAttribute('aria-pressed', String(sheet.negativeTheme !== false));
 }

 function cellElement(col, row) {
  return sheetWrap.querySelector(`td[data-col="${col}"][data-row="${row}"]`);
 }

 function refreshDisplay() {
  const sheet = activeSheet();
  for (const td of sheetWrap.querySelectorAll('td[data-key]')) {
   const key = td.dataset.key;
   const col = Number(td.dataset.col);
   const row = Number(td.dataset.row);
   const isSelected = col === selected.col && row === selected.row;
   td.classList.toggle('is-selected', isSelected);
   for (const t of THEME_NAMES) td.classList.remove(`theme-${t}`);
   const cellTheme = sheet.themes?.[key];
   if (cellTheme) td.classList.add(`theme-${cellTheme}`);
   if (editing && isSelected) {
    td.classList.remove('is-negative');
    continue;
   }
   const res = evaluateCell(key, sheet.cells);
   td.textContent = res.display;
   td.classList.toggle('is-number', res.isNumber);
   td.classList.toggle('is-error', Boolean(res.error));
   td.classList.toggle('is-negative', sheet.negativeTheme !== false && res.isNumber && res.numeric < 0);
   td.title = sheet.cells[key]?.startsWith('=') ? `${sheet.cells[key]} → ${res.display}` : '';
  }
  for (const th of sheetWrap.querySelectorAll('thead th[data-col]')) {
   th.classList.toggle('is-active-header', Number(th.dataset.col) === selected.col);
  }
  for (const th of sheetWrap.querySelectorAll('tbody th[data-row]')) {
   th.classList.toggle('is-active-header', Number(th.dataset.row) === selected.row);
  }
  updateFormulaBar();
  updateToolbarState(sheet);
 }

 function selectCell(col, row, scrollIntoView = true) {
  const sheet = activeSheet();
  selected = {
   col: nearestVisible(Math.max(0, Math.min(sheet.cols - 1, col)), sheet.cols, sheet.hiddenCols),
   row: nearestVisible(Math.max(0, Math.min(sheet.rows - 1, row)), sheet.rows, sheet.hiddenRows),
  };
  refreshDisplay();
  if (scrollIntoView) {
   cellElement(selected.col, selected.row)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
 }

 function startEdit(initialText = null) {
  if (editing) return;
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
   if (commit) setCellValue(sheet, key, input.value);
   input.remove();
   refreshDisplay();
   committing = false;
   if (move) moveSelection(move.dc, move.dr);
   sheetWrap.focus({ preventScroll: true });
  };

  input.addEventListener('input', () => {
   refSpan = null;
   formulaInput.value = input.value;
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
 }

 function moveSelection(dc, dr) {
  const sheet = activeSheet();
  const cols = visibleIndices(sheet.cols, sheet.hiddenCols);
  const rows = visibleIndices(sheet.rows, sheet.hiddenRows);
  const ci = Math.max(0, cols.indexOf(selected.col));
  const ri = Math.max(0, rows.indexOf(selected.row));
  const nextCol = cols[Math.max(0, Math.min(cols.length - 1, ci + dc))] ?? selected.col;
  const nextRow = rows[Math.max(0, Math.min(rows.length - 1, ri + dr))] ?? selected.row;
  selectCell(nextCol, nextRow);
 }

 function renderGrid() {
  const sheet = activeSheet();
  clampSelection(sheet);
  editing = false;

  const visCols = visibleIndices(sheet.cols, sheet.hiddenCols);
  const visRows = visibleIndices(sheet.rows, sheet.hiddenRows);

  const table = el('table', { className: 'sheet-table' });
  if (sheet.freezeFirstRow) table.classList.add('is-frozen-first');

  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', { className: 'corner-cell', textContent: '' }));
  for (const c of visCols) {
   const th = el('th', { textContent: indexToCol(c) });
   th.dataset.col = String(c);
   th.addEventListener('click', () => {
    selectCell(c, visRows[0] ?? 0);
    sheetWrap.focus({ preventScroll: true });
   });
   headRow.append(th);
  }
  thead.append(headRow);

  const tbody = el('tbody');
  for (const r of visRows) {
   const tr = el('tr');
   const rowTh = el('th', { textContent: String(r + 1) });
   rowTh.dataset.row = String(r);
   rowTh.addEventListener('click', () => {
    selectCell(visCols[0] ?? 0, r);
    sheetWrap.focus({ preventScroll: true });
   });
   tr.append(rowTh);

   for (const c of visCols) {
    const key = formatCellRef(c, r);
    const td = el('td');
    td.dataset.col = String(c);
    td.dataset.row = String(r);
    td.dataset.key = key;
    td.addEventListener('mousedown', e => {
     if (e.button !== 0) return;
     const editor = getFormulaEditor();
     if (!editor) return;
     e.preventDefault();
     dragStart = { col: c, row: r };
     applyPointedRef(editor, dragStart, dragStart);
    });
    td.addEventListener('click', () => {
     if (editing || getFormulaEditor()) return;
     if (selected.col === c && selected.row === r) {
      startEdit();
     } else {
      selectCell(c, r, false);
      sheetWrap.focus({ preventScroll: true });
     }
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

 function renderSheetTabs() {
  sheetTabsEl.textContent = '';
  for (const sheet of state.money.sheets) {
   const btn = el('button', {
    type: 'button',
    className: 'sheet-tab',
    textContent: sheet.name,
   });
   btn.setAttribute('role', 'tab');
   const active = sheet.id === state.money.activeSheetId;
   btn.setAttribute('aria-selected', String(active));
   btn.addEventListener('click', () => {
    if (state.money.activeSheetId === sheet.id) return;
    state.money.activeSheetId = sheet.id;
    selected = { col: 0, row: 0 };
    changed();
    renderSheetTabs();
    renderGrid();
   });
   sheetTabsEl.append(btn);
  }
  $('#delSheetBtn').disabled = state.money.sheets.length <= 1;
 }

 function renderAll() {
  renderSheetTabs();
  renderGrid();
  showUpdatedAt();
 }

 // 키보드 탐색 · 직접 입력 · 삭제 · 복사
 sheetWrap.addEventListener('keydown', e => {
  if (editing || document.activeElement === formulaInput) return;
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);

  if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(0, -1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(0, 1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelection(-1, 0); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(1, 0); return; }
  if (e.key === 'Tab') { e.preventDefault(); moveSelection(e.shiftKey ? -1 : 1, 0); return; }
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') {
   e.preventDefault();
   if (setCellValue(sheet, key, '')) refreshDisplay();
   return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
   const val = sheet.cells[key] ?? '';
   navigator.clipboard?.writeText(val).catch(() => {});
   return;
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
   e.preventDefault();
   startEdit(e.key);
  }
 });

 // 엑셀·구글시트에서 복사한 탭/줄바꿈 데이터 붙여넣기
 sheetWrap.addEventListener('paste', e => {
  if (editing || document.activeElement === formulaInput) return;
  const text = e.clipboardData?.getData('text/plain');
  if (text == null) return;
  e.preventDefault();
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

 // 수식 입력 중 셀·드래그 범위 선택
 sheetWrap.addEventListener('mousemove', e => {
  if (!dragStart) return;
  const editor = getFormulaEditor();
  if (!editor) { dragStart = null; return; }
  const td = e.target.closest('td[data-col]');
  if (!td) return;
  applyPointedRef(editor, dragStart, { col: Number(td.dataset.col), row: Number(td.dataset.row) });
 });

 window.addEventListener('mouseup', () => {
  dragStart = null;
 });

 // 수식 입력줄
 formulaInput.addEventListener('input', () => {
  refSpan = null;
 });

 formulaInput.addEventListener('keydown', e => {
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);
  if (e.key === 'Enter') {
   e.preventDefault();
   refSpan = null;
   dragStart = null;
   clearRefHighlight();
   setCellValue(sheet, key, formulaInput.value);
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
  refSpan = null;
  dragStart = null;
  clearRefHighlight();
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);
  if (setCellValue(sheet, key, formulaInput.value)) refreshDisplay();
 });

 // 툴바 버튼
 $('#addRowBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  sheet.rows += 1;
  changed();
  renderGrid();
  selectCell(selected.col, sheet.rows - 1);
 });

 $('#addColBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  sheet.cols += 1;
  changed();
  renderGrid();
  selectCell(sheet.cols - 1, selected.row);
 });

 $('#delRowBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  if (sheet.rows <= 1) return;
  sheet.cells = deleteRow(sheet.cells, selected.row);
  sheet.themes = deleteRow(sheet.themes, selected.row);
  sheet.hiddenRows = sheet.hiddenRows.filter(r => r !== selected.row).map(r => (r > selected.row ? r - 1 : r));
  sheet.rows -= 1;
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#delColBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  if (sheet.cols <= 1) return;
  sheet.cells = deleteCol(sheet.cells, selected.col);
  sheet.themes = deleteCol(sheet.themes, selected.col);
  sheet.hiddenCols = sheet.hiddenCols.filter(c => c !== selected.col).map(c => (c > selected.col ? c - 1 : c));
  sheet.cols -= 1;
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#hideRowBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  const vis = visibleIndices(sheet.rows, sheet.hiddenRows);
  if (vis.length <= 1) return;
  if (!sheet.hiddenRows.includes(selected.row)) {
   sheet.hiddenRows.push(selected.row);
   clampSelection(sheet);
   changed();
   renderGrid();
  }
 });

 $('#hideColBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  const vis = visibleIndices(sheet.cols, sheet.hiddenCols);
  if (vis.length <= 1) return;
  if (!sheet.hiddenCols.includes(selected.col)) {
   sheet.hiddenCols.push(selected.col);
   clampSelection(sheet);
   changed();
   renderGrid();
  }
 });

 $('#unhideAllBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  if (!sheet.hiddenRows.length && !sheet.hiddenCols.length) return;
  sheet.hiddenRows = [];
  sheet.hiddenCols = [];
  changed();
  renderGrid();
 });

 $('#freezeRowBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  sheet.freezeFirstRow = !sheet.freezeFirstRow;
  changed();
  renderGrid();
 });

 $('#negThemeBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  sheet.negativeTheme = sheet.negativeTheme === false;
  changed();
  refreshDisplay();
 });

 function applyTheme(themeName) {
  const sheet = activeSheet();
  if (!sheet.themes) sheet.themes = {};
  if (themeRowMode.checked) {
   for (let c = 0; c < sheet.cols; c++) {
    const k = formatCellRef(c, selected.row);
    if (themeName) sheet.themes[k] = themeName;
    else delete sheet.themes[k];
   }
  } else {
   const k = formatCellRef(selected.col, selected.row);
   if (themeName) sheet.themes[k] = themeName;
   else delete sheet.themes[k];
  }
  changed();
  refreshDisplay();
  sheetWrap.focus({ preventScroll: true });
 }

 for (const btn of document.querySelectorAll('.theme-swatch[data-theme]')) {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
 }
 $('#clearThemeBtn').addEventListener('click', () => applyTheme(''));

 $('#clearCellBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);
  if (setCellValue(sheet, key, '')) refreshDisplay();
  sheetWrap.focus({ preventScroll: true });
 });

 $('#addSheetBtn').addEventListener('click', () => {
  const nextNum = state.money.sheets.length + 1;
  const sheet = defaultSheet(`Sheet ${nextNum}`);
  state.money.sheets.push(sheet);
  state.money.activeSheetId = sheet.id;
  selected = { col: 0, row: 0 };
  changed();
  renderAll();
 });

 $('#renameSheetBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  const name = prompt('시트 이름을 입력하세요.', sheet.name);
  if (!name || !name.trim() || name.trim() === sheet.name) return;
  sheet.name = name.trim();
  changed();
  renderSheetTabs();
 });

 $('#delSheetBtn').addEventListener('click', () => {
  if (state.money.sheets.length <= 1) return;
  const sheet = activeSheet();
  const hasData = Object.keys(sheet.cells).length > 0;
  if (hasData && !confirm(`"${sheet.name}" 시트를 삭제할까요?`)) return;
  state.money.sheets = state.money.sheets.filter(s => s.id !== sheet.id);
  state.money.activeSheetId = state.money.sheets[0].id;
  selected = { col: 0, row: 0 };
  changed();
  renderAll();
 });

 window.vaultApi = {
  load(input) {
   state = normalize(input);
   selected = { col: 0, row: 0 };
   renderAll();
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
