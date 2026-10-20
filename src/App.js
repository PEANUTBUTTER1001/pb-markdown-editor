const MarkdownService = require('./services/MarkdownService');
const JsonService = require('./services/JsonService');
const SourceEditor = require('./ui/SourceEditor');
const JsonTreeView = require('./ui/JsonTreeView');
const TabManager = require('./ui/TabManager');
const LayoutManager = require('./ui/LayoutManager');
const ThemeManager = require('./ui/ThemeManager');
const SplitterManager = require('./ui/SplitterManager');
const $ = id => document.getElementById(id);

class App {
  constructor() {
    this.tabs = []; this.activeId = null; this.locked = false; this.api = window.pbEditor;
    this.markdown = new MarkdownService(); this.theme = new ThemeManager();
    this.layout = new LayoutManager($('main-container'), $('editor-pane'), $('preview-pane'), $('btn-toggle-layout'), { btnEditor: $('btn-view-editor'), btnSplit: $('btn-view-split'), btnPreview: $('btn-view-preview') });
    this.splitter = new SplitterManager($('main-container'), $('splitter'), $('editor-pane'), $('preview-pane'));
    this.source = new SourceEditor($('source-editor'), text => this.edit(text), () => this.metrics());
    this.tree = new JsonTreeView(() => {}, node => this.jump(node), message => this.notice(message));
    this.tabUI = new TabManager(this);
  }
  current() { return this.tabs.find(t => t.id === this.activeId); }
  makeTab(doc) {
    const state = doc.snapshot || {};
    const tab = { ...doc, scrollTop: state.scrollTop || 0, scrollLeft: state.scrollLeft || 0, previewScrollTop: state.previewScrollTop || 0,
      expanded: new Set(state.expanded || ['r']), selected: state.selected || 'r', query: state.query || '', treeScroll: state.treeScroll || 0, parsed: null, error: null, analysisPending: false, locked: false };
    if (state.lastGoodText != null && tab.type === 'json') { const previous = JsonService.analyze(state.lastGoodText); if (!previous.error) tab.parsed = previous; }
    this.analyze(tab); return tab;
  }
  async init() {
    this.theme.init(); this.layout.init(); this.splitter.init(); this.tabUI.init(); this.bind();
    const initial = await this.api.bootstrap(); this.windowId = initial.windowId;
    if (initial.layout) {
      this.theme.setTheme(initial.layout.theme, false); this.layout.layoutIndex = initial.layout.layoutIndex || 0;
      this.layout.applyLayout(); this.layout.setViewMode(initial.layout.viewMode || 'split');
      $('editor-pane').style.flex = initial.layout.editorFlex || '1'; $('preview-pane').style.flex = initial.layout.previewFlex || '1';
    }
    for (const doc of initial.documents) this.tabs.push(this.makeTab(doc));
    if (!this.tabs.length) this.tabs.push(this.makeTab(await this.api.createDocument('md')));
    this.activate(this.tabs[0].id); this.api.notifyReady();
  }
  layoutState() { return { theme: this.theme.getTheme(), layoutIndex: this.layout.layoutIndex, viewMode: this.layout.viewMode, editorFlex: $('editor-pane').style.flex, previewFlex: $('preview-pane').style.flex }; }
  capture(tab) { if (tab.id === this.activeId) { this.source.capture(tab); tab.previewScrollTop = $('preview-pane').scrollTop; } }
  snapshot(tab, withHistory = false) {
    this.capture(tab);
    return { content: tab.content, scrollTop: tab.scrollTop, scrollLeft: tab.scrollLeft, previewScrollTop: tab.previewScrollTop,
      expanded: [...tab.expanded], selected: tab.selected, query: tab.query, treeScroll: tab.treeScroll,
      lastGoodText: tab.parsed?.text ?? null, editor: withHistory ? this.source.serialize(tab) : null, layout: this.layoutState() };
  }
  async sync(tab) { if (!this.tabs.includes(tab) || tab.locked) return; clearTimeout(tab.syncTimer); tab.syncTimer = null; await this.api.syncDocument({ id: tab.id, snapshot: this.snapshot(tab), activeId: this.activeId }); }
  async flush() { for (const tab of this.tabs) if (!tab.locked) await this.sync(tab); }
  async newTab(type) {
    if (this.locked) return; const tab = this.makeTab(await this.api.createDocument(type)); this.tabs.push(tab); this.activate(tab.id); this.source.view.focus();
  }
  activate(id) {
    const tab = this.tabs.find(t => t.id === id); if (!tab) return;
    const previous = this.current(); if (previous) this.capture(previous);
    this.activeId = id; this.source.load(tab); this.render();
    this.sync(tab).catch(error => this.error(error));
  }
  analyze(tab) {
    tab.analysisPending = false; if (tab.type !== 'json') return;
    const result = JsonService.analyze(tab.content); tab.error = result.error || null; tab.limited = !!result.limited;
    if (!result.error) { tab.parsed = result; if (!result.nodes.some(n => n.id === tab.selected)) tab.selected = 'r'; }
  }
  edit(text) {
    const tab = this.current(); if (!tab || tab.locked) return;
    tab.content = text; this.source.capture(tab); this.tabUI.render(); this.metrics();
    clearTimeout(tab.parseTimer); clearTimeout(tab.syncTimer);
    if (tab.type === 'json') { tab.analysisPending = true; this.tree.setDocument(tab); $('btn-format').disabled = true; }
    else this.renderMarkdown(tab);
    tab.parseTimer = setTimeout(() => { this.analyze(tab); if (this.current() === tab) this.render(); }, 250);
    tab.syncTimer = setTimeout(() => this.sync(tab).catch(error => this.error(error)), 100);
  }
  renderMarkdown(tab) { this.markdown.setCurrentFilePath(tab.filePath); $('markdown-output').innerHTML = this.markdown.render(tab.content); }
  render() {
    const tab = this.current(); if (!tab) return; const isJson = tab.type === 'json';
    document.body.classList.toggle('json-document', isJson); $('json-panel').hidden = !isJson; $('markdown-output').hidden = isJson;
    $('document-kind').textContent = isJson ? 'JSON' : 'Markdown'; $('source-caption').textContent = isJson ? '원본 코드' : 'Markdown';
    $('preview-caption').textContent = isJson ? '구조 탐색 · 읽기 전용' : '미리보기';
    $('btn-format').hidden = !isJson; $('btn-format').disabled = !!tab.error || tab.analysisPending || tab.locked;
    $('btn-view-preview').title = isJson ? '구조 전용 보기' : '프리뷰 전용 보기';
    $('btn-save').disabled = tab.locked || !!tab.saving; $('btn-save-as').disabled = tab.locked || !!tab.saving;
    this.tabUI.render(); if (isJson) this.tree.setDocument(tab); else this.renderMarkdown(tab);
    $('preview-pane').scrollTop = tab.previewScrollTop || 0; this.metrics();
  }
  metrics() {
    const tab = this.current(); if (!tab) return;
    const text = tab.content, head = this.source.view.state.selection.main.head, line = this.source.view.state.doc.lineAt(head);
    $('status-counts').textContent = `글자 수: ${text.length.toLocaleString()}자 (공백 제외: ${text.replace(/\s/g, '').length.toLocaleString()}자) | 줄 수: ${this.source.view.state.doc.lines}줄`;
    $('status-cursor').textContent = `행 ${line.number}, 열 ${head - line.from + 1}`;
    $('status-validation').textContent = tab.type === 'md' ? '' : tab.analysisPending ? '분석 중' : tab.limited ? '구조 제한' : tab.error ? 'JSON 오류' : 'JSON 정상';
    $('status-validation').className = tab.error ? 'invalid' : 'valid';
  }
  jump(node) { const tab = this.current(); if (!tab || !this.tree.fresh()) return; if (this.layout.viewMode === 'preview') this.layout.setViewMode('split'); this.source.select(node.start, node.end); }
  notice(message) { $('status-message').textContent = message; clearTimeout(this.noticeTimer); this.noticeTimer = setTimeout(() => { $('status-message').textContent = ''; }, 4500); }
  error(error) { this.notice(String(error.message || error)); }
  async save(tab = this.current(), forceDialog = false) {
    if (!tab || tab.locked || tab.saving) return false;
    await this.sync(tab); const content = tab.content; tab.saving = true; this.render();
    try {
      const result = await this.api.saveDocument({ id: tab.id, content, forceDialog });
      if (!result.saved) return false;
      tab.saved = result.savedContent; tab.filePath = result.filePath; this.render(); this.notice('저장되었습니다.'); return true;
    } catch (error) { this.error(error); return false; }
    finally { tab.saving = false; this.render(); }
  }
  async close(id) {
    const tab = this.tabs.find(t => t.id === id); if (!tab || tab.locked || tab.saving || this.locked) return;
    this.capture(tab); this.lockTab(tab, true);
    try { await this.api.syncDocument({ id: tab.id, snapshot: this.snapshot(tab), activeId: this.activeId }); if (await this.api.closeDocument(id)) await this.remove(id); }
    catch (error) { this.error(error); } finally { if (this.tabs.includes(tab)) this.lockTab(tab, false); }
  }
  lockTab(tab, locked) { tab.locked = locked; if (!locked && tab.analysisPending) this.analyze(tab); if (tab.id === this.activeId) this.source.lock(locked); this.tabUI.render(); if (tab.id === this.activeId) this.render(); }
  async remove(id, placeholder = true) {
    const at = this.tabs.findIndex(t => t.id === id); if (at < 0) return;
    const tab = this.tabs[at]; clearTimeout(tab.parseTimer); clearTimeout(tab.syncTimer); this.tabs.splice(at, 1);
    if (!this.tabs.length) { this.activeId = null; if (placeholder) await this.newTab('md'); }
    else if (this.activeId === id) { this.activeId = null; this.activate(this.tabs[Math.min(at, this.tabs.length - 1)].id); }
    else this.tabUI.render();
  }
  async importDocument(doc, index = null, locked = false) {
    if (this.tabs.some(t => t.id === doc.id)) return;
    const tab = this.makeTab(doc); tab.locked = locked;
    // Validate deserialization before replacing the destination's empty placeholder.
    tab.editorState = this.source.createState(tab.content, tab.type, doc.snapshot?.editor);
    if (this.tabs.length === 1 && !this.tabs[0].filePath && this.tabs[0].content === '' && !this.tabs[0].locked) {
      const empty = this.tabs[0]; await this.api.closeDocument(empty.id); this.tabs = []; this.activeId = null;
    }
    this.tabs.splice(index == null ? this.tabs.length : Math.max(0, Math.min(index, this.tabs.length)), 0, tab); this.activate(tab.id);
  }
  async handleRequest(request) {
    try {
      let value = true;
      if (request.action === 'flush') await this.flush();
      else if (request.action === 'prepare-close') {
        this.locked = true; const current = this.current(); if (current) this.capture(current);
        for (const tab of this.tabs) { this.lockTab(tab, true); clearTimeout(tab.syncTimer); clearTimeout(tab.parseTimer); }
        for (const tab of this.tabs) await this.api.syncDocument({ id: tab.id, snapshot: this.snapshot(tab), activeId: this.activeId });
      }
      else if (request.action === 'lock') { this.locked = true; for (const id of request.payload.ids) { const t = this.tabs.find(t => t.id === id); if (t) this.lockTab(t, true); } }
      else if (request.action === 'export') {
        const tab = this.tabs.find(t => t.id === request.payload.id); if (!tab || tab.saving || tab.locked || this.source.view.composing) throw new Error('입력 또는 문서 작업이 진행 중입니다. 잠시 후 이동해 주세요.');
        clearTimeout(tab.syncTimer); clearTimeout(tab.parseTimer); this.capture(tab); this.analyze(tab); value = this.snapshot(tab, true); this.lockTab(tab, true);
      } else if (request.action === 'import') await this.importDocument(request.payload.document, request.payload.index, true);
      else if (request.action === 'rollback') await this.remove(request.payload.id, request.payload.placeholder);
      else throw new Error('UnknownWindowRequest');
      this.api.respond({ requestId: request.requestId, value });
    } catch (error) { this.api.respond({ requestId: request.requestId, error: String(error.message || error) }); }
  }
  bind() {
    this.api.onRequest(request => this.handleRequest(request));
    this.api.onRecover(doc => this.importDocument(doc).catch(error => this.error(error)));
    this.api.onActivate(id => this.activate(id)); this.api.onRemove(id => this.remove(id).catch(error => this.error(error)));
    this.api.onUnlock(data => { this.locked = false; for (const id of data.ids) { const tab = this.tabs.find(t => t.id === id); if (tab) { this.lockTab(tab, false); this.sync(tab).catch(error => this.error(error)); } } });
    this.api.onSaved(data => { const tab = this.tabs.find(t => t.id === data.id); if (tab) { tab.saved = data.saved; tab.filePath = data.filePath; this.render(); } });
    this.api.onError(message => this.notice(message)); this.api.onTabHint(hint => this.tabUI.hint(hint));
    this.api.onFileChanged(async data => {
      const tab = this.tabs.find(t => t.id === data.id); if (!tab || tab.locked || tab.saving) return;
      try {
        await this.sync(tab); const result = await this.api.reloadDocument({ id: tab.id });
        if (result) { tab.content = tab.saved = result.content; tab.editorState = null; tab.snapshot = null; this.analyze(tab); if (this.current() === tab) this.activate(tab.id); this.notice('외부 변경사항이 반영되었습니다.'); }
      } catch (error) { this.error(error); }
    });
    $('btn-open').onclick = () => this.api.chooseFiles().catch(error => this.error(error));
    $('btn-save').onclick = () => this.save(); $('btn-save-as').onclick = () => this.save(this.current(), true);
    $('btn-format').onclick = () => { const tab = this.current(); if (!tab || tab.locked || tab.analysisPending || tab.error) return; try { this.source.replace(JsonService.formatSource(tab.content)); } catch (error) { this.error(error); } };
    $('btn-undo').onclick = () => { if (!this.current()?.locked) this.source.undo(); };
    $('btn-redo').onclick = () => { if (!this.current()?.locked) this.source.redo(); };
    $('btn-find').onclick = () => { $('code-search-row').hidden = false; $('code-search').focus(); };
    $('code-search-next').onclick = () => { if (!this.source.find($('code-search').value)) this.notice('검색 결과가 없습니다.'); };
    $('code-search-close').onclick = () => { $('code-search-row').hidden = true; this.source.view.focus(); };
    $('code-search').onkeydown = event => { if (event.key === 'Enter') $('code-search-next').click(); if (event.key === 'Escape') $('code-search-close').click(); };
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.tabUI.cancelDrag();
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); event.stopPropagation(); this.save(this.current(), event.shiftKey); }
      else if (key === 't') { event.preventDefault(); this.newTab(this.current()?.type || 'md'); }
      else if (key === 'w') { event.preventDefault(); this.close(this.activeId); }
      else if (key === 'f') { event.preventDefault(); $('btn-find').click(); }
      else if (key === 'tab') { event.preventDefault(); const at = this.tabs.findIndex(t => t.id === this.activeId); if (this.tabs.length) this.activate(this.tabs[(at + (event.shiftKey ? -1 : 1) + this.tabs.length) % this.tabs.length].id); }
    }, true);
    document.addEventListener('dragover', event => event.preventDefault());
    document.addEventListener('drop', async event => { event.preventDefault(); if (this.locked) return; for (const file of [...(event.dataTransfer?.files || [])]) {
      try { const result = await this.api.openDocument(this.api.getPathForFile(file)); if (result.document) await this.importDocument(result.document); } catch (error) { this.error(error); }
    } });
    let syncing = false;
    const sourceScroll = this.source.view.scrollDOM, preview = $('preview-pane');
    sourceScroll.addEventListener('scroll', () => { const tab = this.current(); if (!tab || tab.type !== 'md' || syncing) return; syncing = true; const range = sourceScroll.scrollHeight - sourceScroll.clientHeight; preview.scrollTop = range > 0 ? sourceScroll.scrollTop / range * (preview.scrollHeight - preview.clientHeight) : 0; requestAnimationFrame(() => { syncing = false; }); });
    preview.addEventListener('scroll', () => { const tab = this.current(); if (!tab || tab.type !== 'md' || syncing) return; syncing = true; const range = preview.scrollHeight - preview.clientHeight; sourceScroll.scrollTop = range > 0 ? preview.scrollTop / range * (sourceScroll.scrollHeight - sourceScroll.clientHeight) : 0; requestAnimationFrame(() => { syncing = false; }); });
    $('splitter').tabIndex = 0; $('splitter').setAttribute('role', 'separator'); $('splitter').setAttribute('aria-label', '패널 크기 조절');
    $('splitter').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault();
      const a = $('editor-pane'), b = $('preview-pane'), axis = this.layout.layoutIndex >= 2 ? 'height' : 'width';
      const first = a.getBoundingClientRect()[axis], second = b.getBoundingClientRect()[axis], ratio = first / (first + second) * 100;
      const delta = (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -5 : 5) * (this.layout.layoutIndex % 2 ? -1 : 1);
      const next = Math.max(20, Math.min(80, ratio + delta)); a.style.flex = String(next); b.style.flex = String(100 - next);
      $('splitter').setAttribute('aria-valuenow', String(Math.round(next)));
    });
  }
}
module.exports = App;
