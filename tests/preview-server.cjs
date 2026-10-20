// Development-only renderer fixture. Never packaged; no real file writes or native input.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const bridge = `
(()=>{
 const listeners={}, docs=new Map(); let seq=0;
 const make=(type,content,filePath=null)=>{const d={id:'preview-'+(++seq),type,content,saved:content,filePath,snapshot:null};docs.set(d.id,d);return d;};
 make('md','# PB Editor\\n\\n**Markdown** 미리보기\\n\\n| 키 | 값 |\\n|---|---|\\n| theme | light |','README.md');
 make('json','{"name":"PB Editor","version":1,"description":null,"editor":{"theme":"light","fontSize":14,"wordWrap":false},"files":["README.md","response.json"]}','workspace.json');
 make('json','{"ok":true,"id":9007199254740993,"items":[{"name":"한글","value":1.00e+20}]}','response.json');
 const api={bootstrap:async()=>({windowId:1,documents:[...docs.values()]}),notifyReady(){},createDocument:async type=>make(type,''),syncDocument:async d=>{const t=docs.get(d.id);t.content=d.snapshot.content;t.snapshot=d.snapshot;return {saved:t.saved};},openDocument:async()=>({}),chooseFiles:async()=>{},saveDocument:async d=>{const t=docs.get(d.id);t.saved=d.content;return {saved:true,savedContent:d.content,filePath:t.filePath||'document.'+t.type};},closeDocument:async id=>{const t=docs.get(id);if(t.content!==t.saved&&!confirm('변경 내용을 버릴까요?'))return false;docs.delete(id);return true;},reloadDocument:async()=>false,moveDocument:async()=>{throw Error('렌더러 미리보기에서는 네이티브 창 이동을 실행하지 않습니다.');},listWindows:async()=>[],getPathForFile:f=>f.name,setTabGeometry(){},startDrag:async()=>true,updateDrag(){},endDrag:async()=>({moved:false}),respond(){},showMessage:async data=>alert(data.message)};
 for(const name of ['Request','Recover','Activate','Remove','Unlock','Saved','FileChanged','Error','TabHint'])api['on'+name]=fn=>{listeners[name]=fn;};
 window.pbEditor=api;
})();`;
http.createServer((req,res)=>{
 const requested=decodeURIComponent(req.url.split('?')[0]);
 if(requested.includes('..')){res.writeHead(403);res.end();return;}
 const file=path.join(root,requested==='/'?'popup.html':requested);
 try{let data=fs.readFileSync(file);const ext=path.extname(file);res.setHeader('Content-Type',ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css':ext==='.js'?'application/javascript':ext==='.svg'?'image/svg+xml':'application/octet-stream');
 if(ext==='.html')data=data.toString().replace('<script src="lib/marked.min.js">','<script>'+bridge+'</script><script src="lib/marked.min.js">');res.end(data);
 }catch{res.writeHead(404);res.end();}
}).listen(8772,'127.0.0.1',()=>console.log('Renderer fixture http://127.0.0.1:8772/'));
