const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_TITLE = 'PB Markdown Editor';
const UNTITLED = '제목 없음';

// 이 앱이 다루는 확장자. 렌더러가 임의 경로의 아무 파일이나 읽지 못하도록 제한한다.
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

let mainWindow = null;

// 렌더러가 알려주는 현재 문서 상태. 창 제목과 종료 확인에 사용한다.
const documentState = {
  filePath: null,
  isDirty: false
};

// 종료 확인을 이미 마쳤음을 표시. close 핸들러의 재진입을 막는다.
let isClosingConfirmed = false;

// 렌더러가 준비되기 전에 도착한 열기 요청을 보관한다. (IPC 레이스 방지)
let isRendererReady = false;
let pendingOpenPath = null;

function isMarkdownPath(filePath) {
  return (
    typeof filePath === 'string' &&
    MARKDOWN_EXTENSIONS.includes(path.extname(filePath).toLowerCase())
  );
}

/**
 * 실행 인자에서 열어야 할 마크다운 파일 경로를 찾는다.
 * Electron 옵션 플래그와 개발 모드의 '.' 인자를 제외하고, 실제 존재하는 파일만 채택한다.
 * @param {string[]} argv
 * @returns {string|null}
 */
function extractMarkdownPath(argv) {
  const candidates = (argv || [])
    .slice(1) // argv[0] 은 실행 파일 경로
    .filter((arg) => typeof arg === 'string' && arg !== '.' && !arg.startsWith('-'));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isMarkdownPath(resolved) && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

/** 파일을 읽는다. UTF-8 BOM 이 있으면 제거한다. */
function readMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function updateWindowTitle() {
  if (!mainWindow) return;
  const fileName = documentState.filePath ? path.basename(documentState.filePath) : UNTITLED;
  mainWindow.setTitle(`${documentState.isDirty ? '*' : ''}${fileName} - ${APP_TITLE}`);
}

/** 렌더러가 준비된 뒤에 열기 요청을 보낸다. 준비 전이면 보관했다가 전달한다. */
function openFileInRenderer(filePath) {
  if (!mainWindow || !filePath) return;
  if (!isRendererReady) {
    pendingOpenPath = filePath;
    return;
  }
  mainWindow.webContents.send('open-file', filePath);
}

/**
 * 렌더러에 저장을 요청하고 결과를 기다린다.
 * 렌더러만 현재 편집 중인 내용을 알고 있으므로 왕복이 필요하다.
 * @returns {Promise<{saved: boolean}>}
 */
function requestRendererSave() {
  return new Promise((resolve) => {
    ipcMain.once('save-result', (_event, result) => resolve(result || { saved: false }));
    mainWindow.webContents.send('request-save');
  });
}

/**
 * 미저장 변경이 있으면 3지선다로 확인한다.
 * @returns {Promise<boolean>} 진행해도 되면 true, 취소면 false
 */
async function confirmDiscardChanges() {
  if (!documentState.isDirty) return true;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['저장', '저장 안 함', '취소'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: '저장하지 않은 변경 사항',
    message: '변경 사항을 저장하시겠습니까?',
    detail: '저장하지 않으면 변경 내용이 사라집니다.'
  });

  if (response === 2) return false; // 취소
  if (response === 1) return true;  // 저장 안 함

  const result = await requestRendererSave();
  return !!result.saved; // 저장 대화상자를 취소했다면 진행하지 않는다
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false, // 창을 처음에 숨김
    backgroundColor: '#f6f8fa', // 기본 배경색 지정으로 깜빡임 방지
    icon: path.join(__dirname, 'assets', 'icon.ico'), // 앱 아이콘 설정
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  // 상대 경로는 앱 경로 기준으로 해석되므로 __dirname 을 명시한다.
  mainWindow.loadFile(path.join(__dirname, 'popup.html'));

  // 화면이 완전히 렌더링된 후에 창을 띄움
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    updateWindowTitle();
  });

  // 미저장 변경이 있으면 종료 전에 확인한다.
  mainWindow.on('close', (event) => {
    if (isClosingConfirmed || !documentState.isDirty) return;

    event.preventDefault();
    confirmDiscardChanges().then((canClose) => {
      if (!canClose) return;
      isClosingConfirmed = true;
      mainWindow.close();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isRendererReady = false;
  });
}

// 단일 인스턴스로만 동작한다. .md 파일을 여러 번 더블클릭해도 창이 늘어나지 않는다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', async (_event, argv) => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();

    const filePath = extractMarkdownPath(argv);
    if (!filePath) return;

    // 편집 중인 내용이 있으면 먼저 확인한다.
    if (await confirmDiscardChanges()) {
      openFileInRenderer(filePath);
    }
  });

  app.whenReady().then(() => {
    // 파일 읽기. 모든 fs 접근은 메인 프로세스에서만 이루어진다.
    ipcMain.handle('file:read', async (_event, filePath) => {
      if (!isMarkdownPath(filePath)) {
        throw new Error('InvalidFileType');
      }
      return readMarkdownFile(filePath);
    });

    // 파일 저장. filePath 가 없으면 저장 대화상자를 띄운다.
    ipcMain.handle('file:save', async (_event, { content, filePath }) => {
      let targetPath = filePath;

      if (!targetPath) {
        const { canceled, filePath: chosenPath } = await dialog.showSaveDialog(mainWindow, {
          title: '마크다운 파일 저장',
          defaultPath: documentState.filePath || 'document.md',
          filters: [{ name: 'Markdown', extensions: ['md'] }]
        });
        if (canceled || !chosenPath) {
          return { saved: false };
        }
        targetPath = chosenPath;
      }

      if (!isMarkdownPath(targetPath)) {
        throw new Error('InvalidFileType');
      }

      fs.writeFileSync(targetPath, content, 'utf-8');
      return { saved: true, filePath: targetPath };
    });

    // 렌더러가 알려주는 문서 상태를 창 제목에 반영한다.
    ipcMain.on('window:set-state', (_event, state) => {
      documentState.filePath = (state && state.filePath) || null;
      documentState.isDirty = !!(state && state.isDirty);
      updateWindowTitle();
    });

    // 렌더러 준비 완료. 보관해 둔 열기 요청이 있으면 지금 전달한다.
    ipcMain.on('renderer:ready', () => {
      isRendererReady = true;
      if (pendingOpenPath && mainWindow) {
        const filePath = pendingOpenPath;
        pendingOpenPath = null;
        mainWindow.webContents.send('open-file', filePath);
      }
    });

    // 드래그 앤 드롭 등 렌더러에서 시작한 문서 교체 전 확인
    ipcMain.handle('dialog:confirm-discard', async () => confirmDiscardChanges());

    // 렌더러의 오류 안내를 네이티브 대화상자로 표시한다.
    ipcMain.handle('dialog:message', async (_event, options) => {
      const { type, message, detail } = options || {};
      await dialog.showMessageBox(mainWindow, {
        type: type || 'info',
        buttons: ['확인'],
        noLink: true,
        title: APP_TITLE,
        message: message || '',
        detail: detail || ''
      });
    });

    createWindow();

    // 연결 프로그램으로 실행된 경우. 렌더러 준비 전이면 큐에 보관된다.
    openFileInRenderer(extractMarkdownPath(process.argv));

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
