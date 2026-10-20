const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { DocumentStore, supported, typeFor } = require('./src/main/DocumentStore');
const { hitTest } = require('./src/main/NativeDropTarget');

const TITLE = 'PB Markdown Editor';
const store = new DocumentStore();
const windows = new Map(), requests = new Map(), watchers = new Map();
let drag = null, ghost = null;
const entry = path.join(__dirname, 'popup.html');

function context(event) {
  const win = BrowserWindow.fromWebContents(event.sender), ctx = win && windows.get(win.id);
  if (!ctx || event.senderFrame !== event.sender.mainFrame) throw new Error('InvalidWindow');
  return ctx;
}
function send(ctx, channel, payload) { if (ctx && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, payload); }
function title(ctx) {
  const docs = store.list(ctx.win.id), active = docs.find(d => d.id === ctx.activeId) || docs[0];
  ctx.win.setTitle(`${docs.some(d => store.dirty(d)) ? '*' : ''}${active ? path.basename(active.filePath || ('제목 없음.' + active.type)) : '제목 없음'} - ${TITLE}`);
}
function rpc(ctx, action, payload, timeout = 15000) {
  if (!ctx || ctx.win.isDestroyed()) return Promise.reject(new Error('WindowClosed'));
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { requests.delete(requestId); reject(new Error('WindowResponseTimeout')); }, timeout);
    requests.set(requestId, { windowId: ctx.win.id, resolve, reject, timer });
    send(ctx, 'window:request', { requestId, action, payload });
  });
}
function ensureVisible(win, point) {
  const bounds = win.getBounds(), area = screen.getDisplayNearestPoint(point || { x: bounds.x, y: bounds.y }).workArea;
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  win.setBounds({ width, height, x: Math.max(area.x, Math.min(point ? point.x - 100 : bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(point ? point.y - 20 : bounds.y, area.y + area.height - height)) });
}
function createWindow(layout = null, point = null) {
  const win = new BrowserWindow({ width: 1120, height: 760, minWidth: 520, minHeight: 420, show: false,
    backgroundColor: '#f6f8fa', icon: path.join(__dirname, 'assets/icon.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true } });
  let resolveReady;
  const ctx = { win, layout, ready: false, closing: false, confirmed: false, incoming: 0, activeId: null, queued: [], tabRect: null,
    readyPromise: new Promise(resolve => { resolveReady = resolve; }), resolveReady: () => resolveReady() };
  windows.set(win.id, ctx);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== require('url').pathToFileURL(entry).href) event.preventDefault(); });
  win.loadFile(entry);
  win.once('ready-to-show', () => { ensureVisible(win, point); win.show(); });
  win.on('close', event => {
    if (ctx.confirmed) return;
    if (drag?.owner === win.id) { drag = null; hideDrag(); }
    event.preventDefault(); if (ctx.closing) return;
    ctx.closing = true;
    closeWindow(ctx).catch(error => notify(ctx, error)).finally(() => { ctx.closing = false; });
  });
  win.on('closed', () => {
    windows.delete(win.id);
    for (const [id, request] of requests) if (request.windowId === win.id) { clearTimeout(request.timer); requests.delete(id); request.reject(new Error('WindowClosed')); }
    const remaining = store.list(win.id);
    if (remaining.length && windows.size) {
      const target = [...windows.values()][0];
      for (const doc of remaining) { doc.owner = target.win.id; doc.busy = null; send(target, 'document:recover', store.public(doc)); }
    }
  });
  return ctx;
}
function notify(ctx, error) { send(ctx, 'app:error', String(error.message || error)); }
function stopWatch(id) { const w = watchers.get(id); if (w) { clearTimeout(w.timer); w.watcher.close(); watchers.delete(id); } }
function watch(doc) {
  stopWatch(doc.id); if (!doc.filePath) return;
  try {
    const record = { timer: null, watcher: null };
    record.watcher = fs.watch(path.dirname(doc.filePath), (_event, filename) => {
      if (filename && filename.toString().toLowerCase() !== path.basename(doc.filePath).toLowerCase()) return;
      clearTimeout(record.timer);
      record.timer = setTimeout(async () => {
        try {
          const text = (await fs.promises.readFile(doc.filePath, 'utf8')).replace(/^\uFEFF/, '');
          if (text !== doc.saved && text !== doc.content) send(windows.get(doc.owner), 'file:changed', { id: doc.id, content: text });
        } catch (error) { notify(windows.get(doc.owner), error); }
      }, 3000);
    });
    record.watcher.on('error', error => { notify(windows.get(doc.owner), error); stopWatch(doc.id); });
    watchers.set(doc.id, record);
  } catch (error) { notify(windows.get(doc.owner), error); }
}
function publish(doc) { const ctx = windows.get(doc.owner); send(ctx, 'document:saved', { id: doc.id, saved: doc.saved, filePath: doc.filePath }); if (ctx) title(ctx); }
async function save(ctx, doc, content, forceDialog = false) {
  if (doc.busy) throw new Error('문서 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  if (typeof content !== 'string') throw new Error('InvalidContent');
  doc.busy = 'save';
  try {
    let target = forceDialog ? null : doc.filePath;
    if (!target) {
      const result = await dialog.showSaveDialog(ctx.win, { title: '문서 저장', defaultPath: doc.filePath || `document.${doc.type === 'json' ? 'json' : 'md'}`,
        filters: [{ name: doc.type === 'json' ? 'JSON' : 'Markdown', extensions: doc.type === 'json' ? ['json'] : ['md', 'markdown'] }] });
      if (result.canceled) return { saved: false }; target = result.filePath;
    }
    if (!supported(target) || typeFor(target) !== doc.type) throw new Error('문서 형식과 저장 확장자가 일치해야 합니다.');
    const other = store.findPath(target); if (other && other.id !== doc.id) throw new Error('다른 탭에 열려 있는 파일에는 저장할 수 없습니다.');
    const previousPath = doc.filePath; doc.filePath = path.resolve(target);
    try { await fs.promises.writeFile(doc.filePath, content, 'utf8'); }
    catch (error) { doc.filePath = previousPath; throw error; }
    doc.saved = content; watch(doc); publish(doc);
    return { saved: true, filePath: doc.filePath, savedContent: content };
  } finally { doc.busy = null; }
}
async function confirmDocuments(ctx, docs, all = false) {
  if (docs.some(d => d.busy)) return false;
  const dirty = docs.filter(d => store.dirty(d)); if (!dirty.length) return true;
  const result = await dialog.showMessageBox(ctx.win, { type: 'warning', title: '저장하지 않은 변경 사항', message: all ? '이 창의 변경 사항을 저장하시겠습니까?' : '변경 사항을 저장하시겠습니까?',
    detail: dirty.map(d => path.basename(d.filePath || `제목 없음.${d.type}`)).join('\n'), buttons: [all ? '모두 저장' : '저장', '저장하지 않고 닫기', '취소'], defaultId: 0, cancelId: 2, noLink: true });
  if (result.response === 2) return false; if (result.response === 1) return true;
  for (const doc of dirty) if (!(await save(ctx, doc, doc.content)).saved) return false;
  return docs.every(d => !store.dirty(d));
}
async function closeWindow(ctx) {
  const docs = store.list(ctx.win.id);
  if (ctx.incoming || docs.some(doc => doc.busy)) throw new Error('문서 저장·이동이 끝난 뒤 창을 닫아 주세요.');
  try {
    await rpc(ctx, 'prepare-close');
    if (!await confirmDocuments(ctx, docs, true)) return;
    for (const doc of docs) { stopWatch(doc.id); store.documents.delete(doc.id); }
    ctx.confirmed = true; ctx.win.close();
  } finally { if (!ctx.confirmed) send(ctx, 'document:unlock', { ids: docs.map(d => d.id) }); }
}
async function openFile(ctx, filePath) {
  if (!supported(filePath)) throw new Error('Markdown 또는 JSON 파일만 열 수 있습니다.');
  filePath = path.resolve(filePath); const existing = store.findPath(filePath);
  if (existing) { const owner = windows.get(existing.owner); if (owner) { owner.win.restore(); owner.win.focus(); send(owner, 'document:activate', existing.id); } return { existing: true }; }
  const content = (await fs.promises.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
  if (store.findPath(filePath)) return openFile(ctx, filePath);
  const doc = store.create(ctx.win.id, typeFor(filePath), content, filePath); watch(doc);
  return { document: store.public(doc) };
}
async function queueOpen(ctx, filePath) {
  if (!filePath) return; if (!ctx.ready) { ctx.queued.push(filePath); return; }
  try { const result = await openFile(ctx, filePath); if (result.document) send(ctx, 'document:recover', result.document); } catch (error) { notify(ctx, error); }
}
async function move(ctx, id, targetId, index = null, point = null) {
  const doc = store.owned(ctx.win.id, id); if (doc.busy || ctx.closing) throw new Error('문서 작업이 진행 중입니다.');
  let target = targetId ? windows.get(Number(targetId)) : null, created = false, incoming = false;
  if (targetId && (!target || target.closing)) throw new Error('이동할 창을 사용할 수 없습니다.'); if (target === ctx) return { moved: false };
  doc.busy = 'export';
  try {
    const snapshot = await rpc(ctx, 'export', { id });
    store.sync(ctx.win.id, id, snapshot); doc.busy = 'move';
    if (!target) { target = createWindow(snapshot.layout, point); created = true; }
    target.incoming++; incoming = true;
    await Promise.race([target.readyPromise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('WindowReadyTimeout')), 15000); timer.unref(); })]);
    if (target.closing || target.win.isDestroyed()) throw new Error('WindowClosed');
    await rpc(target, 'import', { document: store.public(doc), index });
    doc.owner = target.win.id; doc.busy = null;
    send(target, 'document:unlock', { ids: [id] }); send(ctx, 'document:remove', id);
    target.win.restore(); target.win.focus(); title(ctx); title(target); return { moved: true };
  } catch (error) {
    doc.busy = null;
    if (target && !target.win.isDestroyed()) { try { await rpc(target, 'rollback', { id, placeholder: !created }); } catch {} }
    if (created && target && !target.win.isDestroyed()) {
      for (const owned of store.list(target.win.id)) { stopWatch(owned.id); store.documents.delete(owned.id); }
      target.confirmed = true; target.win.close();
    }
    send(ctx, 'document:unlock', { ids: [id] }); throw error;
  } finally { if (incoming) target.incoming--; }
}
function hideDrag() { if (ghost && !ghost.isDestroyed()) ghost.destroy(); ghost = null; for (const ctx of windows.values()) send(ctx, 'tabs:hint', null); }
function tabsAt(point) {
  for (const ctx of windows.values()) {
    if (!ctx.tabRect || ctx.win.isDestroyed() || ctx.win.isMinimized()) continue;
    const b = ctx.win.getContentBounds(), r = ctx.tabRect;
    if (point.x >= b.x + r.x && point.x <= b.x + r.x + r.width && point.y >= b.y + r.y && point.y <= b.y + r.y + r.height) return { ctx, index: r.tabs.filter(t => point.x - b.x > t.x + t.width / 2).length };
  } return null;
}
function extractPaths(argv) { return argv.slice(1).filter(arg => typeof arg === 'string' && !arg.startsWith('-') && supported(arg) && fs.existsSync(path.resolve(arg))).map(arg => path.resolve(arg)); }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { const ctx = windows.get(BrowserWindow.getFocusedWindow()?.id) || [...windows.values()][0]; if (ctx) for (const file of extractPaths(argv)) queueOpen(ctx, file); });
  app.whenReady().then(() => {
    ipcMain.handle('app:bootstrap', event => { const ctx = context(event); return { windowId: ctx.win.id, layout: ctx.layout, documents: store.list(ctx.win.id).map(d => store.public(d)) }; });
    ipcMain.on('renderer:ready', event => { const ctx = context(event); ctx.ready = true; ctx.resolveReady(); for (const p of ctx.queued.splice(0)) queueOpen(ctx, p); });
    ipcMain.on('window:response', (event, result) => { const ctx = context(event), pending = requests.get(result.requestId); if (!pending || pending.windowId !== ctx.win.id) return; clearTimeout(pending.timer); requests.delete(result.requestId); if (result.error) pending.reject(new Error(result.error)); else pending.resolve(result.value); });
    ipcMain.handle('document:create', (event, type) => { const ctx = context(event); if (ctx.closing) throw new Error('WindowClosing'); if (!['md', 'json'].includes(type)) throw new Error('InvalidType'); return store.public(store.create(ctx.win.id, type)); });
    ipcMain.handle('document:sync', (event, data) => { const ctx = context(event); const doc = store.sync(ctx.win.id, data.id, data.snapshot); ctx.activeId = data.activeId; title(ctx); return { saved: doc.saved }; });
    ipcMain.handle('document:open', (event, p) => openFile(context(event), p));
    ipcMain.handle('file:choose', async event => { const ctx = context(event); const result = await dialog.showOpenDialog(ctx.win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown / JSON', extensions: ['md', 'markdown', 'json'] }] }); if (!result.canceled) for (const p of result.filePaths) await queueOpen(ctx, p); });
    ipcMain.handle('document:save', (event, data) => { const ctx = context(event); return save(ctx, store.owned(ctx.win.id, data.id), data.content, !!data.forceDialog); });
    ipcMain.handle('document:close', async (event, id) => { const ctx = context(event), doc = store.owned(ctx.win.id, id); if (!await confirmDocuments(ctx, [doc])) return false; stopWatch(id); store.documents.delete(id); title(ctx); return true; });
    ipcMain.handle('document:reload', async (event, data) => {
      const ctx = context(event), doc = store.owned(ctx.win.id, data.id); if (doc.busy) return false;
      if (store.dirty(doc)) { const r = await dialog.showMessageBox(ctx.win, { type: 'warning', message: '외부 변경 내용으로 바꾸시겠습니까?', detail: '현재 편집 내용은 교체됩니다.', buttons: ['디스크 내용 불러오기', '현재 편집 유지'], defaultId: 1, cancelId: 1 }); if (r.response !== 0) return false; }
      const content = (await fs.promises.readFile(doc.filePath, 'utf8')).replace(/^\uFEFF/, ''); doc.content = doc.saved = content; publish(doc); return { content };
    });
    ipcMain.handle('document:move', (event, data) => move(context(event), data.id, data.targetId));
    ipcMain.handle('windows:list', event => { const ctx = context(event); return [...windows.values()].filter(w => w !== ctx && !w.closing).map(w => ({ id: w.win.id, title: w.win.getTitle() })); });
    ipcMain.on('tabs:geometry', (event, rect) => {
      const ctx = context(event), zoom = ctx.win.webContents.getZoomFactor();
      if (!rect || !Array.isArray(rect.tabs) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
      ctx.tabRect = { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom, tabs: rect.tabs.filter(t => Number.isFinite(t.x) && Number.isFinite(t.width)).map(t => ({ x: t.x * zoom, width: t.width * zoom })) };
    });
    ipcMain.handle('tabs:drag-start', (event, id) => {
      const ctx = context(event), doc = store.owned(ctx.win.id, id); if (doc.busy || drag) return false;
      drag = { owner: ctx.win.id, id }; ghost = new BrowserWindow({ width: 250, height: 38, frame: false, transparent: true, focusable: false, alwaysOnTop: true, skipTaskbar: true, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      ghost.setIgnoreMouseEvents(true);
      const label = path.basename(doc.filePath || `제목 없음.${doc.type}`).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const currentGhost = ghost;
      ghost.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body style="margin:0;background:#635bdb;color:white;border-radius:7px;padding:8px 12px;font:13px Segoe UI;overflow:hidden;white-space:nowrap">${label}</body>`));
      ghost.once('ready-to-show', () => { if (!currentGhost.isDestroyed()) currentGhost.showInactive(); }); return true;
    });
    ipcMain.on('tabs:drag-update', event => { const ctx = context(event); if (!drag || drag.owner !== ctx.win.id) return; const point = screen.getCursorScreenPoint(); if (ghost && !ghost.isDestroyed()) ghost.setPosition(point.x + 14, point.y + 14); const target = tabsAt(point); for (const w of windows.values()) send(w, 'tabs:hint', target && target.ctx === w ? { index: target.index } : null); });
    ipcMain.handle('tabs:drag-end', async (event, canceled) => {
      const ctx = context(event); if (!drag || drag.owner !== ctx.win.id) return { moved: false };
      const currentDrag = drag; drag = null; hideDrag(); if (canceled) return { moved: false };
      const released = screen.getCursorScreenPoint();
      const hit = await hitTest(screen.dipToScreenPoint(released)); if (!hit) return { moved: false, message: '드래그 위치를 확인하지 못했습니다. 탭 메뉴에서 이동할 수 있습니다.' };
      const point = screen.screenToDipPoint({ x: hit.x, y: hit.y }), target = tabsAt(point);
      const buffer = target?.ctx.win.getNativeWindowHandle();
      const handleMatches = buffer && (buffer.length >= 8 ? buffer.readBigUInt64LE().toString() : buffer.readUInt32LE().toString()) === hit.handle;
      if (handleMatches) { if (target.ctx === ctx) return { reordered: true, id: currentDrag.id, index: target.index }; return move(ctx, currentDrag.id, target.ctx.win.id, target.index); }
      if (hit.desktop) return move(ctx, currentDrag.id, null, null, point); return { moved: false };
    });
    ipcMain.handle('dialog:message', (event, options) => dialog.showMessageBox(context(event).win, { type: options.type || 'info', message: String(options.message || ''), detail: String(options.detail || ''), buttons: ['확인'] }));
    screen.on('display-removed', () => { for (const ctx of windows.values()) ensureVisible(ctx.win); });
    const ctx = createWindow(); for (const p of extractPaths(process.argv)) queueOpen(ctx, p);
    app.on('activate', () => { if (!windows.size) createWindow(); });
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
