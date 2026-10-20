const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), EventEmitter = require('node:events');
function helper(output, code = 0) {
  let invocation;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/NativeDropTarget.js'), 'utf8'), {
    module, process: { platform: 'win32' }, setTimeout, clearTimeout,
    require(name) { assert.equal(name, 'child_process'); return { spawn(command, args, options) {
      invocation = { command, args, options }; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => {};
      queueMicrotask(() => { child.stdout.emit('data', output); child.emit('close', code); }); return child;
    } }; }
  });
  return { hitTest: module.exports.hitTest, invocation: () => invocation };
}
test('native hit test captures the release point and launches the helper hidden', async () => {
  const fixture = helper('{"handle":"1234","desktop":true,"x":100,"y":200}');
  const hit = await fixture.hitTest({ x: 100.1, y: 199.9 }); const invocation = fixture.invocation();
  assert.equal(hit.handle, '1234'); assert.ok(invocation.options.windowsHide);
  assert.ok(invocation.args[3].includes('$point.X = 100\n$point.Y = 200'));
  assert.ok(!invocation.args[3].includes('[void][PBHit]::GetCursorPos([ref]$point)'));
});
test('native helper failure fails closed instead of detaching to an unverified destination', async () => {
  assert.equal(await helper('not json').hitTest({ x: 0, y: 0 }), null);
  assert.equal(await helper('{}', 1).hitTest({ x: 0, y: 0 }), null);
});
