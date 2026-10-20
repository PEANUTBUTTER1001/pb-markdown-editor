const App = require('./src/App');

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(error => { document.getElementById('status-message').textContent = '초기화 실패: ' + error.message; console.error(error); });
});
