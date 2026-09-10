const MarkdownService = require('./services/MarkdownService');
const FileService = require('./services/FileService');
const ScrollManager = require('./ui/ScrollManager');
const SplitterManager = require('./ui/SplitterManager');
const LayoutManager = require('./ui/LayoutManager');
const ThemeManager = require('./ui/ThemeManager');
const EditorMetricsManager = require('./ui/EditorMetricsManager');
const TabManager = require('./ui/TabManager');

class App {
  constructor() {
    // Services
    this.markdownService = new MarkdownService();
    this.fileService = new FileService();

    // Document state
    this.currentFilePath = null;
    this.isDirty = false;
    this._statusTimer = null;

    // DOM Elements
    this.inputArea = document.getElementById('markdown-input');
    this.outputArea = document.getElementById('markdown-output');
    this.container = document.getElementById('main-container');
    this.editorPane = document.getElementById('editor-pane');
    this.previewPane = document.getElementById('preview-pane');
    this.splitter = document.getElementById('splitter');
    this.btnToggle = document.getElementById('btn-toggle-layout');
    this.btnSave = document.getElementById('btn-save');
    this.btnSaveAs = document.getElementById('btn-save-as');
    this.tabBarEl = document.getElementById('tab-bar');
    this.btnNewTab = document.getElementById('btn-new-tab');
    this.lineNumbersEl = document.getElementById('line-numbers');
    this.statusCountsEl = document.getElementById('status-counts');
    this.statusMessageEl = document.getElementById('status-message');

    // UI Managers
    this.themeManager = new ThemeManager();
    this.scrollManager = new ScrollManager(this.inputArea, this.previewPane);
    this.splitterManager = new SplitterManager(this.container, this.splitter, this.editorPane, this.previewPane);

    const viewButtons = {
      btnEditor: document.getElementById('btn-view-editor'),
      btnSplit: document.getElementById('btn-view-split'),
      btnPreview: document.getElementById('btn-view-preview')
    };
    this.layoutManager = new LayoutManager(
      this.container,
      this.editorPane,
      this.previewPane,
      this.btnToggle,
      viewButtons
    );

    this.editorMetrics = new EditorMetricsManager(
      this.inputArea,
      this.lineNumbersEl,
      this.statusCountsEl
    );

    this.tabManager = new TabManager(this.tabBarEl, this.btnNewTab, {
      onActivate: (tab) => this.handleTabActivate(tab),
      onSaveState: (tab) => this.handleTabSaveState(tab),
      onConfirmDiscard: (tab) => this.handleTabConfirmDiscard(tab),
      onExternalReload: (tab) => this.handleTabExternalReload(tab),
      onPromptReload: (tab, newContent) => this.handleTabPromptReload(tab, newContent)
    });
  }

  init() {
    this.themeManager.init();
    this.scrollManager.init();
    this.splitterManager.init();
    this.layoutManager.init();
    this.editorMetrics.init();
    this.tabManager.init();
    this.bindEvents();

    // Initial render
    this.updatePreview();
    this.syncDocumentState();

    // 준비 완료를 메인에 알린다. (이전 도착한 파일 열기 큐 전달)
    window.pbEditor.notifyReady();
  }

  updatePreview() {
    const html = this.markdownService.render(this.inputArea.value || '');
    this.outputArea.innerHTML = html;
  }

  /** 현재 문서 상태를 메인 프로세스에 전달한다. (창 제목 / 종료 확인) */
  syncDocumentState() {
    const activeTab = this.tabManager.getActiveTab();
    const hasDirty = this.tabManager.hasAnyDirtyTabs();
    window.pbEditor.setDocumentState({
      filePath: activeTab ? activeTab.filePath : this.currentFilePath,
      isDirty: hasDirty
    });
  }

  setDirty(isDirty) {
    const activeTab = this.tabManager.getActiveTab();
    if (activeTab) {
      activeTab.isDirty = isDirty;
      this.tabManager.render();
    }
    this.isDirty = isDirty;
    this.syncDocumentState();
  }

  handleTabActivate(tab) {
    this.inputArea.value = tab.content || '';
    this.currentFilePath = tab.filePath;
    this.isDirty = tab.isDirty;

    this.markdownService.setCurrentFilePath(tab.filePath);
    this.updatePreview();
    this.editorMetrics.update();
    this.syncDocumentState();

    // 스크롤 복원
    this.inputArea.scrollTop = tab.scrollTop || 0;
    this.previewPane.scrollTop = tab.previewScrollTop || 0;
    if (this.lineNumbersEl) {
      this.lineNumbersEl.scrollTop = this.inputArea.scrollTop;
    }
  }

  handleTabSaveState(tab) {
    tab.content = this.inputArea.value;
    tab.scrollTop = this.inputArea.scrollTop;
    tab.previewScrollTop = this.previewPane.scrollTop;
  }

  async handleTabConfirmDiscard(tab) {
    // 탭을 저장할지 확인
    return window.pbEditor.confirmDiscard();
  }

  handleTabExternalReload(tab) {
    if (tab.id === this.tabManager.activeTabId) {
      this.inputArea.value = tab.content;
      this.updatePreview();
      this.editorMetrics.update();
      this.showStatusNotification('외부 변경사항이 자동 반영되었습니다.');
    }
  }

  async handleTabPromptReload(tab, newContent) {
    const fileName = tab.title || '문서';
    const confirmed = confirm(
      `[${fileName}] 파일이 외부(AI 에이전트 등)에서 수정되었습니다.\n디스크의 변경사항으로 새로고침하시겠습니까?\n(취소 시 현재 편집 중인 내용이 유지됩니다)`
    );

    if (confirmed) {
      tab.content = newContent;
      tab.isDirty = false;
      this.tabManager.render();
      if (tab.id === this.tabManager.activeTabId) {
        this.inputArea.value = newContent;
        this.updatePreview();
        this.setDirty(false);
        this.editorMetrics.update();
      }
      this.showStatusNotification('디스크 내용으로 새로고침되었습니다.');
    }
  }

  showStatusNotification(message, duration = 3000) {
    if (!this.statusMessageEl) return;
    this.statusMessageEl.textContent = message;
    if (this._statusTimer) clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (this.statusMessageEl) this.statusMessageEl.textContent = '';
      this._statusTimer = null;
    }, duration);
  }

  bindEvents() {
    // 마크다운 입력 시 프리뷰 및 메트릭 갱신
    this.inputArea.addEventListener('input', () => {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        activeTab.content = this.inputArea.value;
      }
      this.setDirty(true);
      this.updatePreview();
    });

    this.inputArea.addEventListener('paste', () => {
      setTimeout(() => {
        const activeTab = this.tabManager.getActiveTab();
        if (activeTab) {
          activeTab.content = this.inputArea.value;
        }
        this.setDirty(true);
        this.updatePreview();
        this.editorMetrics.update();
      }, 0);
    });

    // 저장 버튼 이벤트
    this.btnSave.addEventListener('click', () => this.save());
    this.btnSaveAs.addEventListener('click', () => this.save({ forceDialog: true }));

    // 단축키 핸들러
    document.addEventListener('keydown', (e) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      // 1. Ctrl + Tab / Ctrl + Shift + Tab (탭 순환)
      if (isCmdOrCtrl && e.key === 'Tab') {
        e.preventDefault();
        this.tabManager.cycleTab(e.shiftKey ? -1 : 1);
        return;
      }

      // 2. Ctrl + T (새 탭)
      if (isCmdOrCtrl && String(e.key).toLowerCase() === 't') {
        e.preventDefault();
        this.tabManager.createTab({ activate: true });
        return;
      }

      // 3. Ctrl + W (현재 탭 닫기)
      if (isCmdOrCtrl && String(e.key).toLowerCase() === 'w') {
        e.preventDefault();
        this.tabManager.closeActiveTab();
        return;
      }

      // 4. Ctrl + S (저장) / Ctrl + Shift + S (다른 이름으로 저장)
      if (isCmdOrCtrl && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        this.save({ forceDialog: e.shiftKey });
        return;
      }
    });

    // OS에서 더블클릭 또는 second-instance로 전달된 파일 열기
    window.pbEditor.onOpenFile(async (filePath) => {
      await this.handleFileOpen(filePath);
    });

    // 외부 파일 실시간 수정 이벤트 수신 (3초 디바운스 적용됨)
    window.pbEditor.onFileChanged(async (filePath) => {
      try {
        const newContent = await this.fileService.readFile(filePath);
        this.tabManager.handleExternalChange(filePath, newContent);
      } catch (err) {
        console.error('Failed to reload externally modified file:', filePath, err);
      }
    });

    // 메인 프로세스에서 창 닫기 전 저장을 요청한 경우
    window.pbEditor.onRequestSave(async () => {
      const saved = await this.save();
      window.pbEditor.sendSaveResult({ saved });
    });

    // 드래그 앤 드롭 지원
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

      const mdFiles = [...e.dataTransfer.files].filter((f) =>
        f.name.toLowerCase().endsWith('.md') || f.name.toLowerCase().endsWith('.markdown')
      );

      if (mdFiles.length === 0) {
        window.pbEditor.showMessage({
          type: 'info',
          message: '마크다운(.md, .markdown) 파일만 열 수 있습니다.'
        });
        return;
      }

      // 여러 개를 놓으면 순서대로 우측 탭에 추가
      for (const file of mdFiles) {
        const filePath = window.pbEditor.getPathForFile(file);
        await this.handleFileOpen(filePath);
      }
    });
  }

  /**
   * @param {{forceDialog?: boolean}} options forceDialog 면 항상 저장 대화상자를 띄운다
   * @returns {Promise<boolean>} 저장 성공 여부
   */
  async save({ forceDialog = false } = {}) {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return false;

    activeTab.content = this.inputArea.value;

    try {
      const targetPath = forceDialog ? null : activeTab.filePath;
      const result = await this.fileService.saveFile(activeTab.content, targetPath);

      if (!result || !result.saved) {
        return false;
      }

      activeTab.filePath = result.filePath;
      activeTab.title = this.tabManager.extractFileName(result.filePath);
      activeTab.isDirty = false;

      this.currentFilePath = result.filePath;
      this.markdownService.setCurrentFilePath(result.filePath);
      this.updatePreview();
      this.setDirty(false);
      this.tabManager.render();
      this.syncDocumentState();
      this.showStatusNotification('저장되었습니다.');
      return true;
    } catch (err) {
      console.error("저장 실패:", err);
      window.pbEditor.showMessage({
        type: 'error',
        message: '저장에 실패했습니다.',
        detail: String((err && err.message) || err)
      });
      return false;
    }
  }

  async handleFileOpen(filePath) {
    try {
      const content = await this.fileService.readFile(filePath);
      this.tabManager.openFile(filePath, content);
      this.showStatusNotification(`[${this.tabManager.extractFileName(filePath)}] 파일을 열었습니다.`);
    } catch (err) {
      console.error("파일 열기 실패:", filePath, err);
      window.pbEditor.showMessage({
        type: 'error',
        message: '파일을 열 수 없습니다.',
        detail: String((err && err.message) || err)
      });
    }
  }
}

module.exports = App;
