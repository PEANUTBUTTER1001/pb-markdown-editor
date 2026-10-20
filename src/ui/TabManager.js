class TabManager {
  constructor(app) { this.app = app; this.bar = document.getElementById('tab-bar'); this.menu = document.getElementById('tab-menu'); this.pointer = null; }
  init() {
    document.getElementById('btn-new-tab').onclick = event => this.newMenu(event.currentTarget.getBoundingClientRect());
    document.addEventListener('click', event => { if (!this.menu.contains(event.target) && event.target.id !== 'btn-new-tab' && !event.target.closest('.tab-menu-button')) this.menu.hidden = true; });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.menu.hidden = true; });
    this.bar.addEventListener('scroll', () => this.geometry()); new ResizeObserver(() => this.geometry()).observe(this.bar);
  }
  label(tab) { return tab.filePath ? tab.filePath.split(/[/\\]/).pop() : '제목 없음.' + (tab.type === 'json' ? 'json' : 'md'); }
  render() {
    this.bar.replaceChildren();
    for (const tab of this.app.tabs) {
      const row = document.createElement('div'); row.className = 'tab-item' + (tab.id === this.app.activeId ? ' active' : ''); row.dataset.tabId = tab.id;
      const name = document.createElement('button'); name.className = 'tab-title'; name.textContent = (tab.type === 'json' ? '{ } ' : 'MD ') + this.label(tab); name.title = tab.filePath || this.label(tab); name.setAttribute('aria-pressed', String(tab.id === this.app.activeId)); name.onclick = () => { if (!this.suppressClick) this.app.activate(tab.id); };
      name.onpointerdown = event => this.begin(event, tab, name);
      const dot = document.createElement('span'); dot.className = 'tab-dirty' + (tab.content !== tab.saved ? ' show' : ''); dot.textContent = '●'; dot.title = '미저장 변경';
      const menu = document.createElement('button'); menu.className = 'tab-menu-button'; menu.textContent = '⋮'; menu.setAttribute('aria-label', this.label(tab) + ' 탭 메뉴'); menu.onclick = () => this.tabMenu(tab, menu.getBoundingClientRect());
      const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', this.label(tab) + ' 닫기'); close.disabled = tab.locked; close.onclick = () => this.app.close(tab.id);
      row.oncontextmenu = event => { event.preventDefault(); this.tabMenu(tab, { left: event.clientX, bottom: event.clientY }); };
      row.append(name, dot, menu, close); this.bar.append(row);
    }
    requestAnimationFrame(() => this.geometry());
  }
  showMenu(rect) { this.menu.hidden = false; this.menu.style.left = Math.min(rect.left, window.innerWidth - 245) + 'px'; this.menu.style.top = rect.bottom + 5 + 'px'; }
  item(label, action, disabled = false) { const button = document.createElement('button'); button.textContent = label; button.disabled = disabled; button.onclick = () => { this.menu.hidden = true; Promise.resolve(action()).catch(error => this.app.error(error)); }; this.menu.append(button); }
  newMenu(rect) { this.menu.replaceChildren(); this.item('새 Markdown 문서', () => this.app.newTab('md')); this.item('새 JSON 문서', () => this.app.newTab('json')); this.showMenu(rect); }
  async tabMenu(tab, rect) {
    this.menu.replaceChildren(); this.item('새 창으로 이동', () => this.app.api.moveDocument({ id: tab.id }), tab.locked || tab.saving || this.app.locked);
    this.item('왼쪽으로 이동', () => this.reorder(tab.id, this.app.tabs.indexOf(tab) - 1), this.app.tabs.indexOf(tab) === 0 || tab.locked);
    this.item('오른쪽으로 이동', () => this.reorder(tab.id, this.app.tabs.indexOf(tab) + 2), this.app.tabs.indexOf(tab) === this.app.tabs.length - 1 || tab.locked);
    this.showMenu(rect);
    const windows = await this.app.api.listWindows();
    if (this.menu.hidden) return;
    for (const win of windows) this.item('다른 창으로 이동: ' + win.title, () => this.app.api.moveDocument({ id: tab.id, targetId: win.id }), tab.locked || tab.saving || this.app.locked);
  }
  geometry() {
    const rect = this.bar.getBoundingClientRect();
    this.app.api.setTabGeometry({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, tabs: [...this.bar.children].map(element => { const r = element.getBoundingClientRect(); return { x: r.x, width: r.width }; }) });
  }
  hint(data) { for (const element of this.bar.children) element.classList.remove('drop-before', 'drop-after'); if (!data) return; const rows = [...this.bar.children]; if (data.index < rows.length) rows[data.index].classList.add('drop-before'); else rows[rows.length - 1]?.classList.add('drop-after'); }
  reorder(id, index) { const from = this.app.tabs.findIndex(t => t.id === id); if (from < 0) return; const [tab] = this.app.tabs.splice(from, 1); if (index > from) index--; this.app.tabs.splice(Math.max(0, Math.min(index, this.app.tabs.length)), 0, tab); this.render(); }
  begin(event, tab, element) {
    if (event.button !== 0 || tab.locked || tab.saving || this.app.locked) return;
    const start = { x: event.clientX, y: event.clientY }, pointerId = event.pointerId;
    this.pointer = { id: tab.id, started: false, canceled: false, starting: null };
    element.setPointerCapture(pointerId);
    const move = e => {
      const p = this.pointer; if (!p) return;
      if (!p.starting && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 7) {
        this.suppressClick = true; p.starting = this.app.api.startDrag(tab.id).then(ok => { p.started = ok; if (ok) this.app.api.updateDrag(); });
      }
      if (p.started) this.app.api.updateDrag();
    };
    const finish = async e => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', finish); element.removeEventListener('pointercancel', finish);
      const p = this.pointer; if (!p) return; this.pointer = null;
      try {
        if (p.starting) await p.starting;
        if (p.started) {
          const canceled = p.canceled || e.type === 'pointercancel';
          // Local reordering needs no OS hit test and works on all platforms.
          const r = this.bar.getBoundingClientRect();
          if (!canceled && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            await this.app.api.endDrag(true); const index = [...this.bar.children].filter(el => { const b = el.getBoundingClientRect(); return e.clientX > b.x + b.width / 2; }).length; this.reorder(p.id, index);
          } else { const result = await this.app.api.endDrag(canceled); if (result.reordered) this.reorder(result.id, result.index); if (result.message) this.app.notice(result.message); }
        }
      } catch (error) { this.app.error(error); } finally { setTimeout(() => { this.suppressClick = false; }, 0); }
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', finish); element.addEventListener('pointercancel', finish);
  }
  cancelDrag() { if (this.pointer) { this.pointer.canceled = true; this.app.api.endDrag(true).catch(error => this.app.error(error)); } }
}
module.exports = TabManager;
