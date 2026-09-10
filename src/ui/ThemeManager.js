class ThemeManager {
  constructor() {
    this.switchInput = document.getElementById('themeSwitch');
    this.darkIcon = document.getElementById('themeDarkIcon');
    this.lightIcon = document.getElementById('themeLightIcon');
    this.modeText = document.getElementById('themeModeText');
    this.currentTheme = 'light';
  }

  init() {
    const savedTheme = localStorage.getItem('pb-editor-theme') || 'light';
    this.setTheme(savedTheme, false);

    if (this.switchInput) {
      this.switchInput.addEventListener('change', (e) => {
        this.setTheme(e.target.checked ? 'dark' : 'light');
      });
    }

    // 전역 onThemeSwitchChange 핸들러 지원 (HTML 마크업 호환)
    window.onThemeSwitchChange = (e) => {
      const isDark = e && e.target ? e.target.checked : this.switchInput.checked;
      this.setTheme(isDark ? 'dark' : 'light');
    };
  }

  setTheme(theme, save = true) {
    this.currentTheme = theme === 'dark' ? 'dark' : 'light';
    const isDark = this.currentTheme === 'dark';

    if (isDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }

    if (this.switchInput) {
      this.switchInput.checked = isDark;
    }

    if (this.darkIcon) {
      this.darkIcon.classList.toggle('active', isDark);
    }
    if (this.lightIcon) {
      this.lightIcon.classList.toggle('active', !isDark);
    }
    if (this.modeText) {
      this.modeText.textContent = isDark ? '다크 모드' : '라이트 모드';
    }

    if (save) {
      localStorage.setItem('pb-editor-theme', this.currentTheme);
    }
  }

  getTheme() {
    return this.currentTheme;
  }
}

module.exports = ThemeManager;
