// Same-site script bundles also work when index.html is opened as a local file.
// No fetch, eval, remote host, credentials or server code is required.
let dataLoadCatalogue=null,dataLoadRecords=new Map(),dataLoadPages=new Map();
let dataLoadPagePromises=new Map(),dataLoadLoadedPages=new Set(),dataLoadSearchPromise=null;
let dataLoadQueue=[],dataLoadActive=0;
const dataLoadConcurrency=6;

function dataLoadState(){
 const catalogue=globalThis.CATALOGUE_DATA;
 if(!catalogue)throw new Error('The catalogue index is unavailable. Reload the page to retry.');
 if(dataLoadCatalogue!==catalogue){
  dataLoadCatalogue=catalogue;
  dataLoadRecords=new Map(catalogue.records.map(record=>[record.id,record]));
  dataLoadPages=new Map(catalogue.pages.map(page=>[Number(page.source_order),page]));
  dataLoadPagePromises=new Map();dataLoadLoadedPages=new Set();dataLoadSearchPromise=null;
 }
 return catalogue;
}
function dataLoadDrain(){
 while(dataLoadActive<dataLoadConcurrency&&dataLoadQueue.length){
  const job=dataLoadQueue.shift();dataLoadActive++;
  Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{dataLoadActive--;dataLoadDrain();});
 }
}
function dataLoadSchedule(run){
 return new Promise((resolve,reject)=>{dataLoadQueue.push({run,resolve,reject});dataLoadDrain();});
}
function dataLoadScript(relative){
 return dataLoadSchedule(()=>new Promise((resolve,reject)=>{
  const url=new URL(relative,document.baseURI);
  const base=new URL(document.baseURI);
  if(url.protocol!==base.protocol||(url.protocol!=='file:'&&url.origin!==base.origin)){
   reject(new Error('Catalogue data must load from this website.'));return;
  }
  const script=document.createElement('script');script.async=true;
  const cleanup=()=>{clearTimeout(timer);script.onload=null;script.onerror=null;script.remove();};
  const fail=()=>{cleanup();reject(new Error('A catalogue data file could not be loaded. Check your connection or local files, then retry.'));};
  const timer=setTimeout(fail,45000);
  script.onload=()=>{cleanup();resolve();};script.onerror=fail;script.src=url.href;
  document.head.append(script);
 }));
}
function dataLoadPage(order){
 const catalogue=dataLoadState(),number=Number(order);
 if(!catalogue.lazyData)return Promise.resolve(dataLoadPages.get(number));
 if(dataLoadLoadedPages.has(number))return Promise.resolve(dataLoadPages.get(number));
 if(dataLoadPagePromises.has(number))return dataLoadPagePromises.get(number);
 const path=catalogue.lazyData.recordChunks[number];
 if(!path)return Promise.reject(new Error('This folio has no catalogue data bundle.'));
 const pending=(async()=>{
  await dataLoadScript(path);
  const chunk=globalThis.CATALOGUE_RECORD_CHUNKS?.[number];
  if(!chunk||chunk.source_order!==number||!Array.isArray(chunk.records)||!Array.isArray(chunk.notes))throw new Error('The folio data bundle is incomplete. Reload or retry.');
  const expected=catalogue.records.filter(record=>record.source_order===number);
  const loadedIDs=new Set();
  for(const record of chunk.records){
   if(record.source_order!==number||!dataLoadRecords.has(record.id)||loadedIDs.has(record.id))throw new Error('The folio data bundle does not match this catalogue version. Reload the page.');
   loadedIDs.add(record.id);
  }
  if(expected.length!==loadedIDs.size||expected.some(record=>!loadedIDs.has(record.id)))throw new Error('The folio data bundle is missing a record. Reload or retry.');
  // Preserve reference identity for the image-control map and any active filters.
  for(const complete of chunk.records){
   const record=dataLoadRecords.get(complete.id);
   for(const key of Object.keys(record))if(!Object.hasOwn(complete,key))delete record[key];
   Object.assign(record,complete);
  }
  dataLoadPages.get(number).notes=chunk.notes;
  dataLoadLoadedPages.add(number);
  delete globalThis.CATALOGUE_RECORD_CHUNKS[number];
  return dataLoadPages.get(number);
 })();
 dataLoadPagePromises.set(number,pending);
 pending.then(()=>dataLoadPagePromises.delete(number),()=>dataLoadPagePromises.delete(number));
 return pending;
}
async function dataLoadRecordSet(records){
 const catalogue=dataLoadState();
 if(!catalogue.lazyData)return records;
 let pending=Array.from(records||[],item=>typeof item==='string'?dataLoadRecords.get(item):item).filter(Boolean);
 const visited=new Set();
 while(pending.length){
  const current=pending.filter(record=>!visited.has(record.id));
  if(!current.length)break;
  current.forEach(record=>visited.add(record.id));
  await Promise.all([...new Set(current.map(record=>record.source_order))].map(dataLoadPage));
  pending=current.flatMap(record=>(record.attachedRecords||[]).map(attached=>dataLoadRecords.get(attached.id))).filter(Boolean);
 }
 return records;
}

export function ensureRecordDetails(records){return dataLoadRecordSet(records);}
export function ensurePageDetails(sourceOrder){return dataLoadPage(sourceOrder);}
export function ensureAllRecordDetails(){
 const catalogue=dataLoadState();
 if(!catalogue.lazyData)return Promise.resolve(catalogue.records);
 return Promise.all(catalogue.pages.map(page=>dataLoadPage(page.source_order))).then(()=>catalogue.records);
}
export function ensureSearchIndex(){
 const catalogue=dataLoadState();
 if(!catalogue.lazyData)return Promise.resolve();
 if(globalThis.CATALOGUE_SEARCH&&catalogue.records.every(record=>globalThis.CATALOGUE_SEARCH[record.id]?.length===8))return Promise.resolve();
 if(dataLoadSearchPromise)return dataLoadSearchPromise;
 const pending=dataLoadScript(catalogue.lazyData.searchIndex).then(()=>{
  if(!globalThis.CATALOGUE_SEARCH||catalogue.records.some(record=>globalThis.CATALOGUE_SEARCH[record.id]?.length!==8))throw new Error('The search index could not be loaded completely. Please retry.');
 });
 dataLoadSearchPromise=pending;
 pending.catch(()=>{dataLoadSearchPromise=null;});
 return pending;
}
