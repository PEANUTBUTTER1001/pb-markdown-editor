const { summary, location } = require('../services/JsonService');
const ROW_HEIGHT = 34;
class JsonTreeView {
  constructor(onSelect, onJump, onNotice) {
    this.onSelect = onSelect; this.onJump = onJump; this.onNotice = onNotice;
    this.scroll = document.getElementById('json-tree-scroll'); this.tree = document.getElementById('json-tree');
    this.search = document.getElementById('json-search');
    this.search.addEventListener('input', () => { if (this.tab) { this.tab.query = this.search.value; this.scroll.scrollTop = 0; this.build(); } });
    document.getElementById('json-search-clear').onclick = () => { this.search.value = ''; this.search.dispatchEvent(new Event('input')); this.search.focus(); };
    document.getElementById('json-expand').onclick = () => { if (this.tab?.parsed) { this.tab.expanded = new Set(this.tab.parsed.nodes.filter(n => n.children.length).map(n => n.id)); this.build(); } };
    document.getElementById('json-collapse').onclick = () => { if (this.tab) { this.tab.expanded = new Set(['r']); this.build(); } };
    document.getElementById('json-copy-path').onclick = () => this.copy(false);
    document.getElementById('json-copy-value').onclick = () => this.copy(true);
    document.getElementById('json-jump').onclick = () => { const n = this.selected(); if (n && this.fresh()) this.onJump(n); };
    this.scroll.addEventListener('scroll', () => { if (this.tab) this.tab.treeScroll = this.scroll.scrollTop; this.rows(); });
    this.tree.addEventListener('keydown', event => this.key(event));
    this.observer = new ResizeObserver(() => this.rows()); this.observer.observe(this.scroll);
  }
  setDocument(tab) { this.tab = tab; this.search.value = tab.query || ''; this.build(); this.scroll.scrollTop = tab.treeScroll || 0; this.rows(); }
  fresh() { return this.tab && !this.tab.analysisPending && !this.tab.error && this.tab.parsed?.text === this.tab.content && !this.tab.locked; }
  selected() { return this.map?.get(this.tab?.selected); }
  build() {
    const tab = this.tab; if (!tab) return;
    const parsed = tab.parsed; this.map = new Map((parsed?.nodes || []).map(n => [n.id, n])); this.visible = [];
    const query = (tab.query || '').toLocaleLowerCase(), included = new Set(); let matches = 0;
    if (query) for (const node of parsed?.nodes || []) {
      if (node.key.toLocaleLowerCase().includes(query) || (!node.children.length && summary(node).toLocaleLowerCase().includes(query))) {
        matches++; let parent = node; while (parent && !included.has(parent.id)) { included.add(parent.id); parent = this.map.get(parent.parentId); }
      }
    }
    const visit = node => { if (query && !included.has(node.id)) return; this.visible.push(node); if (node.children.length && (query || tab.expanded.has(node.id))) node.children.forEach(visit); };
    if (parsed?.root) visit(parsed.root);
    this.tree.style.height = this.visible.length ? (this.visible.length * ROW_HEIGHT) + 'px' : 'auto';
    document.getElementById('json-search-count').textContent = query ? matches + '개 일치' : (parsed ? parsed.nodes.length.toLocaleString() + '개 항목' : '');
    document.getElementById('json-column-head').hidden = !this.visible.length;
    const notice = document.getElementById('json-notice');
    notice.hidden = !(tab.error || tab.analysisPending || parsed?.warnings.length);
    notice.className = 'json-notice' + (tab.error ? ' error' : '');
    const errorLocation = tab.error ? location(tab.content, tab.error.offset) : null;
    notice.textContent = tab.analysisPending ? '분석 중 · 현재 코드와 구조가 다를 수 있습니다.' : tab.error ? ((tab.limited ? '' : errorLocation.line + '행, ' + errorLocation.column + '열 · ') + tab.error.message + (parsed ? ' — 현재 코드와 다릅니다. 마지막 정상 구조입니다.' : '')) : parsed?.warnings.length ? '⚠ 중복 키 ' + parsed.warnings.length + '개 · 원문과 모든 항목을 유지합니다.' : '';
    this.rows(); this.inspector();
  }
  rows() {
    if (!this.visible) return;
    const focused = this.tree.contains(document.activeElement); this.tree.replaceChildren();
    if (!this.visible.length) { const empty = document.createElement('p'); empty.className = 'json-empty'; empty.textContent = this.tab?.query ? '일치하는 키 또는 값이 없습니다.' : 'JSON을 입력하면 구조가 표시됩니다.'; this.tree.append(empty); return; }
    const first = Math.max(0, Math.floor((this.scroll.scrollTop - 30) / ROW_HEIGHT) - 6), count = Math.ceil((this.scroll.clientHeight || 400) / ROW_HEIGHT) + 14;
    this.visible.slice(first, first + count).forEach((node, i) => {
      const row = document.createElement('div'); row.className = 'json-row type-' + node.type + (node.id === this.tab.selected ? ' selected' : ''); row.style.top = ((first + i) * ROW_HEIGHT) + 'px'; row.dataset.nodeId = node.id;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(node.depth + 1)); row.setAttribute('aria-selected', String(node.id === this.tab.selected));
      const siblings = this.map.get(node.parentId)?.children || [node]; row.setAttribute('aria-posinset', String(siblings.indexOf(node) + 1)); row.setAttribute('aria-setsize', String(siblings.length));
      const open = !!this.tab.query || this.tab.expanded.has(node.id); if (node.children.length) row.setAttribute('aria-expanded', String(open));
      row.tabIndex = node.id === this.tab.selected ? 0 : -1;
      const key = document.createElement('div'); key.className = 'json-key'; key.style.paddingLeft = (10 + Math.min(node.depth, 6) * 13) + 'px';
      const toggle = document.createElement(node.children.length ? 'button' : 'span'); toggle.className = 'json-toggle'; toggle.tabIndex = -1; toggle.textContent = node.children.length ? (open ? '▾' : '▸') : ''; if (node.children.length) { toggle.setAttribute('aria-label', (open ? '접기 ' : '펼치기 ') + node.key); toggle.onclick = event => { event.stopPropagation(); this.toggle(node); }; } else toggle.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'json-key-label'; label.textContent = node.key; label.title = node.key; key.append(toggle, label);
      if (node.duplicate) { const warning = document.createElement('span'); warning.textContent = '⚠'; warning.title = '중복 키'; key.append(warning); }
      const value = document.createElement('span'); value.className = 'json-value'; value.textContent = summary(node); value.title = value.textContent;
      const type = document.createElement('span'); type.className = 'json-type-cell'; const badge = document.createElement('span'); badge.className = 'json-type-badge'; badge.textContent = node.type; type.append(badge);
      row.append(key, value, type); row.onclick = () => this.select(node); row.ondblclick = () => { if (this.fresh()) this.onJump(node); }; this.tree.append(row);
    });
    if (focused) (this.tree.querySelector('.selected') || this.tree).focus({ preventScroll: true });
  }
  select(node, reveal = false) {
    this.tab.selected = node.id;
    if (reveal) { const at = this.visible.indexOf(node), top = at * ROW_HEIGHT + 30; if (top < this.scroll.scrollTop + 30 || top + ROW_HEIGHT > this.scroll.scrollTop + this.scroll.clientHeight) this.scroll.scrollTop = Math.max(0, top - 60); }
    this.rows(); this.inspector(); this.onSelect(node);
  }
  toggle(node) { if (this.tab.expanded.has(node.id)) this.tab.expanded.delete(node.id); else this.tab.expanded.add(node.id); this.build(); }
  inspector() {
    const node = this.selected(), path = document.getElementById('json-path'); path.textContent = node ? node.path || '(root)' : '선택한 항목 없음'; path.title = path.textContent;
    document.getElementById('json-selected-type').textContent = node ? node.type : '';
    document.getElementById('json-copy-path').disabled = !node; document.getElementById('json-copy-value').disabled = !node;
    document.getElementById('json-jump').disabled = !node || !this.fresh();
  }
  async copy(value) {
    const node = this.selected(); if (!node) return;
    try { await navigator.clipboard.writeText(value ? node.raw : node.path); this.onNotice(value && !this.fresh() ? '마지막 정상 구조의 값을 복사했습니다.' : '복사했습니다.'); }
    catch { this.onNotice('클립보드에 복사할 수 없습니다.'); }
  }
  key(event) {
    const node = this.selected() || this.visible[0]; if (!node) return;
    const at = this.visible.indexOf(node); let target;
    if (event.key === 'ArrowDown') target = this.visible[at + 1];
    else if (event.key === 'ArrowUp') target = this.visible[at - 1];
    else if (event.key === 'Home') target = this.visible[0];
    else if (event.key === 'End') target = this.visible[this.visible.length - 1];
    else if (event.key === 'ArrowRight') { if (node.children.length && !this.tab.expanded.has(node.id)) this.toggle(node); else target = node.children[0]; }
    else if (event.key === 'ArrowLeft') { if (node.children.length && this.tab.expanded.has(node.id)) this.toggle(node); else target = this.map.get(node.parentId); }
    else if (event.key === 'Enter') { if (this.fresh()) this.onJump(node); }
    else return;
    event.preventDefault(); if (target) { this.select(target, true); (this.tree.querySelector('.selected') || this.tree).focus({ preventScroll: true }); }
  }
}
module.exports = JsonTreeView;
