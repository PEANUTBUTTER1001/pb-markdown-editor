// 파일 접근은 전부 메인 프로세스가 수행한다.
// 이 클래스는 preload 가 노출한 브릿지(window.pbEditor)를 감싸는 얇은 래퍼다.
class FileService {
  /**
   * @param {string} content 저장할 내용
   * @param {string|null} filePath 없으면 저장 대화상자가 열린다
   * @returns {Promise<{saved: boolean, filePath?: string}>}
   */
  async saveFile(content, filePath = null) {
    return window.pbEditor.saveFile(content, filePath);
  }

  /**
   * @param {string} filePath
   * @returns {Promise<string>} 파일 내용
   */
  async readFile(filePath) {
    return window.pbEditor.readFile(filePath);
  }
}

module.exports = FileService;
