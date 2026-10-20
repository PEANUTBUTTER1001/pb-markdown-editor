const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { analyze, formatSource, MAX_BYTES } = require('../src/services/JsonService');
const { EditorState } = require('@codemirror/state');
const { history, historyField, isolateHistory, undo, redo } = require('@codemirror/commands');

test('strict JSON accepts every root type and rejects comments, trailing commas and malformed tokens', () => {
  for (const input of ['{}', '[]', 'null', 'true', 'false', '1e20', '"한글"']) assert.ok(analyze(input).root, input);
  for (const input of ['', '{"a":1,}', '[1,]', '// hi\n{}', '{/* hi */}', '01', 'NaN', 'true false', '"\n"', '{"a":}']) assert.ok(analyze(input).error, input);
});
test('format changes only whitespace, preserves duplicate keys, numeric lexemes and escaped strings', () => {
  const input = '{"a":9007199254740993,"a":1.00e+20,"b":"\\u0061","c":-0}';
  const before = analyze(input), output = formatSource(input), after = analyze(output);
  assert.equal(before.warnings.length, 1); assert.equal(after.warnings.length, 1);
  assert.deepEqual(after.root.children.map(n => n.raw), before.root.children.map(n => n.raw));
  assert.ok(output.includes('\n  "a"')); assert.equal(after.root.children.length, 4);
  assert.equal(formatSource(output), output);
});
test('offsets and JSON Pointer are precise even for duplicate keys and escaped paths', () => {
  const input = '{"a/b~c":{"x":1,"x":2}}', result = analyze(input), children = result.root.children[0].children;
  assert.equal(children[0].path, '/a~1b~0c/x'); assert.equal(children[1].path, children[0].path);
  assert.notEqual(children[0].id, children[1].id);
  assert.equal(input.slice(children[1].start, children[1].end), '2');
});
test('analysis limits distinguish unsupported structures from syntax errors', () => {
  assert.ok(analyze('['.repeat(121) + ']'.repeat(121)).limited);
  assert.ok(analyze('"' + 'a'.repeat(MAX_BYTES) + '"').limited);
  assert.ok(analyze('['.repeat(120) + ']'.repeat(120)).root);
});
test('CodeMirror transfer preserves undo and redo history', () => {
  let state = EditorState.create({ doc: '{}', extensions: [history()] });
  state = state.update({ changes: { from: 1, insert: '"name":1' }, userEvent: 'input' }).state;
  const serialized = state.toJSON({ history: historyField });
  state = EditorState.fromJSON(serialized, { extensions: [history()] }, { history: historyField });
  const target = { get state() { return state; }, dispatch(tr) { state = tr.state; } };
  assert.ok(undo(target)); assert.equal(state.doc.toString(), '{}'); assert.ok(redo(target)); assert.equal(state.doc.toString(), '{"name":1}');
});
test('approximately 1 MiB / 20,000 nodes parses within the 1 second target on this machine', () => {
  const input = JSON.stringify(Array.from({ length: 20000 }, (_, i) => String(i).padEnd(48, 'x')));
  const started = performance.now(), result = analyze(input), elapsed = performance.now() - started;
  assert.equal(result.nodes.length, 20001); assert.ok(elapsed < 1000, elapsed + 'ms');
  console.log('JSON performance:', input.length, 'bytes,', result.nodes.length, 'nodes,', elapsed.toFixed(1), 'ms');
});
test('format is one isolated undo step and CRLF survives editor serialization', () => {
  const before = '{"x":1}', formatted = formatSource(before);
  let state = EditorState.create({ doc: '{}', extensions: [history()] });
  state = state.update({ changes: { from: 1, insert: '"x":1' }, userEvent: 'input' }).state;
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: formatted }, annotations: isolateHistory.of('full'), userEvent: 'input' }).state;
  const target = { get state() { return state; }, dispatch(tr) { state = tr.state; } };
  assert.ok(undo(target)); assert.equal(state.doc.toString(), before); assert.ok(undo(target)); assert.equal(state.doc.toString(), '{}');
  state = EditorState.create({ doc: '{\r\n  "x": 1\r\n}', extensions: [history(), EditorState.lineSeparator.of('\r\n')] });
  const data = state.toJSON({ history: historyField });
  state = EditorState.fromJSON(data, { extensions: [history(), EditorState.lineSeparator.of('\r\n')] }, { history: historyField });
  assert.equal(state.sliceDoc(), '{\r\n  "x": 1\r\n}');
});
