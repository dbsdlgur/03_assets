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

 function defaultSheet(name = 'Money') {
  return { id: newId(), name, rows: 30, cols: 12, cells: {} };
 }

 // 기존 금고의 다른 필드(비밀번호·이력 등)는 손대지 않고 그대로 보존한다.
 function normalize(input) {
  const s = structuredClone(input && typeof input === 'object' ? input : { schema: 1 });
  const rawMoney = s.money && typeof s.money === 'object' ? s.money : {};
  const sheets = Array.isArray(rawMoney.sheets) && rawMoney.sheets.length
   ? rawMoney.sheets.map((sh, i) => ({
      id: typeof sh?.id === 'string' && sh.id ? sh.id : newId(),
      name: typeof sh?.name === 'string' && sh.name.trim() ? sh.name.trim() : `Sheet ${i + 1}`,
      rows: Number.isInteger(sh?.rows) && sh.rows >= 1 ? sh.rows : 30,
      cols: Number.isInteger(sh?.cols) && sh.cols >= 1 ? sh.cols : 12,
      cells: sh?.cells && typeof sh.cells === 'object' ? { ...sh.cells } : {},
     }))
   : [defaultSheet('Money')];
  const activeSheetId = sheets.some(sh => sh.id === rawMoney.activeSheetId) ? rawMoney.activeSheetId : sheets[0].id;
  s.money = { activeSheetId, sheets };
  return s;
 }

 let state = normalize({ schema: 1 });
 let selected = { col: 0, row: 0 };
 let editing = false;
 let committing = false;

 const sheetWrap = $('#sheetWrap');
 const cellRefEl = $('#cellRef');
 const formulaInput = $('#formulaInput');
 const sheetTabsEl = $('#sheetTabs');

 const activeSheet = () => state.money.sheets.find(s => s.id === state.money.activeSheetId) || state.money.sheets[0];

 function clampSelection(sheet) {
  selected.col = Math.max(0, Math.min(sheet.cols - 1, selected.col));
  selected.row = Math.max(0, Math.min(sheet.rows - 1, selected.row));
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
   if (editing && isSelected) continue;
   const res = evaluateCell(key, sheet.cells);
   td.textContent = res.display;
   td.classList.toggle('is-number', res.isNumber);
   td.classList.toggle('is-error', Boolean(res.error));
   td.title = sheet.cells[key]?.startsWith('=') ? `${sheet.cells[key]} → ${res.display}` : '';
  }
  for (const th of sheetWrap.querySelectorAll('thead th[data-col]')) {
   th.classList.toggle('is-active-header', Number(th.dataset.col) === selected.col);
  }
  for (const th of sheetWrap.querySelectorAll('tbody th[data-row]')) {
   th.classList.toggle('is-active-header', Number(th.dataset.row) === selected.row);
  }
  updateFormulaBar();
 }

 function selectCell(col, row, scrollIntoView = true) {
  const sheet = activeSheet();
  selected = {
   col: Math.max(0, Math.min(sheet.cols - 1, col)),
   row: Math.max(0, Math.min(sheet.rows - 1, row)),
  };
  refreshDisplay();
  if (scrollIntoView) {
   cellElement(selected.col, selected.row)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
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
  td.classList.add('is-editing');
  td.textContent = '';

  const input = el('input', {
   type: 'text',
   className: 'cell-editor',
   autocomplete: 'off',
   spellcheck: false,
   value: initialText !== null ? initialText : original,
  });

  const finish = (commit, move = null) => {
   if (committing || !editing) return;
   committing = true;
   editing = false;
   td.classList.remove('is-editing');
   if (commit) setCellValue(sheet, key, input.value);
   input.remove();
   refreshDisplay();
   committing = false;
   if (move) selectCell(selected.col + move.dc, selected.row + move.dr);
   sheetWrap.focus({ preventScroll: true });
  };

  input.addEventListener('input', () => {
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

 function renderGrid() {
  const sheet = activeSheet();
  clampSelection(sheet);
  editing = false;

  const table = el('table', { className: 'sheet-table' });
  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', { className: 'corner-cell', textContent: '' }));
  for (let c = 0; c < sheet.cols; c++) {
   const th = el('th', { textContent: indexToCol(c) });
   th.dataset.col = String(c);
   th.addEventListener('click', () => {
    selectCell(c, 0);
    sheetWrap.focus({ preventScroll: true });
   });
   headRow.append(th);
  }
  thead.append(headRow);

  const tbody = el('tbody');
  for (let r = 0; r < sheet.rows; r++) {
   const tr = el('tr');
   const rowTh = el('th', { textContent: String(r + 1) });
   rowTh.dataset.row = String(r);
   rowTh.addEventListener('click', () => {
    selectCell(0, r);
    sheetWrap.focus({ preventScroll: true });
   });
   tr.append(rowTh);

   for (let c = 0; c < sheet.cols; c++) {
    const key = formatCellRef(c, r);
    const td = el('td');
    td.dataset.col = String(c);
    td.dataset.row = String(r);
    td.dataset.key = key;
    td.addEventListener('click', () => {
     if (editing) return;
     if (selected.col === c && selected.row === r) {
      startEdit();
     } else {
      selectCell(c, r, false);
      sheetWrap.focus({ preventScroll: true });
     }
    });
    td.addEventListener('dblclick', () => {
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

  if (e.key === 'ArrowUp') { e.preventDefault(); selectCell(selected.col, selected.row - 1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); selectCell(selected.col, selected.row + 1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); selectCell(selected.col - 1, selected.row); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); selectCell(selected.col + 1, selected.row); return; }
  if (e.key === 'Tab') { e.preventDefault(); selectCell(selected.col + (e.shiftKey ? -1 : 1), selected.row); return; }
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

 // 수식 입력줄
 formulaInput.addEventListener('keydown', e => {
  const sheet = activeSheet();
  const key = formatCellRef(selected.col, selected.row);
  if (e.key === 'Enter') {
   e.preventDefault();
   setCellValue(sheet, key, formulaInput.value);
   refreshDisplay();
   selectCell(selected.col, selected.row + 1);
   sheetWrap.focus({ preventScroll: true });
  } else if (e.key === 'Escape') {
   e.preventDefault();
   updateFormulaBar();
   sheetWrap.focus({ preventScroll: true });
  }
 });

 formulaInput.addEventListener('blur', () => {
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
  sheet.rows -= 1;
  clampSelection(sheet);
  changed();
  renderGrid();
 });

 $('#delColBtn').addEventListener('click', () => {
  const sheet = activeSheet();
  if (sheet.cols <= 1) return;
  sheet.cells = deleteCol(sheet.cells, selected.col);
  sheet.cols -= 1;
  clampSelection(sheet);
  changed();
  renderGrid();
 });

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
