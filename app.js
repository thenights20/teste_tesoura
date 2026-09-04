const form=document.querySelector('#open-form');
const urlInput=document.querySelector('#url');
const openButton=document.querySelector('#open-button');
const statusBox=document.querySelector('#status');
const viewer=document.querySelector('#viewer');
const player=document.querySelector('#player');
const imageViewer=document.querySelector('#image-viewer');
const currentTitle=document.querySelector('#current-title');
const albumTitle=document.querySelector('#album-title');
const position=document.querySelector('#position');
const count=document.querySelector('#count');
const playlist=document.querySelector('#playlist');
const prevButton=document.querySelector('#prev');
const nextButton=document.querySelector('#next');
const directUrlButton=document.querySelector('#direct-url');
const historyBox=document.querySelector('#history');
const clearHistoryButton=document.querySelector('#clear-history');

let items=[]; let currentIndex=0; let lastSubmittedUrl='';
const videoExt=/\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i;
const videoName=/\.(mp4|webm|mov|m4v|mkv)\b/i;
const itemPath=/\/(f|i|v)\/[A-Za-z0-9]+(?:$|[/?#])/i;
const bunkrDownload=/^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/(\d+)(?:[/?#]|$)/i;

function setStatus(m='',t=''){statusBox.hidden=!m;statusBox.textContent=m;statusBox.className=`status ${t}`.trim();}
function clean(v=''){return String(v).replace(/\s+/g,' ').trim();}
function norm(v,b){try{return new URL(v,b).href}catch{return null}}
function isHttps(v){try{return new URL(v).protocol==='https:'}catch{return false}}
function titleFromUrl(u){try{return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop()||'Vídeo').replace(/[-_]+/g,' ')}catch{return'Vídeo'}}
function docTitle(d){return clean(d.querySelector('meta[property="og:title"]')?.content||d.querySelector('meta[name="twitter:title"]')?.content||d.title||'Conteúdo')}
function downloadUrl(fileId){return /^\d+$/.test(String(fileId||''))?`https://dl.bunkr.cr/file/${fileId}`:''}
function isBunkrDownload(u){return bunkrDownload.test(String(u||'').trim())}

function extractPublicCandidates(html,pageUrl){
 const d=new DOMParser().parseFromString(html,'text/html'); const out=[]; const seen=new Set();
 const add=(raw,title='',kind='direct')=>{const u=norm(raw,pageUrl);if(!u||!isHttps(u)||seen.has(u))return;seen.add(u);out.push({url:u,title:clean(title)||titleFromUrl(u),kind,playable:true})};
 d.querySelectorAll('video[src],video source[src]').forEach(n=>add(n.getAttribute('src'),n.getAttribute('title')||docTitle(d)));
 d.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]').forEach(n=>add(n.content,docTitle(d)));
 d.querySelectorAll('iframe[src]').forEach(n=>add(n.getAttribute('src'),n.getAttribute('title')||docTitle(d),'embed'));
 d.querySelectorAll('a[href]').forEach(a=>{const u=norm(a.getAttribute('href'),pageUrl);if(u&&(videoExt.test(u)||isBunkrDownload(u)))add(u,a.textContent||docTitle(d),isBunkrDownload(u)?'download':'direct')});
 return {doc:d,title:docTitle(d),candidates:out};
}

function nearbyAnchor(node){
 if(!node)return null; if(node.matches?.('a[href]'))return node;
 const inner=node.querySelector?.('a[href]'); if(inner)return inner;
 const close=node.closest?.('a[href]'); if(close)return close;
 let s=node.previousElementSibling; for(let i=0;s&&i<4;i++,s=s.previousElementSibling){if(s.matches?.('a[href]'))return s;const a=s.querySelector?.('a[href]');if(a)return a}
 return node.parentElement?.querySelector?.('a[href]')||null;
}

function albumItems(doc,pageUrl){
 const base=new URL(pageUrl); const found=[]; const seen=new Set();
 function add(node,title=''){
  const holder=node?.closest?.('[data-file-id],[data-id]')||node;
  const fileId=holder?.getAttribute?.('data-file-id')||holder?.getAttribute?.('data-id')||'';
  const a=nearbyAnchor(node); const href=a?norm(a.getAttribute('href'),pageUrl):'';
  if(href){try{const u=new URL(href);if(u.protocol!=='https:'||u.hostname!==base.hostname||!itemPath.test(u.pathname+u.search))return}catch{return}}
  const text=clean(`${title} ${node?.textContent||''} ${a?.parentElement?.textContent||''}`);
  if(!videoName.test(text)&&!/^\/v\//i.test(href?new URL(href).pathname:''))return;
  const key=fileId?`id:${fileId}`:href; if(!key||seen.has(key))return; seen.add(key);
  found.push({key,title:clean(title)||text||`Vídeo ${found.length+1}`,sourcePage:href||pageUrl,fileId,download:downloadUrl(fileId)});
 }
 doc.querySelectorAll('.grid-videos_box-txt').forEach(n=>add(n,clean(n.textContent||'')));
 doc.querySelectorAll('[data-file-id],[data-id]').forEach(n=>{if(videoName.test(clean(n.textContent||n.parentElement?.textContent||'')))add(n,clean(n.textContent||''))});
 if(!found.length) doc.querySelectorAll('a[href]').forEach(a=>{const t=clean(a.parentElement?.textContent||a.textContent||'');if(videoName.test(t))add(a,t)});
 return found;
}

async function fetchPage(url){const r=await fetch(url,{mode:'cors',credentials:'omit',redirect:'follow',cache:'no-store'});if(!r.ok)throw new Error(`Falha HTTP ${r.status}`);return r}
async function resolveEntry(e){
 if(e.download)return {...e,url:e.download,kind:'download',playable:true};
 try{const r=await fetchPage(e.sourcePage);const type=(r.headers.get('content-type')||'').toLowerCase();if(type.startsWith('video/'))return {...e,url:r.url,kind:'direct',playable:true};const p=extractPublicCandidates(await r.text(),r.url||e.sourcePage);const c=p.candidates.find(x=>x.kind==='download')||p.candidates.find(x=>x.kind==='direct')||p.candidates.find(x=>x.kind==='embed');return {...e,url:c?.url||'',kind:c?.kind||'',playable:Boolean(c?.url)}}catch(err){return {...e,url:'',kind:'',playable:false,error:err?.message||'Falha'}}
}

async function discover(html,pageUrl){
 const p=extractPublicCandidates(html,pageUrl); const cards=albumItems(p.doc,pageUrl);
 if(!cards.length){const c=p.candidates.find(x=>x.kind==='download')||p.candidates[0];return {title:p.title,items:[{title:p.title,sourcePage:pageUrl,url:c?.url||'',kind:c?.kind||'',playable:Boolean(c?.url)}]}}
 setStatus(`Preparando ${cards.length} vídeo(s)…`);
 const resolved=await Promise.all(cards.map(resolveEntry));
 return {title:p.title,items:resolved};
}

function renderPlaylist(){playlist.innerHTML='';items.forEach((it,i)=>{const b=document.createElement('button');b.type='button';b.className=`media-item${i===currentIndex?' active':''}`;const th=document.createElement('span');th.className='thumb';th.textContent=it.playable?'▶':'—';const wrap=document.createElement('span');const n=document.createElement('span');n.className='media-name';n.textContent=it.title||`Vídeo ${i+1}`;const ty=document.createElement('span');ty.className='media-type';ty.textContent=it.kind==='download'?'Vídeo • link de arquivo':it.playable?(it.kind==='embed'?'Vídeo • player público':'Vídeo • fonte direta'):'Vídeo • identificado';wrap.append(n,ty);b.append(th,wrap);b.onclick=()=>selectItem(i,true);playlist.appendChild(b)})}
function resetPlayer(){player.pause();player.removeAttribute('src');player.load();imageViewer.innerHTML='';imageViewer.hidden=true}
function showEmbed(url){player.hidden=true;imageViewer.hidden=false;const f=document.createElement('iframe');f.src=url;f.allow='autoplay; fullscreen; picture-in-picture';f.allowFullscreen=true;f.style.width='100%';f.style.minHeight='420px';f.style.border='0';imageViewer.appendChild(f);setStatus('Player carregado.')}
function showOpenFallback(it){imageViewer.hidden=false;imageViewer.innerHTML='';const p=document.createElement('p');p.textContent='O endereço foi aceito, mas o navegador não iniciou a reprodução direta.';const a=document.createElement('a');a.href=it.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Abrir arquivo diretamente';a.style.display='inline-block';a.style.marginTop='10px';imageViewer.append(p,a)}
function selectItem(i,autoplay=false){if(!items.length)return;currentIndex=Math.max(0,Math.min(i,items.length-1));const it=items[currentIndex];currentTitle.textContent=it.title||`Vídeo ${currentIndex+1}`;position.textContent=`${currentIndex+1} de ${items.length}`;prevButton.disabled=currentIndex===0;nextButton.disabled=currentIndex===items.length-1;resetPlayer();if(!it.playable||!it.url){player.hidden=true;imageViewer.hidden=false;imageViewer.textContent='Vídeo identificado, mas não encontrei uma fonte reproduzível.';setStatus('Fonte não encontrada para este item.','error');renderPlaylist();return}if(it.kind==='embed'){showEmbed(it.url);renderPlaylist();return}player.hidden=false;setStatus(it.kind==='download'?'Abrindo link de arquivo…':'Carregando vídeo…');player.src=it.url;player.load();if(autoplay)player.play().catch(()=>{});renderPlaylist()}
function useDirect(){if(!items.length)return;const v=prompt('Cole uma URL direta HTTPS autorizada:');if(!v)return;const u=v.trim();if(!isHttps(u)){setStatus('A URL precisa usar HTTPS.','error');return}items[currentIndex]={...items[currentIndex],url:u,kind:isBunkrDownload(u)?'download':'direct',playable:true};selectItem(currentIndex,true)}
function history(){try{return JSON.parse(localStorage.getItem('teste-tesoura-history')||'[]')}catch{return[]}}
function saveHistory(url,title){const h=history().filter(x=>x.url!==url);h.unshift({url,title:title||url,at:Date.now()});localStorage.setItem('teste-tesoura-history',JSON.stringify(h.slice(0,12)));renderHistory()}
function renderHistory(){historyBox.innerHTML='';const h=history();if(!h.length){historyBox.innerHTML='<div class="empty">Nenhum link aberto ainda.</div>';return}h.forEach(e=>{const b=document.createElement('button');b.type='button';b.title=e.url;b.textContent=e.title||e.url;b.onclick=()=>{urlInput.value=e.url;loadUrl(e.url)};historyBox.appendChild(b)})}

async function loadUrl(raw){const target=String(raw||'').trim();if(!target){setStatus('Cole um link válido.','error');return}lastSubmittedUrl=target;urlInput.value=target;openButton.disabled=true;viewer.hidden=true;setStatus('Lendo página…');try{let data;if(isBunkrDownload(target)){data={title:`Arquivo ${target.match(bunkrDownload)?.[1]||''}`.trim(),items:[{title:`Arquivo ${target.match(bunkrDownload)?.[1]||''}`.trim(),url:target,kind:'download',playable:true,sourcePage:target}]}}else if(videoExt.test(target)&&isHttps(target)){data={title:titleFromUrl(target),items:[{title:titleFromUrl(target),url:target,kind:'direct',playable:true,sourcePage:target}]}}else{const r=await fetchPage(target);const type=(r.headers.get('content-type')||'').toLowerCase();data=type.startsWith('video/')?{title:titleFromUrl(r.url),items:[{title:titleFromUrl(r.url),url:r.url,kind:'direct',playable:true,sourcePage:target}]}:await discover(await r.text(),r.url||target)}if(!data.items?.length)throw new Error('Nenhum vídeo identificado.');items=data.items;currentIndex=0;albumTitle.textContent=data.title||'Conteúdo';count.textContent=String(items.length);viewer.hidden=false;renderPlaylist();selectItem(0,false);saveHistory(target,data.title);const u=new URL(location.href);u.searchParams.set('url',target);history.replaceState(null,'',u)}catch(err){items=[];playlist.innerHTML='';viewer.hidden=true;setStatus(err instanceof TypeError?'O navegador bloqueou a leitura da página. O link foi mantido.':(err?.message||'Não foi possível abrir.'),'error')}finally{openButton.disabled=false;urlInput.value=lastSubmittedUrl}}

form.addEventListener('submit',e=>{e.preventDefault();loadUrl(urlInput.value)});prevButton.onclick=()=>selectItem(currentIndex-1,true);nextButton.onclick=()=>selectItem(currentIndex+1,true);directUrlButton.onclick=useDirect;player.addEventListener('loadedmetadata',()=>setStatus(''));player.addEventListener('canplay',()=>setStatus(''));player.addEventListener('error',()=>{const it=items[currentIndex];setStatus('O endereço foi encontrado, mas o navegador não conseguiu reproduzir o vídeo diretamente.','error');if(it?.url)showOpenFallback(it)});player.addEventListener('ended',()=>{if(currentIndex<items.length-1)selectItem(currentIndex+1,true)});clearHistoryButton.onclick=()=>{localStorage.removeItem('teste-tesoura-history');renderHistory()};renderHistory();const initial=new URL(location.href).searchParams.get('url');if(initial){lastSubmittedUrl=initial;urlInput.value=initial;loadUrl(initial)}
