import {setupCatalogueUsability, hideCatalogueHelp, highlightSearchResults} from './usability.mjs';
import {searchRecords, titleOf, normalize, searchScopeLabels} from './search.mjs';
import {escapeHTML as esc, readingHTML, catalogueEntryHTML} from './presentation.mjs';
import {spreadsheetHTML, spreadsheetColumns} from './spreadsheet.mjs';
import {classificationFilter} from './tags.mjs';
import {ensureRecordDetails, ensurePageDetails, ensureSearchIndex} from './data-loader.mjs';

const $=s=>document.querySelector(s);
const state={view:'catalogue',query:'',scope:'all',kind:'manuscript',subject:'',subjectTags:[],traditionTags:[],folio:'',sort:'source',includeCancelled:true,review:false,page:1,sourceFolio:null,column:'',direction:'asc',focusRecord:null};
const pageSize=12;
let catalogue,filtered=[],zoom=1,fitWidth=0,toastTimer,debounce;
let highlightEnabled=true,locatorAvailable=false,imageVersion=0,nativeRequest=null,readerImage=null;
let renderSerial=0,readerSerial=0,exporting=false;
const pageFor=order=>catalogue.pages.find(p=>p.source_order===Number(order));
const isSheet=()=>state.view==='spreadsheet';
const views=['catalogue','spreadsheet','folios','about'];

function folioKey(value){
 const label=String(value).trim().toLowerCase().replace(/^fol(?:io)?\.?\s*/,'').replace(/[\[\]\s]/g,'');
 const match=/^0*(\d+)([abrv]?)$/.exec(label);
 return match?String(Number(match[1]))+(/[bv]/.test(match[2])?'b':''):null;
}
function folioForLabel(value){
 const key=folioKey(value);
 return key?catalogue.pages.find(p=>folioKey(p.folio)===key):undefined;
}
function clearFolioJumpError(form){
 form.querySelector('input').removeAttribute('aria-invalid');
 const error=form.querySelector('.folio-jump-error');error.textContent='';error.hidden=true;
}
function syncFolioJump(form,page){
 form.querySelector('input').value=page?.folio||'';clearFolioJumpError(form);
}
function jumpToFolio(form,destination){
 const input=form.querySelector('input'),page=folioForLabel(input.value);
 if(!page){
  const error=form.querySelector('.folio-jump-error');
  error.textContent=input.value.trim()?'No matching folio. Enter 1–345, with b for the reverse side (for example, 25b).':'Enter a folio, such as 25 or 25b.';
  error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;
 }
 syncFolioJump(form,page);
 if(destination==='image')openFolio(page.source_order);else browseFolio(page.source_order);
}

function readURL(){
 const q=new URLSearchParams(location.search);
 state.scope=Object.hasOwn(searchScopeLabels,q.get('field'))?q.get('field'):'all';
 state.subjectTags=[...new Set(q.getAll('tag'))].filter(id=>catalogue.taxonomy.subjects.some(t=>t.id===id));
 state.traditionTags=[...new Set(q.getAll('tradition'))].filter(id=>catalogue.taxonomy.traditions.some(t=>t.id===id));
 Object.assign(state,{view:views.includes(q.get('view'))?q.get('view'):'catalogue',query:q.get('q')||'',kind:['manuscript','heading','all','section','continuation','note','other'].includes(q.get('kind'))?q.get('kind'):'manuscript',subject:q.get('subject')||'',folio:q.get('folio')||'',sort:['source','title','shelfmark','relevance','column'].includes(q.get('sort'))?q.get('sort'):'source',includeCancelled:q.get('cancelled')!=='0',review:q.get('review')==='1',page:Math.max(1,Number(q.get('p'))||1),sourceFolio:q.get('page')||null,column:q.get('column')||'',direction:q.get('dir')==='desc'?'desc':'asc'});
 if(state.folio){const mapped=folioForLabel(state.folio);if(mapped)state.folio=String(mapped.source_order);}
 // Old entry links now lead directly to the source folio, not an entry page.
 if(q.get('entry'))state.sourceFolio=catalogue.records.find(r=>r.id===q.get('entry'))?.source_order||null;
 state.focusRecord=null;
 if(q.get('record'))setRecordLocation(q.get('record'));
}
function setRecordLocation(id){
 const record=catalogue.records.find(r=>r.id===id);if(!record)return false;
 const entries=catalogue.records.filter(r=>r.source_order===record.source_order).sort((a,b)=>a.sequence-b.sequence);
 Object.assign(state,{view:'catalogue',query:'',scope:'all',kind:'all',subject:'',subjectTags:[],traditionTags:[],folio:String(record.source_order),sort:'source',includeCancelled:true,review:false,page:Math.floor(entries.indexOf(record)/pageSize)+1,focusRecord:id});
 return true;
}
function revealRecord(){
 const entry=state.focusRecord&&document.getElementById('entry-'+state.focusRecord);
 if(entry){entry.setAttribute('tabindex','-1');entry.focus({preventScroll:true});entry.scrollIntoView({block:'start'});}
}
function writeURL(push=false){
 const q=new URLSearchParams();
 if(state.view!=='catalogue')q.set('view',state.view);
 if(state.query)q.set('q',state.query);
 if(state.scope!=='all')q.set('field',state.scope);
 if(state.kind!=='manuscript')q.set('kind',state.kind);
 if(state.subject)q.set('subject',state.subject);
 state.subjectTags.forEach(id=>q.append('tag',id));state.traditionTags.forEach(id=>q.append('tradition',id));
 if(state.folio)q.set('folio',pageFor(state.folio)?.folio||state.folio);
 if(state.sort!=='source')q.set('sort',state.sort);
 if(state.sort==='column'&&state.column){q.set('column',state.column);q.set('dir',state.direction);}
 if(!state.includeCancelled)q.set('cancelled','0');
 if(state.review)q.set('review','1');
 if(state.page>1&&!isSheet())q.set('p',state.page);
 if(state.sourceFolio)q.set('page',state.sourceFolio);
 if(state.focusRecord)q.set('record',state.focusRecord);
 const next=location.pathname+(q.size?'?'+q:'');
 if(next!==location.pathname+location.search)(()=>{try{history[push?'pushState':'replaceState']({},'',next)}catch{}})();
}
function syncControls(){
 $('#search').value=state.query;
 $('#search-scope').value=state.scope;
 $('#search').placeholder=({all:'Search a title, author or shelfmark…',title:'Search titles…',author:'Search authors…',shelfmark:'Search a shelfmark, e.g. d. 771…',transcription:'Search the catalogue text…'}[state.scope]);
 document.querySelectorAll('[name=kind]').forEach(el=>el.checked=el.value===state.kind);
 $('#subject').value=state.subject;$('#folio').value=state.folio;$('#sort').value=state.sort;
 syncFolioJump($('#folio-jump-form'),pageFor(state.folio));
 $('#include-cancelled').checked=state.includeCancelled;$('#review-only').checked=state.review;
}
function showView(view,push=true){
 renderSerial++;
 state.view=view;
 if(view!=='catalogue')state.focusRecord=null;
 const section=['catalogue','spreadsheet'].includes(view)?'catalogue':view;
 document.body.dataset.view=view;$('#search-form').hidden=section!=='catalogue';
 document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==section+'-view');
 document.body.classList.toggle('spreadsheet-mode',isSheet());
 document.querySelectorAll('.nav-link').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 if(view==='folios')renderFolios();
 if(section==='catalogue')renderResults();
 writeURL(push);
}
const chip=(text,key)=>`<button class="filter-chip" data-remove="${key}">${esc(text)}<span aria-label="Remove filter">×</span></button>`;
const tagDefinition=(dimension,id)=>catalogue.taxonomy[dimension].find(tag=>tag.id===id);
function updateTagControls(){
 for(const [dimension,id,selected] of [['subjects','subject-tag',state.subjectTags],['traditions','tradition-tag',state.traditionTags]]){
  const counts=new Map();
  for(const record of catalogue.records){
   if(!record.classification)continue;
   for(const tag of record.classification[dimension])counts.set(tag.id,(counts.get(tag.id)||0)+1);
  }
  $('#'+id).innerHTML=`<option value="">${dimension==='subjects'?'Add a subject tag…':'Add a tradition tag…'}</option>`+catalogue.taxonomy[dimension].map(tag=>`<option value="${tag.id}"${selected.includes(tag.id)?' disabled':''}>${esc(tag.label)} (${counts.get(tag.id)||0})</option>`).join('');
 }
 $('#tag-selection').textContent=[state.subjectTags.length?'Subjects: '+state.subjectTags.map(id=>tagDefinition('subjects',id)?.label).join(' or '):'',state.traditionTags.length?'Traditions: '+state.traditionTags.map(id=>tagDefinition('traditions',id)?.label).join(' or '):''].filter(Boolean).join(' · ')||'No tags selected';
}
function addTag(dimension,id){
 const key=dimension==='subjects'?'subjectTags':'traditionTags';
 if(!tagDefinition(dimension,id)||state[key].includes(id))return;
 state[key].push(id);state.page=1;renderResults();
}
async function loadBulkDetails(records,stillNeeded=()=>true){
 // Small batches leave room for a newly requested folio or search between them.
 const byFolio=new Map();
 for(const record of records){if(!byFolio.has(record.source_order))byFolio.set(record.source_order,[]);byFolio.get(record.source_order).push(record);}
 const groups=[...byFolio.values()];
 for(let i=0;i<groups.length&&stillNeeded();i+=6)await ensureRecordDetails(groups.slice(i,i+6).flat());
}
async function renderResults(){
 const serial=++renderSerial;
 hideCatalogueHelp();
 $('#results').setAttribute('aria-busy','true');$('#download-results').disabled=true;
 $('#results-count').textContent=state.query&&!globalThis.CATALOGUE_SEARCH?'Loading search index…':'Loading entries…';
 try{
 if(state.query)await ensureSearchIndex();
 if(serial!==renderSerial)return;
 filtered=searchRecords(catalogue.records,state.query,state.scope).filter(r=>(state.kind==='all'||r.kind===state.kind)&&(!state.subject||r.subjectGroup===state.subject)&&classificationFilter(r,state.subjectTags,state.traditionTags)&&(!state.folio||r.source_order===Number(state.folio))&&(state.includeCancelled||!r.isCancelled)&&(!state.review||r.needsReview));
 const compare=(a,b)=>String(a??'').localeCompare(String(b??''),undefined,{numeric:true,sensitivity:'base'});
 if(state.sort==='source')filtered.sort((a,b)=>a.source_order-b.source_order||a.sequence-b.sequence);
 if(state.sort==='title')filtered.sort((a,b)=>compare(normalize(titleOf(a)),normalize(titleOf(b))));
 if(state.sort==='shelfmark')filtered.sort((a,b)=>compare(a.shelfmark||'zz',b.shelfmark||'zz'));
 if(state.sort==='column'){
  await loadBulkDetails(filtered,()=>serial===renderSerial);
  if(serial!==renderSerial)return;
  const col=spreadsheetColumns.find(c=>c.key===state.column);
  if(col)filtered.sort((a,b)=>compare(col.value(a),col.value(b))*(state.direction==='desc'?-1:1));
 }
 const size=isSheet()?150:pageSize; const pages=Math.max(1,Math.ceil(filtered.length/size));state.page=Math.min(state.page,pages);
 const visible=filtered.slice((state.page-1)*size,state.page*size);
 await ensureRecordDetails(visible);
 if(serial!==renderSerial)return;
 const label=state.kind==='manuscript'?(filtered.length===1?'manuscript entry':'manuscript entries'):state.kind==='heading'?'cross-references':'catalogue records';
 $('#results-count').textContent=`${filtered.length} ${label}`;
 $('#active-filters').innerHTML=[state.kind!=='all'?chip(({manuscript:'Manuscript entries',heading:'Cross-references',section:'Section headings',continuation:'Continuation notes',note:'Unattached annotations',other:'Other catalogue text'}[state.kind]),'kind'):'',state.query?chip('“'+state.query+'”','query'):'',state.scope!=='all'?chip('Search in: '+searchScopeLabels[state.scope],'scope'):'',state.subject?chip(state.subject,'subject'):'',state.folio?chip((pageFor(state.folio)?.folio_label||state.folio)+' · image '+state.folio,'folio'):'',!state.includeCancelled?chip('Records with cancellations hidden','cancelled'):'',state.review?chip('With reading notes','review'):''].join('');
 $('#active-filters').insertAdjacentHTML('beforeend',state.subjectTags.map(id=>chip(tagDefinition('subjects',id).label,'subjectTag:'+id)).join('')+state.traditionTags.map(id=>chip(tagDefinition('traditions',id).label,'traditionTag:'+id)).join(''));
 updateTagControls();
 if(!filtered.length){
  const p=pageFor(state.folio);
  $('#results').innerHTML=p&&p.totalRecords===0?`<div class="empty"><h3>No catalogue records on ${esc(p.folio_label)}.</h3><p>You can still view the original folio image.</p><a href="?page=${p.source_order}" data-open-folio="${p.source_order}">Open folio image ↗</a></div>`:'<div class="empty"><h3>No entries found.</h3><p>Try fewer words, another spelling, or select All catalogue records.</p><button data-reset-search>Clear search and filters</button></div>';
 }else if(isSheet()){
  $('#results').innerHTML=`<div class="sheet-scroll" tabindex="0" role="region" aria-label="Searchable catalogue spreadsheet. Scroll horizontally for all fields.">${spreadsheetHTML(filtered.slice((state.page-1)*size,state.page*size),{sortKey:state.sort==='column'?state.column:'',sortDirection:state.direction})}</div>`;
 }else{
  $('#results').innerHTML=filtered.slice((state.page-1)*size,state.page*size).map(record=>catalogueEntryHTML(record)).join('');
 }
 highlightSearchResults($('#results'),state.query);
 {
  const around=[...new Set([1,state.page-1,state.page,state.page+1,pages])].filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);let previous=0;
  $('#pagination').innerHTML=filtered.length?`<span>Showing ${(state.page-1)*size+1}–${Math.min(state.page*size,filtered.length)} of ${filtered.length}</span><div class="pagination-actions"><button data-page="${state.page-1}" ${state.page===1?'disabled':''} aria-label="Previous page">←</button>${around.map(n=>{const gap=previous&&n-previous>1?'<span aria-hidden="true">…</span>':'';previous=n;return gap+`<button data-page="${n}" class="${n===state.page?'active':''}" ${n===state.page?'aria-current="page"':''}>${n}</button>`;}).join('')}<button data-page="${state.page+1}" ${state.page===pages?'disabled':''} aria-label="Next page">→</button></div>`:'';
 }
 $('#download-results').disabled=exporting||!filtered.length;
 writeURL();
 revealRecord();
 }catch(error){
  if(serial!==renderSerial)return;
  $('#results-count').textContent='Entries could not be loaded';
  $('#results').innerHTML='<div class="empty"><p>Check your connection or local files, then try again.</p><button data-retry-results>Retry loading</button></div>';
  $('#pagination').innerHTML='';console.error(error);
 }finally{if(serial===renderSerial)$('#results').setAttribute('aria-busy','false');}
}
function reset(){Object.assign(state,{query:'',scope:'all',kind:'manuscript',subject:'',subjectTags:[],traditionTags:[],folio:'',includeCancelled:true,review:false,sort:'source',column:'',page:1,focusRecord:null});syncControls();renderResults();}
function renderFolios(){
 $('#folios-grid').innerHTML=catalogue.pages.map(p=>`<article class="folio-card"><a class="folio-image" href="?view=folios&page=${p.source_order}" data-open-folio="${p.source_order}" aria-label="Open ${esc(p.folio_label)}, source image ${p.source_order}"><img src="${esc(p.thumbnailPath)}" alt="${esc(p.folio_label)}" loading="lazy"></a><h2>${esc(p.folio_label)}</h2><p>Image ${p.source_order}</p><p>${p.shelfmarkedCount} manuscript entries · ${p.totalRecords} records</p><div class="folio-actions"><a href="?view=folios&page=${p.source_order}" data-open-folio="${p.source_order}">View folio ↗</a><button data-filter-folio="${p.source_order}">Browse entries →</button></div></article>`).join('');
}
function cancelNativeLoad(){
 imageVersion++;
 if(nativeRequest){nativeRequest.onload=null;nativeRequest.onerror=null;nativeRequest.removeAttribute('src');nativeRequest=null;}
}
function updateImageQuality(){
 if(!readerImage)return;
 const size=pageFor(state.sourceFolio)?.bundled_dimensions;
 let text=readerImage.nativeLoaded?`Bundled image · ${size?.join(' × ')} px · below native resolution`:readerImage.nativeFailed?'Small preview · bundled image unavailable':readerImage.previewFailed?'Loading bundled image…':'Small preview · loading bundled image…';
 if(readerImage.nativeFailed&&readerImage.previewFailed)text='Image unavailable. Check the bundled image files.';
 if(locatorAvailable&&highlightEnabled)text+=' · approximate highlighted location';
 $('#image-quality').textContent=text;
}
function setImage(folio){
 cancelNativeLoad();const version=imageVersion,p=pageFor(folio);zoom=1;fitWidth=0;
 readerImage={nativeLoaded:false,nativeFailed:false,previewFailed:false};
 $('#full-image').href=p.sourceImageURL;$('#zoom-level').textContent='Fit';
 $('#bodleian-image').href=p.originalSourceImageURL;
 const img=$('#source-image');img.alt=`Original handwritten catalogue, MS. Chandra Shum Shere c. 484, ${p.folio_label}, source image ${p.source_order}`;
 img.width=p.native_dimensions[0];img.height=p.native_dimensions[1];
 img.onload=()=>{if(version!==imageVersion)return;readerImage.nativeLoaded=img.getAttribute('src')===p.sourceImageURL;fitImage(false);updateImageQuality();};
 img.onerror=()=>{
  if(version!==imageVersion)return;
  if(img.getAttribute('src')===p.sourceImageURL){readerImage.nativeFailed=true;readerImage.nativeLoaded=false;if(!readerImage.previewFailed)img.src=p.imagePath;}
  else readerImage.previewFailed=true;
  updateImageQuality();
 };
 img.src=p.imagePath;fitImage();updateImageQuality();
 const request=new Image();nativeRequest=request;request.decoding='async';
 request.onload=()=>{if(version!==imageVersion)return;nativeRequest=null;img.src=p.sourceImageURL;};
 request.onerror=()=>{if(version!==imageVersion)return;nativeRequest=null;readerImage.nativeFailed=true;updateImageQuality();};
 request.src=p.sourceImageURL;
}
function fitImage(resetZoom=true){
 const img=$('#source-image'),viewport=$('#image-viewport');
 const dimensions=pageFor(state.sourceFolio)?.native_dimensions;
 if(!dimensions||!viewport.clientHeight)return;
 fitWidth=Math.max(100,Math.min(viewport.clientWidth-36,(viewport.clientHeight-36)*dimensions[0]/dimensions[1]));
 if(resetZoom)zoom=1;applyZoom();
 if(zoom===1){viewport.scrollLeft=0;viewport.scrollTop=0;}
}
function applyZoom(){
 const viewport=$('#image-viewport'),img=$('#source-image');
 const oldW=img.clientWidth||fitWidth;
 const cx=(viewport.scrollLeft+viewport.clientWidth/2)/Math.max(oldW,1);
 const cy=(viewport.scrollTop+viewport.clientHeight/2)/Math.max(img.clientHeight,1);
 img.style.width=Math.round(fitWidth*zoom)+'px';img.style.height='auto';
 const originalWidth=pageFor(state.sourceFolio)?.bundled_dimensions[0]||img.naturalWidth||1;
 $('#zoom-level').textContent=zoom===1?'Fit':Math.round(fitWidth*zoom/originalWidth*100)+'%';
 $('#zoom-level').title=zoom===1?'Fit the whole page in the viewer':'Scale relative to the bundled image';
 $('#zoom-out').disabled=zoom<=1;$('#zoom-in').disabled=zoom>=12;
 if(zoom>1){viewport.scrollLeft=cx*img.clientWidth-viewport.clientWidth/2;viewport.scrollTop=cy*img.clientHeight-viewport.clientHeight/2;}
}
async function openFolio(folio,push=true,recordId=null){
 const p=pageFor(folio);if(!p)return;
 const serial=++readerSerial;
 state.sourceFolio=Number(folio);
 syncFolioJump($('#reader-folio-jump-form'),p);
 $('#reader-title').textContent=`Catalogue ${p.folio_label}, source image ${p.source_order}`;
 const index=catalogue.pages.findIndex(p=>p.source_order===Number(folio));
 $('#reader-position').textContent=`${index+1} of ${catalogue.pages.length}`;
 $('#previous-folio').disabled=index<=0;$('#next-folio').disabled=index>=catalogue.pages.length-1;
 $('#folio-note-list').innerHTML='';$('#folio-notes').hidden=true;$('#folio-notes').open=false;
 if(!$('#reader').open)$('#reader').showModal();
 setImage(folio);showLocator(p,null);writeURL(push);
 try{
  await ensurePageDetails(folio);
  if(serial!==readerSerial)return;
  $('#folio-note-list').innerHTML=p.notes.map(n=>`<li>${readingHTML(n)}</li>`).join('');$('#folio-notes').hidden=!p.notes.length;
  showLocator(p,recordId);
 }catch(error){if(serial===readerSerial)toast('The image is available, but folio notes could not be loaded. Reopen the folio to retry.');console.error(error);}
}
function closeReader(){readerSerial++;cancelNativeLoad();readerImage=null;state.sourceFolio=null;if($('#reader').open)$('#reader').close();writeURL();}
function browseFolio(folio){
 clearTimeout(debounce);closeReader();Object.assign(state,{folio:String(folio),kind:'all',query:'',scope:'all',subject:'',subjectTags:[],traditionTags:[],includeCancelled:true,review:false,page:1,sort:'source',focusRecord:null});syncControls();showView(isSheet()?'spreadsheet':'catalogue');$('.catalogue-layout').scrollIntoView({block:'start'});$('#results-count').focus({preventScroll:true});
}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3200);}
async function download(){
 if(exporting||!filtered.length)return;
 const rows=[...filtered];exporting=true;$('#download-results').disabled=true;toast('Preparing download…');
 try{
 await loadBulkDetails(rows);
 const fields=['id','source_order','folio_label','record_type','subtype','annotations','verification_status','human_verified','locations','relationships','resolvedRelationships','editorial_context','change_audit','focused_readings','source','incipit','shelfmark','titleLiteral','titleNormalized','displayTitle','authorOrSource','displayAuthor','readable_title','readableTitle','resolved_title','resolved_author','resolved_source','resolved_subject','resolved_work','resolvedFields','subject','subject_tags','uncertain_subject_tags','tradition_tags','uncertain_tradition_tags','classification_status','classification','date','extent','lines','script','status','transcription','uncertainties','reviewNotes','editorialNotes','originalFieldReadings','sourceCitationURL'];
 const q=v=>'"'+String(Array.isArray(v)?(v.some(x=>x&&typeof x==='object')?JSON.stringify(v):v.join('\n')):v&&typeof v==='object'?JSON.stringify(v):v??'').replaceAll('"','""')+'"';
 const csv='\uFEFF'+[fields.map(q).join(','),...rows.map(r=>{const c=r.classification;const row={...r,readable_title:r.readableTitle?.value||'',...Object.fromEntries(['title','author','source','subject','work'].map(field=>['resolved_'+field,r.resolvedFields?.[field]?.value||''])),subject_tags:c?.subjects.map(t=>t.label),uncertain_subject_tags:c?.subjects.filter(t=>t.confidence==='uncertain').map(t=>t.label),tradition_tags:c?.traditions.map(t=>t.label),uncertain_tradition_tags:c?.traditions.filter(t=>t.confidence==='uncertain').map(t=>t.label),classification_status:c?.status};return fields.map(f=>q(row[f])).join(',');})].join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='chandra-shum-shere-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${rows.length} records downloaded`);
 }catch(error){toast('Download could not be prepared. Please try again.');console.error(error);}
 finally{exporting=false;$('#download-results').disabled=!filtered.length||$('#results').getAttribute('aria-busy')==='true';}
}
function searchNow(){clearTimeout(debounce);const q=$('#search').value.trim();if(q!==state.query)state.sort=q?'relevance':'source';state.query=q;state.page=1;state.focusRecord=null;syncControls();renderResults();}

document.addEventListener('click',e=>{
 const entryLink=e.target.closest('a[data-record-link]');
 if(entryLink){if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();clearTimeout(debounce);closeReader();if(setRecordLocation(entryLink.dataset.recordLink)){syncControls();writeURL(true);showView('catalogue',false);revealRecord();}}return;}
 const link=e.target.closest('a[data-open-folio]');
 if(link){if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();openFolio(Number(link.dataset.openFolio),true,link.dataset.record);}return;}
 const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.hasAttribute('data-citation-toggle')){const panel=document.getElementById(b.getAttribute('aria-controls'));const open=b.getAttribute('aria-expanded')==='true';panel.hidden=open;b.setAttribute('aria-expanded',String(!open));return;}
 if(b.dataset.copyCitation){
  (async()=>{try{await navigator.clipboard.writeText(b.dataset.copyCitation);toast('Citation copied');}catch{toast('Select and copy the citation shown above.');}})();return;
 }
 if(b.dataset.view||b.dataset.query!==undefined||b.dataset.page||b.dataset.filterTraditionTag||b.dataset.remove||b.dataset.columnSort)state.focusRecord=null;
 if(b.dataset.view){showView(b.dataset.view);window.scrollTo({top:0});}
 if(b.dataset.query!==undefined){Object.assign(state,{query:b.dataset.query,kind:state.kind,subject:'',folio:'',review:false,includeCancelled:true,sort:'relevance',page:1});syncControls();renderResults();}
 if(b.dataset.filterFolio)browseFolio(b.dataset.filterFolio);
 if(b.dataset.page){state.page=Number(b.dataset.page);renderResults();$('.results-toolbar').scrollIntoView({block:'start'});}
 if(b.dataset.filterTraditionTag){addTag('traditions',b.dataset.filterTraditionTag);return;}
 if(b.dataset.remove){const k=b.dataset.remove;if(k.startsWith('subjectTag:'))state.subjectTags=state.subjectTags.filter(id=>id!==k.slice(11));else if(k.startsWith('traditionTag:'))state.traditionTags=state.traditionTags.filter(id=>id!==k.slice(13));else if(k==='kind')state.kind='all';else if(k==='scope')state.scope='all';else if(k==='cancelled')state.includeCancelled=true;else if(k==='review')state.review=false;else state[k]='';state.page=1;syncControls();renderResults();}
 if(b.hasAttribute('data-reset-search'))reset();
 if(b.hasAttribute('data-retry-results'))renderResults();
 if(b.dataset.columnSort){const key=b.dataset.columnSort;state.direction=state.column===key&&state.direction==='asc'?'desc':'asc';state.column=key;state.sort='column';const scroll=$('.sheet-scroll');const x=scroll?.scrollLeft||0;syncControls();const pending=renderResults(),serial=renderSerial;pending.then(()=>{if(serial!==renderSerial)return;if($('.sheet-scroll'))$('.sheet-scroll').scrollLeft=x;document.querySelector(`button[data-column-sort="${key}"]`)?.focus({preventScroll:true});});}
});
$('#search-form').addEventListener('submit',e=>{e.preventDefault();searchNow();});
document.querySelectorAll('#catalogue-view input,#catalogue-view select,#search-scope').forEach(control=>control.addEventListener('change',()=>{state.focusRecord=null;}));
document.querySelectorAll('[data-folio-jump]').forEach(form=>{
 form.addEventListener('submit',event=>{event.preventDefault();jumpToFolio(form,event.submitter?.value||form.dataset.defaultAction);});
 form.querySelector('input').addEventListener('input',()=>clearFolioJumpError(form));
});
$('#search').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(searchNow,160);});
$('#search-scope').addEventListener('change',event=>{state.scope=event.target.value;state.page=1;syncControls();renderResults();});
$('#subject-tag').addEventListener('change',event=>addTag('subjects',event.target.value));
$('#tradition-tag').addEventListener('change',event=>addTag('traditions',event.target.value));
document.querySelectorAll('[name=kind]').forEach(el=>el.addEventListener('change',()=>{state.kind=el.value;state.page=1;renderResults();}));
for(const [id,key] of [['subject','subject'],['folio','folio'],['sort','sort']])$('#'+id).addEventListener('change',e=>{state[key]=e.target.value;state.page=1;if(key==='folio')syncFolioJump($('#folio-jump-form'),pageFor(state.folio));renderResults();});
$('#include-cancelled').addEventListener('change',e=>{state.includeCancelled=e.target.checked;state.page=1;renderResults();});
$('#review-only').addEventListener('change',e=>{state.review=e.target.checked;state.page=1;renderResults();});
$('#clear-filters').addEventListener('click',reset);$('#download-results').addEventListener('click',download);
$('#close-reader').addEventListener('click',closeReader);$('#reader').addEventListener('cancel',e=>{e.preventDefault();closeReader();});
for(const [id,step] of [['previous-folio',-1],['next-folio',1]])$('#'+id).addEventListener('click',()=>{const index=catalogue.pages.findIndex(p=>p.source_order===Number(state.sourceFolio));if(catalogue.pages[index+step])openFolio(catalogue.pages[index+step].source_order,false);});
$('#zoom-in').addEventListener('click',()=>{zoom=Math.min(12,zoom+.5);applyZoom();});$('#zoom-out').addEventListener('click',()=>{zoom=Math.max(1,zoom-.5);applyZoom();});$('#zoom-fit').addEventListener('click',()=>fitImage());
$('#highlight-entry').addEventListener('change',event=>{highlightEnabled=event.target.checked;updateLocatorVisibility();});
$('#image-viewport').addEventListener('keydown',e=>{if(e.key==='+'||e.key==='='){e.preventDefault();$('#zoom-in').click();}if(e.key==='-'){e.preventDefault();$('#zoom-out').click();}});
let drag=null;const viewport=$('#image-viewport');
viewport.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||zoom<=1)return;drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');});
viewport.addEventListener('pointermove',e=>{if(!drag)return;viewport.scrollLeft=drag.left+drag.x-e.clientX;viewport.scrollTop=drag.top+drag.y-e.clientY;});
for(const name of ['pointerup','pointercancel'])viewport.addEventListener(name,()=>{drag=null;viewport.classList.remove('dragging');});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!$('#reader').open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}});
window.addEventListener('popstate',()=>{readURL();syncControls();showView(state.view,false);if(state.sourceFolio)openFolio(state.sourceFolio,false);else if($('#reader').open){readerSerial++;cancelNativeLoad();readerImage=null;$('#reader').close();}revealRecord();});
window.addEventListener('resize',()=>{if($('#reader').open&&zoom===1)fitImage();});

try{
 catalogue=window.CATALOGUE_DATA;if(!catalogue)throw new Error('Catalogue data unavailable');
 $('#subject').innerHTML='<option value="">All subjects</option>'+[...new Set(catalogue.records.map(r=>r.subjectGroup).filter(Boolean))].sort().map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
 $('#folio').innerHTML='<option value="">All 690 images</option>'+catalogue.pages.map(p=>`<option value="${p.source_order}">${esc(p.folio_label)} · image ${p.source_order}</option>`).join('');
 document.querySelectorAll('[data-folio-options]').forEach(list=>{list.innerHTML=catalogue.pages.map(p=>`<option value="${esc(folioKey(p.folio))}">${esc(p.folio_label)} · ${p.totalRecords} catalogue records</option>`).join('');});
 $('#sort').insertAdjacentHTML('afterbegin','<option value="relevance">Best match</option><option value="column" disabled>Selected column</option>');
 $('#manuscript-count').textContent=catalogue.records.filter(r=>r.kind==='manuscript').length;
 $('#heading-count').textContent=catalogue.records.filter(r=>r.kind==='heading').length;$('#all-count').textContent=catalogue.records.length;
 setupCatalogueUsability(catalogue);
 const summary=catalogue.summary;$('#edition-status').textContent=`${summary.complete_three_pass_images} / 690 images machine reviewed · ${summary.records.toLocaleString()} records · No human editing · Uncertain readings remain marked${summary.pending_images?' · Processing in progress':''}`;
 readURL();syncControls();showView(state.view,false);if(state.sourceFolio)openFolio(state.sourceFolio,false);revealRecord();
}catch(error){$('#results-count').textContent='The catalogue could not be loaded';$('#results').innerHTML='<div class="empty"><p>Please refresh the page to try again.</p></div>';console.error(error);}

function updateLocatorVisibility(){
 $('#source-locator').hidden=!locatorAvailable||!highlightEnabled;
 const control=$('#highlight-entry');control.checked=highlightEnabled;control.disabled=!locatorAvailable;
 control.closest('label').title=locatorAvailable?'Show or hide the selected entry’s location':'Open the folio from an entry to highlight its location';
 updateImageQuality();
}
function showLocator(p,id){
 const el=$('#source-locator');locatorAvailable=false;updateLocatorVisibility();
 const record=catalogue.records.find(r=>r.id===id&&r.source_order===p.source_order);const boxes=(record?.locations||[]).map(l=>l.bbox).filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite));
 if(!boxes.length)return;
 const x=Math.max(0,Math.min(...boxes.map(b=>b[0]))),y=Math.max(0,Math.min(...boxes.map(b=>b[1])));
 const right=Math.min(p.native_dimensions[0],Math.max(...boxes.map(b=>b[0]+b[2]))),bottom=Math.min(p.native_dimensions[1],Math.max(...boxes.map(b=>b[1]+b[3])));
 if(right<=x||bottom<=y)return;
 Object.assign(el.style,{left:100*x/p.native_dimensions[0]+'%',top:100*y/p.native_dimensions[1]+'%',width:100*(right-x)/p.native_dimensions[0]+'%',height:100*(bottom-y)/p.native_dimensions[1]+'%'});locatorAvailable=true;updateLocatorVisibility();
}
