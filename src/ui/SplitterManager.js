class SplitterManager {
  constructor(container, splitter, editorPane, previewPane) {
    this.container = container;
    this.splitter = splitter;
    this.editorPane = editorPane;
    this.previewPane = previewPane;
    
    this.isDragging = false;
    this.isColumn = false;
    this.isReversed = false;
    
    // Create tooltip for percentage
    this.tooltip = document.createElement('div');
    this.tooltip.style.position = 'absolute';
    this.tooltip.style.padding = '4px 8px';
    this.tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    this.tooltip.style.color = 'white';
    this.tooltip.style.borderRadius = '4px';
    this.tooltip.style.fontSize = '12px';
    this.tooltip.style.pointerEvents = 'none';
    this.tooltip.style.display = 'none';
    this.tooltip.style.zIndex = '1000';
    document.body.appendChild(this.tooltip);

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUpOrBlur = this.onMouseUpOrBlur.bind(this);
  }

  init() {
    this.splitter.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUpOrBlur);
    window.addEventListener('blur', this.onMouseUpOrBlur);
  }

  onMouseDown(e) {
    this.isDragging = true;
    this.splitter.classList.add('active');
    this.isColumn = this.container.classList.contains('layout-column') || 
                    this.container.classList.contains('layout-column-reverse') || 
                    this.container.classList.contains('column');
    this.isReversed = this.container.classList.contains('layout-row-reverse') || 
                      this.container.classList.contains('layout-column-reverse');
    document.body.style.userSelect = 'none';
    
    this.tooltip.style.display = 'block';
  }

  onMouseMove(e) {
    if (!this.isDragging) return;
    
    const rect = this.container.getBoundingClientRect();
    let editorPercentage = 50;
    let previewPercentage = 50;

    if (this.isColumn) {
      if (this.isReversed) {
        // column-reverse: 프리뷰 상단, 에디터 하단
        let previewHeight = e.clientY - rect.top;
        if (previewHeight < 50) previewHeight = 50;
        if (previewHeight > rect.height - 50) previewHeight = rect.height - 50;
        previewPercentage = (previewHeight / rect.height) * 100;
        editorPercentage = 100 - previewPercentage;
      } else {
        // column: 에디터 상단, 프리뷰 하단
        let editorHeight = e.clientY - rect.top;
        if (editorHeight < 50) editorHeight = 50;
        if (editorHeight > rect.height - 50) editorHeight = rect.height - 50;
        editorPercentage = (editorHeight / rect.height) * 100;
        previewPercentage = 100 - editorPercentage;
      }
    } else {
      if (this.isReversed) {
        // row-reverse: 프리뷰 좌측, 에디터 우측
        let previewWidth = e.clientX - rect.left;
        if (previewWidth < 50) previewWidth = 50;
        if (previewWidth > rect.width - 50) previewWidth = rect.width - 50;
        previewPercentage = (previewWidth / rect.width) * 100;
        editorPercentage = 100 - previewPercentage;
      } else {
        // row: 에디터 좌측, 프리뷰 우측
        let editorWidth = e.clientX - rect.left;
        if (editorWidth < 50) editorWidth = 50;
        if (editorWidth > rect.width - 50) editorWidth = rect.width - 50;
        editorPercentage = (editorWidth / rect.width) * 100;
        previewPercentage = 100 - editorPercentage;
      }
    }

    this.editorPane.style.flex = `0 0 ${editorPercentage}%`;
    this.previewPane.style.flex = `0 0 ${previewPercentage}%`;

    // Update tooltip
    const p1 = Math.round(editorPercentage);
    const p2 = Math.round(previewPercentage);
    this.tooltip.textContent = `에디터: ${p1}% / 프리뷰: ${p2}%`;
    this.tooltip.style.left = e.clientX + 15 + 'px';
    this.tooltip.style.top = e.clientY + 15 + 'px';
  }

  onMouseUpOrBlur() {
    if (this.isDragging) {
      this.isDragging = false;
      this.splitter.classList.remove('active');
      document.body.style.userSelect = '';
      this.tooltip.style.display = 'none';
    }
  }
}

module.exports = SplitterManager;
