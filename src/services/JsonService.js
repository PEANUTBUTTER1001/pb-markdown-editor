const { parseTree, createScanner, SyntaxKind, printParseErrorCode, format, applyEdits } = require('jsonc-parser');
const OPTIONS = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };
const MAX_BYTES = 5 * 1024 * 1024, MAX_DEPTH = 120;
const ERROR_MESSAGES = { InvalidSymbol: '허용되지 않는 문자가 있습니다.', InvalidNumberFormat: '숫자 형식을 확인해 주세요.', PropertyNameExpected: '키 이름을 큰따옴표로 입력해 주세요. 마지막 쉼표도 확인해 주세요.', ValueExpected: '값이 필요합니다.', ColonExpected: '키와 값 사이에 콜론(:)이 필요합니다.', CommaExpected: '항목 사이에 쉼표(,)가 필요합니다.', CloseBraceExpected: '닫는 중괄호(})가 필요합니다.', CloseBracketExpected: '닫는 대괄호(])가 필요합니다.', EndOfFileExpected: '최상위 값 뒤에 불필요한 내용이 있습니다.', InvalidCommentToken: 'JSON에서는 주석을 사용할 수 없습니다.', UnexpectedEndOfComment: 'JSON에서는 주석을 사용할 수 없습니다.', UnexpectedEndOfString: '문자열의 닫는 큰따옴표가 필요합니다.', UnexpectedEndOfNumber: '숫자 형식을 확인해 주세요.', InvalidUnicode: '유니코드 이스케이프 형식을 확인해 주세요.', InvalidEscapeCharacter: '문자열 이스케이프 형식을 확인해 주세요.', InvalidCharacter: '문자열 안에 허용되지 않는 문자가 있습니다.' };
function location(text, offset) { const before = text.slice(0, offset), lines = before.split('\n'); return { line: lines.length, column: lines[lines.length - 1].length + 1 }; }
function analyze(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) return { limited: true, error: { message: '5 MiB를 초과하여 구조 분석을 중지했습니다. 원본 편집·저장은 가능합니다.', offset: 0 } };
  const scanner = createScanner(text, false); let level = 0, token;
  while ((token = scanner.scan()) !== SyntaxKind.EOF) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      if (++level > MAX_DEPTH) return { limited: true, error: { message: '중첩 120단계를 초과했습니다. 원본 편집·저장은 가능합니다.', offset: scanner.getTokenOffset() } };
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) level--;
  }
  const errors = [], ast = parseTree(text, errors, OPTIONS);
  if (errors.length || !ast) { const error = errors[0]; return { error: { message: error ? ERROR_MESSAGES[printParseErrorCode(error.error)] || 'JSON 문법을 확인해 주세요.' : 'JSON을 입력해 주세요.', offset: error ? error.offset : 0 } }; }
  const nodes = [], warnings = [];
  function wrap(raw, key, pointer, id, depth, parentId, keyStart = null) {
    const node = { id, key, path: pointer, type: raw.type, start: raw.offset, end: raw.offset + raw.length, keyStart, depth, parentId, children: [] };
    node.raw = text.slice(node.start, node.end); nodes.push(node);
    if (raw.type === 'object') {
      const seen = new Set();
      (raw.children || []).forEach((property, i) => {
        const keyNode = property.children[0], valueNode = property.children[1], name = keyNode.value;
        const child = wrap(valueNode, name, pointer + '/' + name.replace(/~/g, '~0').replace(/\//g, '~1'), id + '/' + i, depth + 1, id, keyNode.offset);
        child.duplicate = seen.has(name); if (child.duplicate) warnings.push({ offset: keyNode.offset, message: '중복 키: ' + name }); seen.add(name); node.children.push(child);
      });
    } else if (raw.type === 'array') (raw.children || []).forEach((child, i) => node.children.push(wrap(child, String(i), pointer + '/' + i, id + '/' + i, depth + 1, id)));
    return node;
  }
  return { root: wrap(ast, 'root', '', 'r', 0, null), nodes, warnings, text };
}
function formatSource(text) {
  const result = analyze(text); if (result.error) throw new Error(result.error.message);
  return applyEdits(text, format(text, undefined, { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' }));
}
function summary(node) { return node.type === 'object' ? node.children.length + '개 속성' : node.type === 'array' ? node.children.length + '개 항목' : node.raw; }
module.exports = { analyze, formatSource, location, summary, MAX_BYTES, MAX_DEPTH };
