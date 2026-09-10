class LayoutManager {
  /**
   * @param {HTMLElement} container
   * @param {HTMLElement} editorPane
   * @param {HTMLElement} previewPane
   * @param {HTMLButtonElement} btnToggle
   * @param {{btnEditor?: HTMLElement, btnSplit?: HTMLElement, btnPreview?: HTMLElement}} viewButtons
   */
  constructor(container, editorPane, previewPane, btnToggle, viewButtons = {}) {
    this.container = container;
    this.editorPane = editorPane;
    this.previewPane = previewPane;
    this.btnToggle = btnToggle;
    this.viewButtons = viewButtons;

    // 4단계 레이아웃 모드:
    // 0: row (에디터 좌 / 프리뷰 우)
    // 1: row-reverse (프리뷰 좌 / 에디터 우)
    // 2: column (에디터 상 / 프리뷰 하)
    // 3: column-reverse (프리뷰 상 / 에디터 하)
    this.layoutModes = ['row', 'row-reverse', 'column', 'column-reverse'];
    this.layoutIndex = 0;

    // 뷰 모드: 'split' (기본), 'editor', 'preview'
    this.viewMode = 'split';
  }

  init() {
    if (this.btnToggle) {
      this.btnToggle.addEventListener('click', () => this.cycleLayout());
    }

    if (this.viewButtons.btnEditor) {
      this.viewButtons.btnEditor.addEventListener('click', () => this.setViewMode('editor'));
    }
    if (this.viewButtons.btnSplit) {
      this.viewButtons.btnSplit.addEventListener('click', () => this.setViewMode('split'));
    }
    if (this.viewButtons.btnPreview) {
      this.viewButtons.btnPreview.addEventListener('click', () => this.setViewMode('preview'));
    }

    this.applyLayout();
    this.applyViewMode();
  }

  cycleLayout() {
    if (this.viewMode !== 'split') return; // 단일 뷰일 때는 동작하지 않음
    this.layoutIndex = (this.layoutIndex + 1) % this.layoutModes.length;
    this.applyLayout();

    // 레이아웃 변경 시 50:50으로 초기화
    this.editorPane.style.flex = '1';
    this.previewPane.style.flex = '1';
  }

  applyLayout() {
    // 기존 레이아웃 클래스 제거
    this.container.classList.remove('layout-row', 'layout-row-reverse', 'layout-column', 'layout-column-reverse', 'column');

    const currentMode = this.layoutModes[this.layoutIndex];
    this.container.classList.add(`layout-${currentMode}`);
    if (currentMode.startsWith('column')) {
      this.container.classList.add('column'); // 기존 호환용
    }

    this.container.style.flexDirection = currentMode;

    const titles = {
      'row': '상하/좌우 레이아웃 전환 (현재: 에디터 좌 / 프리뷰 우)',
      'row-reverse': '상하/좌우 레이아웃 전환 (현재: 프리뷰 좌 / 에디터 우)',
      'column': '상하/좌우 레이아웃 전환 (현재: 에디터 상 / 프리뷰 하)',
      'column-reverse': '상하/좌우 레이아웃 전환 (현재: 프리뷰 상 / 에디터 하)'
    };

    if (this.btnToggle) {
      this.btnToggle.title = titles[currentMode] || '상하/좌우 레이아웃 전환';
    }
  }

  setViewMode(mode) {
    if (['editor', 'split', 'preview'].indexOf(mode) === -1) return;
    this.viewMode = mode;
    this.applyViewMode();
  }

  applyViewMode() {
    this.container.classList.remove('view-editor', 'view-split', 'view-preview');
    this.container.classList.add(`view-${this.viewMode}`);

    // 버튼 활성 상태 표시
    if (this.viewButtons.btnEditor) {
      this.viewButtons.btnEditor.classList.toggle('active', this.viewMode === 'editor');
    }
    if (this.viewButtons.btnSplit) {
      this.viewButtons.btnSplit.classList.toggle('active', this.viewMode === 'split');
    }
    if (this.viewButtons.btnPreview) {
      this.viewButtons.btnPreview.classList.toggle('active', this.viewMode === 'preview');
    }

    // 단일 뷰일 때는 레이아웃 전환 버튼 비활성화
    if (this.btnToggle) {
      const isSplit = this.viewMode === 'split';
      this.btnToggle.disabled = !isSplit;
      if (!isSplit) {
        this.btnToggle.classList.add('disabled');
      } else {
        this.btnToggle.classList.remove('disabled');
      }
    }
  }

  getCurrentLayout() {
    return this.layoutModes[this.layoutIndex];
  }

  getCurrentViewMode() {
    return this.viewMode;
  }
}

module.exports = LayoutManager;
