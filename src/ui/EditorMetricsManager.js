class EditorMetricsManager {
  /**
   * @param {HTMLTextAreaElement} textarea
   * @param {HTMLElement} lineNumbersEl
   * @param {HTMLElement} statusCountsEl
   */
  constructor(textarea, lineNumbersEl, statusCountsEl) {
    this.textarea = textarea;
    this.lineNumbersEl = lineNumbersEl;
    this.statusCountsEl = statusCountsEl;

    this.mirrorEl = null;
    this.animationFrameId = null;
    this.LINE_HEIGHT = 21; // 14px * 1.5
  }

  init() {
    this.createMirror();
    this.bindEvents();
    this.update();
  }

  createMirror() {
    this.mirrorEl = document.createElement('div');
    this.mirrorEl.id = 'editor-mirror';
    this.mirrorEl.style.position = 'absolute';
    this.mirrorEl.style.top = '-99999px';
    this.mirrorEl.style.left = '-99999px';
    this.mirrorEl.style.visibility = 'hidden';
    this.mirrorEl.style.pointerEvents = 'none';
    this.mirrorEl.style.fontFamily = getComputedStyle(this.textarea).fontFamily;
    this.mirrorEl.style.fontSize = '14px';
    this.mirrorEl.style.lineHeight = '1.5';
    this.mirrorEl.style.whiteSpace = 'pre-wrap';
    this.mirrorEl.style.wordBreak = 'break-word';
    this.mirrorEl.style.boxSizing = 'border-box';
    document.body.appendChild(this.mirrorEl);
  }

  bindEvents() {
    // 텍스트 변경 시 줄 번호 및 글자 수 갱신
    this.textarea.addEventListener('input', () => this.scheduleUpdate());

    // 에디터 수직 스크롤 시 줄 번호 거터도 수직 스크롤 동기화
    this.textarea.addEventListener('scroll', () => {
      if (this.lineNumbersEl) {
        this.lineNumbersEl.scrollTop = this.textarea.scrollTop;
      }
    });

    // 창 크기 변경 시 줄바꿈 높이 재계산
    window.addEventListener('resize', () => this.scheduleUpdate());
  }

  scheduleUpdate() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = requestAnimationFrame(() => {
      this.update();
      this.animationFrameId = null;
    });
  }

  update() {
    const text = this.textarea.value || '';
    this.updateCounts(text);
    this.updateLineNumbers(text);
  }

  updateCounts(text) {
    if (!this.statusCountsEl) return;
    const totalChars = text.length;
    const nonSpaceChars = text.replace(/\s/g, '').length;
    const lines = text.split('\n');
    const totalLines = text === '' ? 1 : lines.length;

    this.statusCountsEl.textContent = `글자 수: ${totalChars.toLocaleString()}자 (공백 제외: ${nonSpaceChars.toLocaleString()}자) | 줄 수: ${totalLines.toLocaleString()}줄`;
  }

  updateLineNumbers(text) {
    if (!this.lineNumbersEl || !this.mirrorEl) return;

    const lines = text.split('\n');
    const count = lines.length;

    // 미러 div 의 폭을 textarea 의 실제 텍스트 영역 폭과 일치시킴
    const style = getComputedStyle(this.textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 16;
    const paddingRight = parseFloat(style.paddingRight) || 16;
    const clientWidth = this.textarea.clientWidth;
    const contentWidth = Math.max(50, clientWidth - paddingLeft - paddingRight);
    this.mirrorEl.style.width = contentWidth + 'px';

    // 각 줄의 높이를 측정하여 줄 번호 요소 생성
    const fragment = document.createDocumentFragment();
    this.mirrorEl.innerHTML = '';

    // 대량 줄인 경우 미러 div를 효율적으로 구성
    for (let i = 0; i < count; i++) {
      const lineDiv = document.createElement('div');
      lineDiv.textContent = lines[i] || ' ';
      this.mirrorEl.appendChild(lineDiv);
    }

    const mirrorChildren = this.mirrorEl.children;
    for (let i = 0; i < count; i++) {
      const numDiv = document.createElement('div');
      numDiv.className = 'line-number';
      numDiv.textContent = String(i + 1);
      
      const height = mirrorChildren[i] ? mirrorChildren[i].offsetHeight : this.LINE_HEIGHT;
      numDiv.style.height = height + 'px';
      fragment.appendChild(numDiv);
    }

    this.lineNumbersEl.innerHTML = '';
    this.lineNumbersEl.appendChild(fragment);

    // 스크롤 위치 재동기화
    this.lineNumbersEl.scrollTop = this.textarea.scrollTop;
  }
}

module.exports = EditorMetricsManager;
