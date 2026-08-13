const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 렌더러(화면)에는 아래 API만 노출한다.
// fs 나 ipcRenderer 자체는 노출하지 않으며, 파일 접근은 전부 메인 프로세스가 수행한다.
contextBridge.exposeInMainWorld('pbEditor', {
  /**
   * 마크다운 파일을 읽는다.
   * @param {string} filePath
   * @returns {Promise<string>} 파일 내용
   */
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  /**
   * 마크다운 파일을 저장한다.
   * filePath 가 없으면 메인 프로세스가 저장 대화상자를 띄운다.
   * @param {string} content
   * @param {string|null} filePath
   * @returns {Promise<{saved: boolean, filePath?: string}>}
   */
  saveFile: (content, filePath) =>
    ipcRenderer.invoke('file:save', { content, filePath: filePath || null }),

  /**
   * 드래그 앤 드롭된 File 객체의 실제 경로를 얻는다.
   * File.path 는 Electron 32에서 제거되어 이 API로 대체되었다.
   * @param {File} file
   * @returns {string}
   */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  /**
   * OS에서 .md 파일을 더블클릭해 실행된 경우의 열기 요청을 구독한다.
   * @param {(filePath: string) => void} callback
   */
  onOpenFile: (callback) => {
    ipcRenderer.on('open-file', (_event, filePath) => callback(filePath));
  },

  /**
   * 현재 문서 상태를 메인 프로세스에 알린다. 창 제목과 종료 확인에 사용된다.
   * @param {{filePath: string|null, isDirty: boolean}} state
   */
  setDocumentState: (state) => ipcRenderer.send('window:set-state', state),

  /**
   * 종료 확인 대화상자에서 "저장"을 선택했을 때의 저장 요청을 구독한다.
   * @param {() => void} callback
   */
  onRequestSave: (callback) => {
    ipcRenderer.on('request-save', () => callback());
  },

  /**
   * onRequestSave 요청에 대한 처리 결과를 회신한다.
   * @param {{saved: boolean}} result
   */
  sendSaveResult: (result) => ipcRenderer.send('save-result', result),

  /**
   * 오류 등을 네이티브 대화상자로 표시한다.
   * @param {{type?: string, message: string, detail?: string}} options
   */
  showMessage: (options) => ipcRenderer.invoke('dialog:message', options),

  /**
   * 현재 문서를 버려도 되는지 확인한다. 미저장 변경이 있으면 3지선다 대화상자가 뜬다.
   * @returns {Promise<boolean>} 진행해도 되면 true
   */
  confirmDiscard: () => ipcRenderer.invoke('dialog:confirm-discard'),

  /**
   * 렌더러 초기화 완료를 알린다. 이 신호 전에 도착한 열기 요청은 메인이 보관했다가 전달한다.
   */
  notifyReady: () => ipcRenderer.send('renderer:ready')
});
