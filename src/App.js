const MarkdownService = require('./services/MarkdownService');
const FileService = require('./services/FileService');
const ScrollManager = require('./ui/ScrollManager');
const SplitterManager = require('./ui/SplitterManager');
const LayoutManager = require('./ui/LayoutManager');

class App {
  constructor() {
    // Services
    this.markdownService = new MarkdownService();
    this.fileService = new FileService();

    // Document state
    this.currentFilePath = null;
    this.isDirty = false;

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

    // UI Managers
    this.scrollManager = new ScrollManager(this.inputArea, this.previewPane);
    this.splitterManager = new SplitterManager(this.container, this.splitter, this.editorPane, this.previewPane);
    this.layoutManager = new LayoutManager(this.container, this.editorPane, this.previewPane, this.btnToggle);
  }

  init() {
    this.scrollManager.init();
    this.splitterManager.init();
    this.layoutManager.init();
    this.bindEvents();

    // Initial render
    this.updatePreview();
    this.syncDocumentState();

    // 준비 완료를 알린다. 이 신호 전에 도착한 파일 열기 요청이 이때 전달된다.
    window.pbEditor.notifyReady();
  }

  updatePreview() {
    const html = this.markdownService.render(this.inputArea.value);
    this.outputArea.innerHTML = html;
  }

  /** 현재 문서 상태를 메인 프로세스에 전달한다. (창 제목 / 종료 확인) */
  syncDocumentState() {
    window.pbEditor.setDocumentState({
      filePath: this.currentFilePath,
      isDirty: this.isDirty
    });
  }

  setDirty(isDirty) {
    if (this.isDirty === isDirty) return;
    this.isDirty = isDirty;
    this.syncDocumentState();
  }

  bindEvents() {
    // Markdown Preview Updates
    this.inputArea.addEventListener('input', () => {
      this.setDirty(true);
      this.updatePreview();
    });
    this.inputArea.addEventListener('paste', () => {
      setTimeout(() => {
        this.setDirty(true);
        this.updatePreview();
      }, 0);
    });

    // File Save Events
    this.btnSave.addEventListener('click', () => this.save());
    this.btnSaveAs.addEventListener('click', () => this.save({ forceDialog: true }));

    // Ctrl+S 저장 / Ctrl+Shift+S 다른 이름으로 저장
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (String(e.key).toLowerCase() !== 's') return;
      e.preventDefault();
      this.save({ forceDialog: e.shiftKey });
    });

    // IPC Event for double-clicking a file in OS
    window.pbEditor.onOpenFile((filePath) => {
      this.handleFileOpen(filePath);
    });

    // 종료 확인 대화상자에서 "저장"을 선택한 경우
    window.pbEditor.onRequestSave(async () => {
      const saved = await this.save();
      window.pbEditor.sendSaveResult({ saved });
    });

    // Drag and Drop support
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

      // 여러 개를 놓으면 첫 번째 .md 파일만 연다.
      const file = [...e.dataTransfer.files].find(f => f.name.toLowerCase().endsWith('.md'));
      if (!file) {
        window.pbEditor.showMessage({
          type: 'info',
          message: '마크다운(.md) 파일만 열 수 있습니다.'
        });
        return;
      }

      // 편집 중인 내용이 있으면 먼저 확인한다.
      if (!(await window.pbEditor.confirmDiscard())) return;

      // File.path 는 Electron 32에서 제거되었으므로 preload 의 webUtils 래퍼를 쓴다.
      this.handleFileOpen(window.pbEditor.getPathForFile(file));
    });
  }

  /**
   * @param {{forceDialog?: boolean}} options forceDialog 면 항상 저장 대화상자를 띄운다
   * @returns {Promise<boolean>} 저장했으면 true, 사용자가 취소했으면 false
   */
  async save({ forceDialog = false } = {}) {
    try {
      const targetPath = forceDialog ? null : this.currentFilePath;
      const result = await this.fileService.saveFile(this.inputArea.value, targetPath);

      if (!result || !result.saved) {
        return false; // 사용자가 대화상자를 취소함
      }

      this.currentFilePath = result.filePath;
      // 저장 위치가 바뀌면 이미지 상대 경로의 기준 폴더도 바뀐다.
      this.markdownService.setCurrentFilePath(result.filePath);
      this.updatePreview();
      this.setDirty(false);
      this.syncDocumentState();
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
      this.inputArea.value = content;
      this.currentFilePath = filePath;
      // 이미지 상대 경로는 열린 파일의 폴더를 기준으로 해석한다.
      this.markdownService.setCurrentFilePath(filePath);
      this.updatePreview();
      this.isDirty = false;
      this.syncDocumentState();
    } catch (err) {
      console.error("파일 열기 실패:", err);
      window.pbEditor.showMessage({
        type: 'error',
        message: '파일을 열 수 없습니다.',
        detail: String((err && err.message) || err)
      });
    }
  }
}

module.exports = App;
