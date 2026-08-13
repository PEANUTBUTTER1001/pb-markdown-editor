// 원격/인라인 리소스로 간주하여 경로 변환을 하지 않는 스킴
const PASSTHROUGH_SCHEME = /^(?:https?|data|blob|file):/i;

// Windows 드라이브 절대 경로 (C:/, D:/ ...)
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:\//;

// DOMPurify 기본 정책에는 file: 스킴이 없어 로컬 이미지의 src가 제거된다.
// 기본 정규식에 file: 만 추가한다. (상대 경로 허용 규칙은 그대로 유지)
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

class MarkdownService {
  constructor() {
    // marked and DOMPurify are loaded via script tags in popup.html
    // so they are globally available.
    marked.setOptions({
      breaks: true,
      gfm: true
    });

    // 이미지 상대 경로를 해석할 기준 폴더. 파일을 열기 전에는 없다.
    this.baseDir = '';

    // file: 허용은 이미지 표시를 위한 것이므로, 링크(a href)에서는 다시 차단한다.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && /^file:/i.test(node.getAttribute('href') || '')) {
        node.removeAttribute('href');
      }
    });
  }

  /**
   * 현재 열려 있는 파일 경로를 알려준다. 이미지 상대 경로의 기준 폴더가 된다.
   * @param {string} filePath 파일이 없으면 빈 문자열
   */
  setCurrentFilePath(filePath) {
    if (!filePath) {
      this.baseDir = '';
      return;
    }
    const normalized = String(filePath).replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    this.baseDir = lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
  }

  /**
   * 마크다운의 이미지 경로를 브라우저가 로드할 수 있는 file:// URL로 변환한다.
   * @returns {string|null} 변환이 필요 없거나 불가능하면 null
   */
  toFileUrl(rawSrc) {
    const src = String(rawSrc || '').trim();
    if (!src) return null;

    // http/https/data/blob/file 은 이미 유효한 URL이므로 그대로 둔다.
    if (PASSTHROUGH_SCHEME.test(src)) return null;

    // marked 는 링크 대상을 퍼센트 인코딩한다. (`C:\` -> `C:%5C`, 공백 -> `%20`)
    // 경로 판정과 재인코딩을 위해 먼저 원래 문자열로 되돌린다.
    let decoded = src;
    try {
      decoded = decodeURIComponent(src);
    } catch (err) {
      // 잘못된 퍼센트 시퀀스는 원본을 그대로 쓴다.
    }

    let normalized = decoded.replace(/\\/g, '/');

    // 프로토콜 상대 URL(//host/...)과 UNC 경로(\\server\...)는 변환 대상이 아니다.
    if (normalized.startsWith('//')) return null;

    if (!WINDOWS_ABSOLUTE.test(normalized)) {
      // 상대 경로인데 기준 폴더가 없으면 해석할 수 없다. (저장 전 새 문서)
      if (!this.baseDir) return null;
      normalized = `${this.baseDir.replace(/\/+$/, '')}/${normalized}`;
    }

    // . 과 .. 세그먼트 정리
    const segments = [];
    for (const segment of normalized.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    if (segments.length === 0) return null;

    // 한글·공백 등이 포함된 경로를 위해 세그먼트 단위로 인코딩한다.
    // 첫 세그먼트가 드라이브 문자(C:)면 콜론을 살려야 하므로 인코딩에서 제외한다.
    const encoded = segments.map((segment, index) =>
      index === 0 && /^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)
    );

    return `file:///${encoded.join('/')}`;
  }

  render(rawMarkdown) {
    const rawHtml = marked.parse(rawMarkdown || '');

    // 스크립트를 실행하지 않는 비활성 문서에서 후처리한다.
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');

    // 이미지 경로 정규화
    doc.querySelectorAll('img').forEach((img) => {
      const resolved = this.toFileUrl(img.getAttribute('src'));
      if (resolved) {
        img.setAttribute('src', resolved);
      }
    });

    // 넓은 표가 페이지 전체를 밀어내지 않도록 가로 스크롤 래퍼로 감싼다.
    doc.querySelectorAll('table').forEach((table) => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'table-wrapper';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });

    return DOMPurify.sanitize(doc.body.innerHTML, { ALLOWED_URI_REGEXP });
  }
}

module.exports = MarkdownService;
