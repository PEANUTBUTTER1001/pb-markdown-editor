const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { DocumentStore } = require('../src/main/DocumentStore');

async function fixture() {
  const handlers = new Map(), ipcMain = new EventEmitter(); ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const app = new EventEmitter(); app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.quit = () => {};
  const instances = [], replies = [], writes = [], disk = new Map(); let messageResponse = 2, savePath = 'C:/test/result.json', writeGate = null;
  class Window extends EventEmitter {
    constructor() { super(); this.id = instances.length + 1; this.destroyed = false; this.label = ''; this.docStates = new Map(); instances.push(this);
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel, data) => {
        replies.push({ windowId: this.id, channel, data });
        if (channel === 'window:request') queueMicrotask(() => {
          try {
            let value = true;
            if (data.action === 'export') { if (this.exportFailure) throw new Error('ExportFailed'); value = this.docStates.get(data.payload.id); }
            if (data.action === 'import') { if (this.importFailure) throw new Error('ImportFailed'); this.docStates.set(data.payload.document.id, data.payload.document.snapshot); }
            ipcMain.emit('window:response', event(this), { requestId: data.requestId, value });
          } catch (error) { ipcMain.emit('window:response', event(this), { requestId: data.requestId, error: error.message }); }
        });
      };
    }
    loadFile() { queueMicrotask(() => ipcMain.emit('renderer:ready', event(this))); }
    isDestroyed() { return this.destroyed; } setTitle(value) { this.label = value; } getTitle() { return this.label; }
    setBounds() {} getBounds() { return { x: 0, y: 0, width: 1000, height: 700 }; } restore() {} focus() {} show() {}
    close() { const e = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', e); if (!e.prevented) { this.destroyed = true; this.emit('closed'); } }
    static fromWebContents(sender) { return instances.find(w => w.webContents === sender); }
    static getFocusedWindow() { return instances[0]; }
  }
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  const mockFs = { existsSync: () => true, watch: () => { const watcher = new EventEmitter(); watcher.close = () => {}; return watcher; },
    promises: { readFile: async p => { if (!disk.has(p)) throw new Error('ENOENT'); return disk.get(p); }, writeFile: async (p, text) => { writes.push({ p, text }); if (writeGate) await writeGate; disk.set(p, text); } } };
  const dialog = { showSaveDialog: async () => ({ canceled: !savePath, filePath: savePath }), showMessageBox: async () => ({ response: messageResponse }) };
  const screen = new EventEmitter(); screen.getDisplayNearestPoint = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
  const code = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8') + '\nmodule.exports = { store, windows, move, save, closeWindow, watchers, openFile };';
  const module = { exports: {} };
  const sandbox = { require(name) { if (name === 'electron') return { app, BrowserWindow: Window, ipcMain, dialog, screen }; if (name === 'fs') return mockFs; if (name.startsWith('./src/')) return require(path.join(__dirname, '..', name)); return require(name); }, module, __dirname: path.join(__dirname, '..'), process: { platform: 'win32', argv: ['app.exe'] }, console, setTimeout, clearTimeout };
  vm.runInNewContext(code, sandbox); await new Promise(resolve => setImmediate(resolve));
  return { ...module.exports, instances, replies, writes, disk, call: (win, name, data) => handlers.get(name)(event(win), data), setResponse: value => { messageResponse = value; }, setSavePath: value => { savePath = value; }, gate: value => { writeGate = value; } };
}
function snapshot(text) { return { content: text, editor: { history: { done: ['edit'] } }, expanded: ['r', 'r/0'], selected: 'r/0', query: 'name', layout: { theme: 'dark' } }; }
test('document ownership rejects wrong-window requests and malformed state', () => {
  const store = new DocumentStore(), doc = store.create(1, 'json'); assert.throws(() => store.sync(2, doc.id, snapshot('a')), /DocumentNotOwned/); assert.throws(() => store.sync(1, doc.id, {}), /InvalidDocumentState/);
});
test('save captures requested content and leaves later edits dirty; rejects duplicate target', async () => {
  const f = await fixture(), win = f.instances[0], doc = f.store.create(win.id, 'json', '{"old":1}');
  let finish; f.gate(new Promise(resolve => { finish = resolve; }));
  const saving = f.save(f.windows.get(win.id), doc, doc.content); await new Promise(resolve => setImmediate(resolve));
  f.store.sync(win.id, doc.id, snapshot('{"new":2}')); finish(); await saving;
  assert.equal(f.writes[0].text, '{"old":1}'); assert.equal(doc.saved, '{"old":1}'); assert.ok(f.store.dirty(doc));
  const second = f.store.create(win.id, 'json', '{}'); await assert.rejects(f.save(f.windows.get(win.id), second, '{}'), /다른 탭/);
  for (const id of f.watchers.keys()) { f.watchers.get(id).watcher.close(); }
});
test('move commits ownership only after import and preserves snapshot', async () => {
  const f = await fixture(), source = f.instances[0], doc = f.store.create(source.id, 'json', '{}'); source.docStates.set(doc.id, snapshot('{"name":1}'));
  assert.ok((await f.move(f.windows.get(source.id), doc.id, null)).moved);
  assert.equal(doc.owner, f.instances[1].id); assert.equal(doc.content, '{"name":1}'); assert.equal(doc.snapshot.query, 'name');
  assert.ok(f.replies.some(r => r.windowId === source.id && r.channel === 'document:remove'));
  assert.throws(() => f.store.owned(source.id, doc.id));
});
test('failed import rolls back without deleting original document', async () => {
  const f = await fixture(), source = f.instances[0], doc = f.store.create(source.id, 'json', '{}'); source.docStates.set(doc.id, snapshot('{"name":2}'));
  await f.move(f.windows.get(source.id), doc.id, null); const target = f.instances[1];
  const other = f.store.create(source.id, 'json', '{}'); source.docStates.set(other.id, snapshot('{"safe":true}')); target.importFailure = true;
  await assert.rejects(f.move(f.windows.get(source.id), other.id, target.id), /ImportFailed/);
  assert.equal(other.owner, source.id); assert.equal(other.busy, null); assert.equal(other.content, '{"safe":true}');
  assert.ok(!f.replies.some(r => r.channel === 'document:remove' && r.windowId === source.id && r.data === other.id));
});
test('canceling window close preserves all unsaved documents; save-all includes inactive docs', async () => {
  const f = await fixture(), win = f.instances[0], ctx = f.windows.get(win.id);
  const a = f.store.create(win.id, 'json', 'a'), b = f.store.create(win.id, 'json', 'b'); a.content = 'new-a'; b.content = 'new-b';
  await f.closeWindow(ctx); assert.equal(f.store.list(win.id).length, 2); assert.ok(!win.destroyed);
  f.setResponse(0); a.filePath = 'C:/test/a.json'; b.filePath = 'C:/test/b.json';
  await f.closeWindow(ctx); assert.deepEqual(f.writes.map(w => w.text), ['new-a', 'new-b']); assert.ok(win.destroyed);
});
test('closing one window does not stop another document watcher', async () => {
  const f = await fixture(), first = f.instances[0], a = f.store.create(first.id, 'json', '{}'); first.docStates.set(a.id, snapshot('{}'));
  await f.move(f.windows.get(first.id), a.id, null); const second = f.instances[1];
  a.filePath = 'C:/test/other.json'; await f.save(f.windows.get(second.id), a, '{}');
  await f.closeWindow(f.windows.get(first.id)); assert.ok(f.watchers.has(a.id)); assert.ok(!second.destroyed);
});
test('save cancellation keeps a dirty document and prevents window closure', async () => {
  const f = await fixture(), win = f.instances[0], ctx = f.windows.get(win.id), doc = f.store.create(win.id, 'json', '{}');
  doc.content = '{"unsaved":true}'; f.setResponse(0); f.setSavePath(null);
  await f.closeWindow(ctx); assert.ok(!win.destroyed); assert.equal(f.store.documents.get(doc.id).content, '{"unsaved":true}'); assert.equal(doc.busy, null);
});
test('moves are blocked while saving, and failed export unlocks the original', async () => {
  const f = await fixture(), win = f.instances[0], ctx = f.windows.get(win.id), doc = f.store.create(win.id, 'json', '{}');
  doc.busy = 'save'; await assert.rejects(f.move(ctx, doc.id, null), /진행 중/); doc.busy = null; win.exportFailure = true;
  await assert.rejects(f.move(ctx, doc.id, null), /ExportFailed/); assert.equal(doc.owner, win.id); assert.equal(doc.busy, null);
  assert.ok(f.replies.some(r => r.channel === 'document:unlock' && r.data.ids.includes(doc.id)));
});
test('opening JSON twice focuses the existing document and registration includes json', async () => {
  const f = await fixture(), win = f.instances[0], ctx = f.windows.get(win.id), p = path.resolve('fixtures.json');
  f.disk.set(p, '\uFEFF{"id":9007199254740993}');
  const first = await f.openFile(ctx, p), second = await f.openFile(ctx, p);
  assert.equal(first.document.type, 'json'); assert.equal(first.document.content, '{"id":9007199254740993}'); assert.ok(second.existing); assert.equal(f.store.list(win.id).length, 1);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.ok(pkg.build.fileAssociations.some(a => a.ext === 'json'));
  assert.ok(pkg.build.files.includes('src/main/**/*'));
});
test('closing a window during incoming or outgoing transfer is blocked without deleting documents', async () => {
  const f = await fixture(), win = f.instances[0], ctx = f.windows.get(win.id), doc = f.store.create(win.id, 'json', '{}');
  ctx.incoming = 1; await assert.rejects(f.closeWindow(ctx), /끝난 뒤/); ctx.incoming = 0; doc.busy = 'move';
  await assert.rejects(f.closeWindow(ctx), /끝난 뒤/); assert.ok(f.store.documents.has(doc.id)); assert.ok(!win.destroyed);
});
