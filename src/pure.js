// 순수 시트·수식 계산 모듈. Node 단위 테스트에서도 그대로 불러와 실행할 수 있다.
(function (root) {
 function indexToCol(index) {
  let n = index;
  let col = '';
  while (n >= 0) {
   col = String.fromCharCode(65 + (n % 26)) + col;
   n = Math.floor(n / 26) - 1;
  }
  return col;
 }

 function colToIndex(col) {
  const upper = String(col).toUpperCase();
  let n = 0;
  for (let i = 0; i < upper.length; i++) {
   const code = upper.charCodeAt(i);
   if (code < 65 || code > 90) return -1;
   n = n * 26 + (code - 64);
  }
  return n - 1;
 }

 function parseCellRef(ref) {
  const m = /^([A-Za-z]+)([1-9]\d*)$/.exec(String(ref ?? '').trim());
  if (!m) return null;
  const col = colToIndex(m[1]);
  const row = Number(m[2]) - 1;
  if (col < 0 || row < 0) return null;
  return { col, row, key: m[1].toUpperCase() + m[2] };
 }

 function formatCellRef(col, row) {
  return indexToCol(col) + (row + 1);
 }

 function expandRange(startRef, endRef) {
  const a = parseCellRef(startRef);
  const b = parseCellRef(endRef);
  if (!a || !b) return null;
  const minCol = Math.min(a.col, b.col), maxCol = Math.max(a.col, b.col);
  const minRow = Math.min(a.row, b.row), maxRow = Math.max(a.row, b.row);
  if ((maxCol - minCol + 1) * (maxRow - minRow + 1) > 10000) return null;
  const keys = [];
  for (let r = minRow; r <= maxRow; r++) {
   for (let c = minCol; c <= maxCol; c++) {
    keys.push(formatCellRef(c, r));
   }
  }
  return keys;
 }

 function parseNumericLiteral(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const m = /^(?:([+-]?)\s*₩\s*([+-]?)|([+-]?))((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const sign = m[1] || m[2] || m[3] || '';
  if (m[1] && m[2]) return null;
  const n = Number(sign + m[4].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
 }

 function formatNumber(n, maximumFractionDigits = 6) {
  if (!Number.isFinite(n)) return '#ERROR!';
  const cleaned = Math.abs(n) < 1e-12 ? 0 : Math.round(n * 1e10) / 1e10;
  const value = maximumFractionDigits === 0 && Math.abs(cleaned) < 0.5 ? 0 : cleaned;
  return value.toLocaleString('en-US', { maximumFractionDigits });
 }

 function formatWon(n, maximumFractionDigits = 6) {
  if (!Number.isFinite(n)) return '#ERROR!';
  const cleaned = Math.abs(n) < 1e-12 ? 0 : Math.round(n * 1e10) / 1e10;
  const value = maximumFractionDigits === 0 && Math.abs(cleaned) < 0.5 ? 0 : cleaned;
  const absText = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits });
  return value < 0 ? `-₩ ${absText}` : `₩ ${absText}`;
 }

 class FormulaError extends Error {
  constructor(code) {
   super(code);
   this.code = code;
  }
 }

 function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
   const ch = expr[i];
   if (/\s/.test(ch)) { i++; continue; }
   if ('+-*/():,'.includes(ch)) {
    tokens.push({ type: ch, value: ch });
    i++;
    continue;
   }
   if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] ?? ''))) {
    let j = i;
    while (j < expr.length && /[\d.]/.test(expr[j])) j++;
    const numStr = expr.slice(i, j);
    if ((numStr.match(/\./g) || []).length > 1) throw new FormulaError('#ERROR!');
    tokens.push({ type: 'NUM', value: Number(numStr) });
    i = j;
    continue;
   }
   if (/[A-Za-z]/.test(ch)) {
    let j = i;
    while (j < expr.length && /[A-Za-z0-9]/.test(expr[j])) j++;
    const word = expr.slice(i, j);
    if (expr[j] === '(') {
     tokens.push({ type: 'FUNC', value: word.toUpperCase() });
    } else if (/^[A-Za-z]+[1-9]\d*$/.test(word)) {
     tokens.push({ type: 'REF', value: word.toUpperCase() });
    } else {
     throw new FormulaError('#NAME?');
    }
    i = j;
    continue;
   }
   throw new FormulaError('#ERROR!');
  }
  return tokens;
 }

 function formulaReferences(formula) {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return [];
  let tokens;
  try { tokens = tokenize(formula.slice(1)); }
  catch { return []; }
  const references = [];
  for (let i = 0; i < tokens.length; i++) {
   if (tokens[i].type !== 'REF') continue;
   const start = parseCellRef(tokens[i].value);
   let end = start;
   if (tokens[i + 1]?.type === ':' && tokens[i + 2]?.type === 'REF') {
    end = parseCellRef(tokens[i + 2].value);
    i += 2;
   }
   references.push({
    minCol: Math.min(start.col, end.col), maxCol: Math.max(start.col, end.col),
    minRow: Math.min(start.row, end.row), maxRow: Math.max(start.row, end.row),
   });
  }
  return references;
 }

 function evaluateCell(key, cells, visiting = new Set()) {
  const raw = cells?.[key];
  if (raw === undefined || raw === null || raw === '') {
   return { display: '', numeric: 0, isNumber: false, isEmpty: true, error: null };
  }
  const str = String(raw);
  if (!str.startsWith('=')) {
   const num = parseNumericLiteral(str);
   if (num !== null) {
    return { display: formatNumber(num), numeric: num, isNumber: true, isEmpty: false, error: null };
   }
   return { display: str, numeric: null, isNumber: false, isEmpty: false, error: null };
  }

  if (visiting.has(key)) {
   return { display: '#CIRC!', numeric: null, isNumber: false, isEmpty: false, error: '#CIRC!' };
  }

  visiting.add(key);
  try {
   const expr = str.slice(1).trim();
   if (!expr) throw new FormulaError('#ERROR!');
   const tokens = tokenize(expr);
   let pos = 0;
   const peek = () => tokens[pos] ?? null;
   const consume = type => {
    const t = tokens[pos];
    if (!t || (type && t.type !== type)) throw new FormulaError('#ERROR!');
    pos++;
    return t;
   };

   const resolveRefNumber = refKey => {
    const res = evaluateCell(refKey, cells, visiting);
    if (res.error) throw new FormulaError(res.error);
    if (res.isEmpty) return 0;
    if (!res.isNumber) throw new FormulaError('#VALUE!');
    return res.numeric;
   };

   const parseExpr = () => {
    let left = parseTerm();
    while (peek()?.type === '+' || peek()?.type === '-') {
     const op = consume().type;
     const right = parseTerm();
     left = op === '+' ? left + right : left - right;
    }
    return left;
   };

   const parseTerm = () => {
    let left = parseFactor();
    while (peek()?.type === '*' || peek()?.type === '/') {
     const op = consume().type;
     const right = parseFactor();
     if (op === '/') {
      if (right === 0) throw new FormulaError('#DIV/0!');
      left = left / right;
     } else {
      left = left * right;
     }
    }
    return left;
   };

   const parseFuncArgs = () => {
    const values = [];
    if (peek()?.type === ')') return values;
    while (true) {
     if (peek()?.type === 'REF' && tokens[pos + 1]?.type === ':' && tokens[pos + 2]?.type === 'REF') {
      const start = consume('REF').value;
      consume(':');
      const end = consume('REF').value;
      const keys = expandRange(start, end);
      if (!keys) throw new FormulaError('#REF!');
      for (const k of keys) {
       const res = evaluateCell(k, cells, visiting);
       if (res.error) throw new FormulaError(res.error);
       if (res.isNumber) values.push(res.numeric);
       else if (!res.isEmpty) throw new FormulaError('#VALUE!');
      }
     } else {
      values.push(parseExpr());
     }
     if (peek()?.type === ',') { consume(','); continue; }
     break;
    }
    return values;
   };

   const parseFactor = () => {
    const t = peek();
    if (!t) throw new FormulaError('#ERROR!');
    if (t.type === '+') { consume(); return parseFactor(); }
    if (t.type === '-') { consume(); return -parseFactor(); }
    if (t.type === 'NUM') { consume(); return t.value; }
    if (t.type === 'REF') { consume(); return resolveRefNumber(t.value); }
    if (t.type === 'FUNC') {
     const name = consume('FUNC').value;
     consume('(');
     const args = parseFuncArgs();
     consume(')');
     if (name === 'SUM') return args.reduce((acc, v) => acc + v, 0);
     if (name === 'AVG' || name === 'AVERAGE') {
      if (args.length === 0) throw new FormulaError('#DIV/0!');
      return args.reduce((acc, v) => acc + v, 0) / args.length;
     }
     throw new FormulaError('#NAME?');
    }
    if (t.type === '(') {
     consume('(');
     const val = parseExpr();
     consume(')');
     return val;
    }
    throw new FormulaError('#ERROR!');
   };

   const result = parseExpr();
   if (pos !== tokens.length || !Number.isFinite(result)) throw new FormulaError('#ERROR!');
   return { display: formatNumber(result), numeric: result, isNumber: true, isEmpty: false, error: null };
  } catch (err) {
   const code = err instanceof FormulaError ? err.code : '#ERROR!';
   return { display: code, numeric: null, isNumber: false, isEmpty: false, error: code };
  } finally {
   visiting.delete(key);
  }
 }

 function rewriteFormula(formula, transformRef) {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula;
  return '=' + formula.slice(1).replace(/\b([A-Za-z]+)([1-9]\d*)\b(?!\s*\()/g, (match, colStr, rowStr) => {
   const parsed = parseCellRef(match);
   if (!parsed) return match;
   const next = transformRef(parsed.col, parsed.row);
   if (!next) return '#REF!';
   return formatCellRef(next.col, next.row);
  });
 }

 function insertRow(cells, atRow) {
  const next = {};
  for (const [key, val] of Object.entries(cells || {})) {
   const ref = parseCellRef(key);
   if (!ref) continue;
   const targetRow = ref.row >= atRow ? ref.row + 1 : ref.row;
   next[formatCellRef(ref.col, targetRow)] = rewriteFormula(val, (c, r) => ({ col: c, row: r >= atRow ? r + 1 : r }));
  }
  return next;
 }

 function deleteRow(cells, atRow) {
  const next = {};
  for (const [key, val] of Object.entries(cells || {})) {
   const ref = parseCellRef(key);
   if (!ref || ref.row === atRow) continue;
   const targetRow = ref.row > atRow ? ref.row - 1 : ref.row;
   next[formatCellRef(ref.col, targetRow)] = rewriteFormula(val, (c, r) => {
    if (r === atRow) return null;
    return { col: c, row: r > atRow ? r - 1 : r };
   });
  }
  return next;
 }

 function insertCol(cells, atCol) {
  const next = {};
  for (const [key, val] of Object.entries(cells || {})) {
   const ref = parseCellRef(key);
   if (!ref) continue;
   const targetCol = ref.col >= atCol ? ref.col + 1 : ref.col;
   next[formatCellRef(targetCol, ref.row)] = rewriteFormula(val, (c, r) => ({ col: c >= atCol ? c + 1 : c, row: r }));
  }
  return next;
 }

 function deleteCol(cells, atCol) {
  const next = {};
  for (const [key, val] of Object.entries(cells || {})) {
   const ref = parseCellRef(key);
   if (!ref || ref.col === atCol) continue;
   const targetCol = ref.col > atCol ? ref.col - 1 : ref.col;
   next[formatCellRef(targetCol, ref.row)] = rewriteFormula(val, (c, r) => {
    if (c === atCol) return null;
    return { col: c > atCol ? c - 1 : c, row: r };
   });
  }
  return next;
 }

 root.VaultPure = {
  indexToCol,
  colToIndex,
  parseCellRef,
  formatCellRef,
  expandRange,
  parseNumericLiteral,
  formatNumber,
  formatWon,
  evaluateCell,
  formulaReferences,
  insertRow,
  deleteRow,
  insertCol,
  deleteCol,
 };
})(typeof window !== 'undefined' ? window : globalThis);
