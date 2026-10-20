const { EditorState, Compartment } = require('@codemirror/state');
const { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } = require('@codemirror/view');
const { history, historyField, defaultKeymap, historyKeymap, indentWithTab, isolateHistory, undo, redo } = require('@codemirror/commands');
const { syntaxHighlighting, HighlightStyle, indentUnit } = require('@codemirror/language');
const { json } = require('@codemirror/lang-json');
const { tags } = require('@lezer/highlight');
const palette = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--editor-color)' }, { tag: tags.string, color: 'var(--json-string)' },
  { tag: tags.number, color: 'var(--json-number)' }, { tag: tags.bool, color: 'var(--json-boolean)' },
  { tag: tags.null, color: 'var(--json-null)' }, { tag: tags.punctuation, color: 'var(--editor-color)' }
]);
class SourceEditor {
  constructor(parent, onChange, onSelection) {
    this.parent = parent; this.onChange = onChange; this.onSelection = onSelection;
    this.editability = new Compartment();
    this.view = new EditorView({ parent, state: this.createState('', 'md') });
  }
  extensions(type, eol = '\n') {
    return [history(), lineNumbers(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), indentUnit.of('  '), EditorState.lineSeparator.of(eol),
      type === 'json' ? [json(), syntaxHighlighting(palette)] : EditorView.lineWrapping,
      this.editability.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
      EditorView.contentAttributes.of({ 'aria-label': '원본 코드', spellcheck: 'false' }),
      EditorView.updateListener.of(update => { if (update.docChanged) this.onChange(this.text()); if (update.selectionSet || update.docChanged) this.onSelection(); }),
      EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--editor-color)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, "Malgun Gothic", monospace', fontSize: '14px', lineHeight: '1.5' },
        '.cm-content': { padding: '12px 0 70px' }, '.cm-line': { padding: '0 16px' },
        '.cm-gutters': { backgroundColor: 'var(--gutter-bg)', color: 'var(--gutter-color)', borderColor: 'var(--gutter-border)' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--json-selection)' },
        '.cm-cursor': { borderLeftColor: 'var(--editor-color)' }, '&.cm-focused': { outline: 'none' } })];
  }
  createState(text, type, serialized) {
    const config = { doc: text, extensions: this.extensions(type, text.includes('\r\n') ? '\r\n' : '\n') };
    return serialized ? EditorState.fromJSON(serialized, config, { history: historyField }) : EditorState.create(config);
  }
  load(tab) {
    this.view.setState(tab.editorState || this.createState(tab.content, tab.type, tab.snapshot?.editor));
    this.view.scrollDOM.scrollTop = tab.scrollTop || 0; this.view.scrollDOM.scrollLeft = tab.scrollLeft || 0;
    this.lock(!!tab.locked);
  }
  capture(tab) {
    tab.editorState = this.view.state; tab.content = this.text(); tab.scrollTop = this.view.scrollDOM.scrollTop; tab.scrollLeft = this.view.scrollDOM.scrollLeft;
  }
  serialize(tab) { return (tab.editorState || this.createState(tab.content, tab.type, tab.snapshot?.editor)).toJSON({ history: historyField }); }
  text() { return this.view.state.sliceDoc(); }
  lock(locked) { this.view.dispatch({ effects: this.editability.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) }); }
  replace(text) { if (text !== this.text()) this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, annotations: isolateHistory.of('full'), userEvent: 'input' }); }
  select(from, to, focus = true) {
    const text = this.text(); from = text.slice(0, from).replace(/\r\n/g, '\n').length; to = text.slice(0, to).replace(/\r\n/g, '\n').length;
    this.view.dispatch({ selection: { anchor: Math.min(from, this.view.state.doc.length), head: Math.min(to, this.view.state.doc.length) }, scrollIntoView: true });
    if (focus) this.view.focus();
  }
  undo() { undo(this.view); } redo() { redo(this.view); }
  find(query) {
    if (!query) return false; const text = this.text(), at = this.view.state.selection.main.to;
    let start = text.indexOf(query, at); if (start < 0) start = text.indexOf(query); if (start < 0) return false;
    this.select(start, start + query.length); return true;
  }
}
module.exports = SourceEditor;
