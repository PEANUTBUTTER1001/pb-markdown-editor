const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const css = fs.readFileSync(require('node:path').join(__dirname, '../popup.css'), 'utf8');
function colors(selector) { const block = css.slice(css.indexOf(selector)); const body = block.slice(block.indexOf('{') + 1, block.indexOf('}')); return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]])); }
function luminance(hex) { const values = [1, 3, 5].map(at => { const n = parseInt(hex.slice(at, at + 2), 16) / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; }
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
test('type colors meet 4.5:1 against source, badges and group row backgrounds in both themes', () => {
  for (const selector of [':root', 'body.dark-theme']) {
    const c = colors(selector);
    for (const type of ['object', 'array', 'string', 'number', 'boolean', 'null']) {
      for (const background of [c['preview-bg'], c['editor-bg'], ...(type === 'object' || type === 'array' ? [c['json-' + type + '-bg']] : [])]) {
        assert.ok(contrast(c['json-' + type], background) >= 4.5, selector + ' ' + type + ' contrast ' + contrast(c['json-' + type], background));
      }
    }
  }
});
