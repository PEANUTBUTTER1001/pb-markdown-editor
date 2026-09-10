class TabManager {
  /**
   * @param {HTMLElement} tabBarEl
   * @param {HTMLElement} btnNewTab
   * @param {Object} callbacks 콜백 함수 모음 (onActivate, onSave, onConfirmDiscard, onMessage)
   */
  constructor(tabBarEl, btnNewTab, callbacks = {}) {
    this.tabBarEl = tabBarEl;
    this.btnNewTab = btnNewTab;
    this.callbacks = callbacks;

    this.tabs = [];
    this.activeTabId = null;
    this.tabCounter = 0;
  }

  init() {
    if (this.btnNewTab) {
      this.btnNewTab.addEventListener('click', () => {
        this.createTab({ activate: true });
      });
    }

    // 초기 첫 탭 생성 ("제목 없음")
    this.createTab({ activate: true });
  }

  createTab({ filePath = null, content = '', title = null, isDirty = false, activate = true } = {}) {
    this.tabCounter++;
    const id = `tab-${Date.now()}-${this.tabCounter}`;
    const tabTitle = title || (filePath ? this.extractFileName(filePath) : '제목 없음');

    const tab = {
      id,
      filePath,
      title: tabTitle,
      content,
      isDirty,
      scrollTop: 0,
      previewScrollTop: 0
    };

    // 항상 맨 우측에 추가
    this.tabs.push(tab);

    if (filePath && window.pbEditor && window.pbEditor.watchFile) {
      window.pbEditor.watchFile(filePath).catch((err) => {
        console.error('Failed to watch file:', filePath, err);
      });
    }

    this.render();

    if (activate) {
      this.activateTab(id);
    }

    return tab;
  }

  extractFileName(filePath) {
    if (!filePath) return '제목 없음';
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || '제목 없음';
  }

  getActiveTab() {
    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }

  activateTab(tabId) {
    const targetTab = this.tabs.find((t) => t.id === tabId);
    if (!targetTab) return;

    // 이전 활성 탭의 현재 상태(스크롤 등) 보존
    const currentTab = this.getActiveTab();
    if (currentTab && currentTab.id !== tabId && this.callbacks.onSaveState) {
      this.callbacks.onSaveState(currentTab);
    }

    this.activeTabId = tabId;
    this.render();

    if (this.callbacks.onActivate) {
      this.callbacks.onActivate(targetTab);
    }
  }

  /**
   * Ctrl+Tab 단축키 순환: 오른쪽으로 이동하며 맨 끝에 도달 시 첫 탭으로 루프
   * @param {number} direction 1: 오른쪽, -1: 왼쪽
   */
  cycleTab(direction = 1) {
    if (this.tabs.length <= 1) return;
    const currentIndex = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + direction + this.tabs.length) % this.tabs.length;
    this.activateTab(this.tabs[nextIndex].id);
  }

  async closeTab(tabId) {
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return false;

    const tab = this.tabs[index];

    // 미저장 변경사항이 있으면 확인
    if (tab.isDirty && this.callbacks.onConfirmDiscard) {
      const canDiscard = await this.callbacks.onConfirmDiscard(tab);
      if (!canDiscard) return false;
    }

    // 파일 감시 해제
    if (tab.filePath && window.pbEditor && window.pbEditor.unwatchFile) {
      window.pbEditor.unwatchFile(tab.filePath).catch((err) => {
        console.error('Failed to unwatch file:', tab.filePath, err);
      });
    }

    // 탭 목록에서 제거
    this.tabs.splice(index, 1);

    // 활성 탭이 닫힌 경우 다른 탭 활성화
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        // 이전 인덱스 또는 0번째 탭 활성화
        const newIndex = Math.min(index, this.tabs.length - 1);
        this.activeTabId = this.tabs[newIndex].id;
        this.activateTab(this.activeTabId);
      } else {
        // 모든 탭이 닫히면 빈 새 탭 생성
        this.createTab({ activate: true });
      }
    } else {
      this.render();
    }

    return true;
  }

  async closeActiveTab() {
    if (!this.activeTabId) return;
    return this.closeTab(this.activeTabId);
  }

  /**
   * 파일 열기 처리 (드래그 앤 드롭 또는 탐색기 더블클릭)
   * @param {string} filePath 파일 경로
   * @param {string} content 파일 내용
   */
  openFile(filePath, content) {
    // 1. 이미 열려 있는 파일이면 해당 탭 활성화
    const normalizedTarget = (filePath || '').replace(/\\/g, '/').toLowerCase();
    const existingTab = this.tabs.find((t) => {
      if (!t.filePath) return false;
      return t.filePath.replace(/\\/g, '/').toLowerCase() === normalizedTarget;
    });

    if (existingTab) {
      this.activateTab(existingTab.id);
      return existingTab;
    }

    // 2. 현재 탭이 단 하나뿐이고, 저장되지 않은 빈 새 탭("제목 없음" && !dirty && empty)이면 해당 탭을 교체
    if (
      this.tabs.length === 1 &&
      !this.tabs[0].filePath &&
      !this.tabs[0].isDirty &&
      (!this.tabs[0].content || this.tabs[0].content.trim() === '')
    ) {
      const singleTab = this.tabs[0];
      singleTab.filePath = filePath;
      singleTab.title = this.extractFileName(filePath);
      singleTab.content = content;
      singleTab.isDirty = false;
      if (window.pbEditor && window.pbEditor.watchFile) {
        window.pbEditor.watchFile(filePath);
      }
      this.render();
      this.activateTab(singleTab.id);
      return singleTab;
    }

    // 3. 그 외에는 항상 맨 우측에 새 탭 추가 후 즉시 활성화
    return this.createTab({
      filePath,
      content,
      title: this.extractFileName(filePath),
      isDirty: false,
      activate: true
    });
  }

  /**
   * 외부 파일 변경 감지 처리
   */
  handleExternalChange(filePath, newContent) {
    const normalizedTarget = (filePath || '').replace(/\\/g, '/').toLowerCase();
    const targetTab = this.tabs.find((t) => {
      if (!t.filePath) return false;
      return t.filePath.replace(/\\/g, '/').toLowerCase() === normalizedTarget;
    });

    if (!targetTab) return;

    if (!targetTab.isDirty) {
      // 로컬 미수정 상태: 사용자 개입 없이 즉시 실시간 갱신
      targetTab.content = newContent;
      if (targetTab.id === this.activeTabId && this.callbacks.onExternalReload) {
        this.callbacks.onExternalReload(targetTab);
      }
    } else {
      // 로컬 수정 중 상태: 충돌 방지 대화상자 표시
      if (this.callbacks.onPromptReload) {
        this.callbacks.onPromptReload(targetTab, newContent);
      }
    }
  }

  hasAnyDirtyTabs() {
    return this.tabs.some((t) => t.isDirty);
  }

  render() {
    if (!this.tabBarEl) return;
    this.tabBarEl.innerHTML = '';

    this.tabs.forEach((tab) => {
      const item = document.createElement('div');
      item.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;
      item.setAttribute('data-tab-id', tab.id);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title;
      titleSpan.title = tab.filePath || tab.title;

      const dirtySpan = document.createElement('span');
      dirtySpan.className = `tab-dirty ${tab.isDirty ? 'show' : ''}`;
      dirtySpan.textContent = '●';
      dirtySpan.title = '수정됨';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = '탭 닫기 (Ctrl+W)';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      item.appendChild(titleSpan);
      item.appendChild(dirtySpan);
      item.appendChild(closeBtn);

      item.addEventListener('click', () => {
        this.activateTab(tab.id);
      });

      this.tabBarEl.appendChild(item);
    });
  }
}

module.exports = TabManager;
