const { randomUUID } = require('crypto');
const path = require('path');

const supported = (p) => typeof p === 'string' && ['.md', '.markdown', '.json'].includes(path.extname(p).toLowerCase());
const canonical = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const typeFor = (p) => path.extname(p || '').toLowerCase() === '.json' ? 'json' : 'md';

class DocumentStore {
  constructor() { this.documents = new Map(); }
  create(owner, type = 'md', content = '', filePath = null) {
    const doc = { id: randomUUID(), owner, type, content, saved: content, filePath, snapshot: null, busy: null };
    this.documents.set(doc.id, doc);
    return doc;
  }
  owned(owner, id) {
    const doc = this.documents.get(id);
    if (!doc || doc.owner !== owner) throw new Error('DocumentNotOwned');
    return doc;
  }
  findPath(p) { return [...this.documents.values()].find(d => d.filePath && canonical(d.filePath) === canonical(p)); }
  list(owner) { return [...this.documents.values()].filter(d => d.owner === owner); }
  sync(owner, id, snapshot) {
    const doc = this.owned(owner, id);
    if (doc.busy === 'move') throw new Error('DocumentMoving');
    if (!snapshot || typeof snapshot.content !== 'string') throw new Error('InvalidDocumentState');
    doc.content = snapshot.content;
    doc.snapshot = snapshot;
    return doc;
  }
  dirty(doc) { return doc.content !== doc.saved; }
  public(doc) { return { id: doc.id, type: doc.type, content: doc.content, saved: doc.saved, filePath: doc.filePath, snapshot: doc.snapshot }; }
}
module.exports = { DocumentStore, supported, canonical, typeFor };
