(async()=>{
// Local, deterministic search. It does not change or supplement catalogue readings.
const vowels = {अ:'a',आ:'ā',इ:'i',ई:'ī',उ:'u',ऊ:'ū',ऋ:'ṛ',ॠ:'ṝ',ऌ:'ḷ',ॡ:'ḹ',ए:'e',ऐ:'ai',ओ:'o',औ:'au'};
const marks = {'ा':'ā','ि':'i','ी':'ī','ु':'u','ू':'ū','ृ':'ṛ','ॄ':'ṝ','ॢ':'ḷ','ॣ':'ḹ','े':'e','ै':'ai','ो':'o','ौ':'au'};
const consonants = {क:'k',ख:'kh',ग:'g',घ:'gh',ङ:'ṅ',च:'c',छ:'ch',ज:'j',झ:'jh',ञ:'ñ',ट:'ṭ',ठ:'ṭh',ड:'ḍ',ढ:'ḍh',ण:'ṇ',त:'t',थ:'th',द:'d',ध:'dh',न:'n',प:'p',फ:'ph',ब:'b',भ:'bh',म:'m',य:'y',र:'r',ल:'l',व:'v',श:'ś',ष:'ṣ',स:'s',ह:'h',ळ:'ḷ'};
const signs = {'ं':'ṃ','ँ':'ṃ','ः':'ḥ','ऽ':"'",'ॐ':'om','।':' ','॥':' '};

// Sanskrit Devanāgarī, including conjuncts and inherent vowels. This intentionally
// does not apply Hindi schwa deletion or claim support for other Indic scripts.
function devanagari(value) {
  const chars = Array.from(value.normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (consonants[ch]) {
      out += consonants[ch];
      if (chars[i + 1] === '़') i++;
      if (chars[i + 1] === '्') i++;
      else if (marks[chars[i + 1]]) out += marks[chars[++i]];
      else out += 'a';
    } else if (vowels[ch]) out += vowels[ch];
    else if (signs[ch] !== undefined) out += signs[ch];
    else if (/[०-९]/u.test(ch)) out += String(ch.codePointAt(0) - 0x0966);
    else if (!/[\u200c\u200d]/u.test(ch)) out += ch;
  }
  return out;
}

/** Fold IAST accents, case, punctuation, and Sanskrit Devanāgarī for search. */
function normalize(value) {
  return devanagari(String(value ?? ''))
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

// Common informal sh spelling and anusvāra/homorganic-nasal variants are search
// aliases only. Displayed spellings and exported catalogue readings stay intact.
const alias = text => text.replace(/sh/g, 's').replace(/m(?=[kgcjtd])/g, 'n');
const compact = text => text.replace(/\s+/g, '');
const first = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
const parseShelf = value => /^([a-gs])\s*(\d+)(?:[\s:]+(\d+))?(?:\s*([a-z]))?$/.exec(value);
const shelfMatches = (source, query) => source && query && source[1] === query[1] && source[2] === query[2]
  && (!query[3] || source[3] === query[3]) && (!query[4] || source[4] === query[4]);

function titleOf(record = {}) {
  return first(record.readableTitle?.value, record.resolvedFields?.title?.value, record.displayTitle, record.display_title, record.titleNormalized, record.title_normalized,
    record.titleLiteral, record.title_literal) || (record.kind === 'note' || record.status === 'note' ? 'Catalogue note' : 'Untitled entry');
}

function authorOf(record = {}) {
  return first(record.resolvedFields?.author?.value, record.displayAuthor, record.display_author, record.authorOrSource, record.author_or_source);
}

function fieldValue(record,field){
  return record.resolvedFields?.[field]?.value ?? record[({author:'authorOrSource',title:'titleLiteral'})[field]||field] ?? '';
}

/** Cite the source catalogue, distinguishing the catalogued item from its source. */
function citationFor(record = {}) {
  const folio = record.folio ?? record.page_label;
  const location = folio !== undefined && folio !== null && String(folio).trim() ? `, fol. ${folio}` : '';
  const item = first(record.shelfmark);
  const entry = item ? `, catalogue entry ${item}` : record.kind === 'heading' || record.status === 'heading' ? ', catalogue heading' : ', catalogue note';
  return `Bodleian Library, MS. Chandra Shum Shere c. 484${location}${entry}.`;
}

function textValues(value) {
  if (Array.isArray(value)) return value.map(textValues).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(textValues).join(' ');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

const fieldCache=new WeakMap();
function fieldsOf(record) {
 if(globalThis.CATALOGUE_SEARCH?.[record.id]?.length===8)return globalThis.CATALOGUE_SEARCH[record.id];
 if(fieldCache.has(record))return fieldCache.get(record);
  const groups = [
    [titleOf(record), record.titleLiteral, record.title_literal, record.titleNormalized, record.title_normalized, record.contextWork, record.context_work, record.resolvedFields?.work?.value],
    [record.shelfmark],
    [authorOf(record), record.authorOrSource, record.author_or_source, (record.editorial_context||[]).filter(c=>c&&typeof c==='object'&&/^(author|authorOrSource|author_or_source)$/i.test(c.field||'')).map(c=>c.value)],
    [fieldValue(record,'subject'), record.subject, record.subjectGroup, record.subject_group, (record.classification?.subjects||[]).map(t=>t.label), (record.classification?.traditions||[]).map(t=>t.label)],
    [record.transcription, record.incipit, record.source, fieldValue(record,'incipit'), fieldValue(record,'source'), record.searchContext],
    [record.editorialNotes, record.editorial_notes, record.reviewNotes, record.review_notes, record.uncertainties],
    [record.date, record.extent, record.lines, record.script, record.kind, record.record_type, record.status, record.folio_label, record.source_order],
    [record.transcription]
  ];
  const result=groups.map(group => {
    const raw = textValues(group);
    const basic = alias(normalize(raw));
    // Permit familiar ASCII "krishna" for kṛṣṇa without replacing the source.
    const phonetic = alias(normalize(devanagari(raw).normalize('NFC').replace(/[ṛṝṚṜ]/gu, 'ri')));
    return phonetic === basic ? basic : `${basic} ${phonetic}`;
  });
 fieldCache.set(record,result);return result;
}

const searchScopeLabels={all:'All fields',title:'Title',author:'Author',shelfmark:'Shelfmark',transcription:'Catalogue text'};
const scopeFields={all:[0,1,2,3,4,5,6],title:[0],author:[2],shelfmark:[1],transcription:[7]};

function searchQueryTerms(query='') {
  const normalized = alias(normalize(query));
  if(!normalized)return [];
  const wholeShelfQuery = parseShelf(normalized);
  const tokenized = normalized.replace(/\b([a-gs])\s*(\d+)(?:\s+(\d+))?(?=\s|$)/g,
    (_, letter, number, part) => letter + number + (part ? ':' + part : ''));
  return wholeShelfQuery ? [normalized] : [...new Set(tokenized.split(' '))];
}

function shelfTextPattern(parsed, global=false) {
  const part=parsed[3]?`\\s+${parsed[3]}(?!\\d)`:'';
  const suffix=parsed[4]?`\\s*${parsed[4]}(?![\\p{L}\\p{N}])`:'';
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(${parsed[1]}\\s*${parsed[2]}(?!\\d)${part}${suffix})`,global?'gu':'u');
}

/** AND terms within the chosen fields; return original record objects, ranked. */
function searchRecords(records, query = '', scope='all') {
  if (!Array.isArray(records)) return [];
  const normalized=alias(normalize(query));
  if(!normalized)return [...records];
  const allowed=scopeFields[scope]||scopeFields.all;
  const wholeShelfQuery=parseShelf(normalized);
  const terms=searchQueryTerms(query).map(term=>({term,shelfQuery:parseShelf(term)})).map(item=>({...item,shelfPattern:item.shelfQuery?shelfTextPattern(item.shelfQuery):null}));
  const weights = [26, 38, 19, 10, 3, 2, 1, 3];
  const results = [];
  records.forEach((record, index) => {
    const fields = fieldsOf(record);
    const shelf = compact(fields[1]);
    const parsedShelf = parseShelf(fields[1]);
    let score = 0;
    for (const {term,shelfQuery,shelfPattern} of terms) {
      if (shelfQuery&&allowed.includes(1)) {
        if (!shelfMatches(parsedShelf, shelfQuery)) return;
        score += shelfQuery[3] ? 60 : 43;
        continue;
      }
      let best = 0;
      for (const i of allowed) {
        const value = fields[i];
        if(shelfPattern){if(shelfPattern.test(value))best=Math.max(best,weights[i]);continue;}
        if (value.includes(term)) best = Math.max(best, weights[i] + (value === term ? 12 : value.startsWith(term) ? 5 : 0));
        // Names and compounds are often typed without the source's spaces.
        // Keep numeric shelfmark matching on its separate, exact path above.
        else if (term.length >= 4 && /^\p{L}+$/u.test(term) && compact(value).includes(term)) best = Math.max(best, weights[i]);
      }
      if (allowed.includes(1)&&shelf&&shelf.includes(compact(term))) best = Math.max(best, 43);
      if (!best) return;
      score += best;
    }
    if (allowed.includes(1)&&shelfMatches(parsedShelf, wholeShelfQuery)) score += wholeShelfQuery[3] ? 200 : 70;
    if(allowed.includes(0)){
      if (fields[0] === normalized) score += 120;
      else if (fields[0].startsWith(normalized)) score += 45;
      else if (fields[0].includes(normalized)) score += 20;
    }
    if (allowed.includes(2)&&fields[2] === normalized) score += 35;
    results.push({record, index, score});
  });
  return results.sort((a, b) => b.score - a.score || a.index - b.index).map(result => result.record);
}

// Map normalized characters back to the original text. Offsets are UTF-16 DOM
// string offsets; no transliteration or replacement is written into the source.
function mappedSearchText(text, phonetic=false, noSpaces=false) {
  const tokens=[];
  for(const match of text.matchAll(/[^\p{M}]\p{M}*|\p{M}+/gu)){
    let part=devanagari(match[0]).normalize('NFC');
    if(phonetic)part=part.replace(/[ṛṝṚṜ]/gu,'ri');
    part=part.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
    for(const character of part){
      const ch=/[\p{L}\p{N}]/u.test(character)?character:' ';
      const token={ch,start:match.index,end:match.index+match[0].length};
      if(ch===' '&&tokens.at(-1)?.ch===' ')tokens.at(-1).end=token.end;
      else tokens.push(token);
    }
  }
  const folded=[];
  for(let i=0;i<tokens.length;i++){
    const token={...tokens[i]};
    if(token.ch==='s'&&tokens[i+1]?.ch==='h')token.end=tokens[++i].end;
    if(token.ch==='m'&&/[kgcjtd]/.test(tokens[i+1]?.ch||''))token.ch='n';
    if(noSpaces&&token.ch===' ')continue;
    folded.push(token);
  }
  let value='';const starts=[],ends=[];
  for(const token of folded){value+=token.ch;for(let i=0;i<token.ch.length;i++){starts.push(token.start);ends.push(token.end);}}
  return {value,starts,ends};
}

function searchMatchRanges(value, query='') {
  const text=String(value??''),terms=searchQueryTerms(query);if(!text||!terms.length)return [];
  // Most displayed fields do not contain the query. Avoid constructing character
  // offset maps for them, especially in the spreadsheet's longer reading notes.
  const basic=alias(normalize(text)),phoneticText=alias(normalize(devanagari(text).normalize('NFC').replace(/[ṛṝṚṜ]/gu,'ri')));
  if(!terms.some(term=>{
    const shelf=parseShelf(term);if(shelf)return shelfTextPattern(shelf).test(basic)||shelfTextPattern(shelf).test(phoneticText);
    return [basic,phoneticText].some(s=>s.includes(term)||(term.length>=4&&/^\p{L}+$/u.test(term)&&compact(s).includes(term)));
  }))return [];
  const ranges=[];
  for(const phonetic of [false,true]){
    const spaced=mappedSearchText(text,phonetic),joined=mappedSearchText(text,phonetic,true);
    for(const term of terms){
      const parsed=parseShelf(term);
      if(parsed){
        for(const match of spaced.value.matchAll(shelfTextPattern(parsed,true))){const start=match.index+match[0].length-match[1].length;ranges.push([spaced.starts[start],spaced.ends[start+match[1].length-1]]);}
        continue;
      }
      const candidates=term.length>=4&&/^\p{L}+$/u.test(term)?[spaced,joined]:[spaced];
      for(const mapped of candidates){
        let start=0,index;
        while((index=mapped.value.indexOf(term,start))!==-1){ranges.push([mapped.starts[index],mapped.ends[index+term.length-1]]);start=index+Math.max(1,term.length);}
      }
    }
  }
  const merged=[];
  for(const range of ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){
    if(!Number.isInteger(range[0])||!Number.isInteger(range[1])||range[1]<=range[0])continue;
    const previous=merged.at(-1);
    if(previous&&range[0]<=previous[1])previous[1]=Math.max(previous[1],range[1]);else merged.push([...range]);
  }
  return merged;
}

function precomputeSearchIndex(records){return Object.fromEntries(records.map(record=>[record.id,fieldsOf(record)]));}

// Presentation helpers only: source readings and source locations are unchanged.
const escapeUIValue = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const helpCopy = {
  'Record subtype':'A more specific description of this record’s role, such as a manuscript entry, marginal note, or continuation.',
  'Source':'A work, collection, or bibliographical reference cited in this entry. The folio link opens the handwritten catalogue page.',
  'Source as written':'A work, collection, or bibliographical reference cited in this entry, preserving the catalogue’s wording.',
  'Subject':'The topic or branch of learning identified in the catalogue. A dash means no separate subject was recorded here.',
  'Subject tags':'Subject categories assigned from titles, subject descriptions and catalogue context. Classification evidence and confidence are available in the reading notes and downloads.',
  'Tradition tags':'Textual or devotional associations of the work, separate from subject. They do not identify the religion of the author, owner or scribe. No tag means unspecified. Confidence and evidence are available in the reading notes and downloads.',
  'Classification status':'Supported means the available catalogue evidence supports the subject assignment; uncertain means at least one subject tag is inferred or ambiguous. Unclassified means insufficient evidence. None is a claim of human verification.',
  'Classification evidence':'The transcribed wording, work identification or catalogue relationship supporting each editorial tag. Uncertain classifications remain marked.',
  'Incipit':'The opening words of the catalogued text, when the catalogue quotes them.',
  'Date':'The date recorded in the catalogue, kept as written. Calendars may vary; “n.d.” means no date is recorded.',
  'Extent':'The amount of manuscript material recorded, usually a number of leaves or a folio range. “ff.” means leaves.',
  'Lines':'The line count recorded for the manuscript, usually lines per page. Unclear interpretations remain marked in the reading notes.',
  'Script':'The writing system or script abbreviation recorded by the cataloguer. Abbreviations are preserved as written.',
  'Shelfmark':'The catalogue’s reference number for a manuscript or a part of a manuscript.',
  'Folio':'The leaf of the handwritten catalogue where the record appears. A label ending in “b” identifies the reverse, or verso, of that leaf.',
  'Source image':'The image’s position in the original sequence of 690 photographs, including both sides of leaves and blank pages.',
  'Title':'The work’s title, including marked expansions of ditto references. The original wording remains in the catalogue text.',
  'Author / source':'The author or attribution written in the catalogue. Inherited or editorial associations are identified separately.',
  'Type / status':'Whether this is a manuscript holding, cross-reference, heading, continuation, or annotation, together with cancellation and uncertainty notices.',
  'Title readings / context':'The literal title, any normalized form, and any inherited work context. These remain separate readings.',
  'Normalized title':'An editorially standardized form used to help searching. The original wording remains in the catalogue text.',
  'Readable heading':'A reader-facing title that expands the catalogue’s commentary signs and includes the identified base work. The original title remains in the catalogue text; uncertain identifications are marked.',
  'Inherited readings':'Titles and other values expanded from recorded ditto links or source context. Each keeps its evidence and source reference. Probable or uncertain expansions are marked uncertain; the literal catalogue text is unchanged.',
  'Work context':'Information inherited from a heading or related entry, kept separate from words visible in this entry.',
  'Catalogue text':'The full literal transcription of this catalogue entry, including abbreviations, additions and cancellations. Strikethrough marks cancelled writing; [?] marks uncertainty.',
  'Full catalogue text':'The full literal transcription, including abbreviations, additions, cancellations and uncertain readings.',
  'Uncertain readings':'Doubtful letters, alternative readings, and unresolved attachments identified during machine review. Other errors may remain.',
  'Annotations':'Descriptions of visible features such as ticks, arrows, additions, cancellations and marginal writing.',
  'Relationships':'Connections proposed between this record and other entries or headings. Each connection retains its evidence and degree of certainty.',
  'Review notes':'Observations made while checking the transcription against its source image.',
  'Editorial notes':'Explanations or search associations added during processing, kept separate from the catalogue’s literal wording.',
  'Amended readings':'Applied corrections showing the earlier reading, the replacement, and the reviewer’s reason. The original output remains in the downloadable transcription history.',
  'Record':'A stable identifier for this transcription record, used in downloads and the audit trail.'
};

function fieldHelpHTML(label, iconOnly=false) {
  const explanation=helpCopy[label];
  if(iconOnly)return '';
  if(!explanation)return escapeUIValue(label);
  return `<button type="button" class="field-help" data-field-help="${escapeUIValue(explanation)}" aria-label="Explain ${escapeUIValue(label)}" aria-expanded="false"><span>${escapeUIValue(label)}</span></button>`;
}

function fieldHelpAttributes(label){
  return helpCopy[label]?`data-field-help="${escapeUIValue(helpCopy[label])}" data-help-passive="true"`:'';
}

function highlightSearchResults(root,query){
  root.querySelectorAll('mark.search-hit').forEach(mark=>mark.replaceWith(document.createTextNode(mark.textContent)));root.normalize();
  if(query.trim()){
    const selectors='.entry-title,.entry-author,.entry-work-context,.entry-original-value,.entry-metadata dd,.entry-shelfmark,.transcription,.entry-note-section li,.catalogue-spreadsheet td';
    for(const container of root.querySelectorAll(selectors)){
      const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT),nodes=[];let content='';
      while(walker.nextNode()){const node=walker.currentNode;nodes.push({node,offset:content.length});content+=node.nodeValue;}
      const matches=searchMatchRanges(content,query);if(!matches.length)continue;
      for(const {node,offset} of nodes){
        const text=node.nodeValue,ranges=matches.filter(([start,stop])=>start<offset+text.length&&stop>offset).map(([start,stop])=>[Math.max(0,start-offset),Math.min(text.length,stop-offset)]);if(!ranges.length)continue;
        const fragment=document.createDocumentFragment();let end=0;
        for(const [start,stop] of ranges){
          fragment.append(document.createTextNode(text.slice(end,start)));
          const mark=document.createElement('mark');mark.className='search-hit';mark.textContent=text.slice(start,stop);fragment.append(mark);end=stop;
        }
        fragment.append(document.createTextNode(text.slice(end)));node.replaceWith(fragment);
      }
    }
  }
  for(const article of root.querySelectorAll('.catalogue-entry')){
    const count=article.querySelector('.entry-notes')?.querySelectorAll('mark.search-hit').length||0;
    const badge=article.querySelector('[data-note-hit-count]');if(!badge)continue;
    badge.hidden=!count;badge.textContent=count?`${count} hit${count===1?'':'s'}`:'';
    badge.setAttribute('aria-label',`${count} search matches in readings and editorial notes`);
  }
}

let entryImageCounter=0;
function entryImageControlsHTML(record) {
  const id=`entry-image-${++entryImageCounter}-${record.id}`;
  return `<div class="entry-image-controls"><button type="button" class="entry-image-toggle" data-entry-crop="${escapeUIValue(record.id)}" aria-controls="${escapeUIValue(id)}" aria-expanded="false" aria-label="Show entry image">Image</button><div class="entry-image-panel" id="${escapeUIValue(id)}" hidden></div></div>`;
}

// Keep separated marginal material in separate crops rather than spanning other
// entries. Nearby blocks on the same lines can share a single source crop.
function getEntryCropRegions(record, page, padding=18) {
  const [width,height]=page?.native_dimensions||[];
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
  const boxes=(record.locations||[]).map(l=>l.bbox).filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>0&&b[3]>0)
    .map(([x,y,w,h])=>({left:Math.max(0,Math.floor(x)),top:Math.max(0,Math.floor(y)),right:Math.min(width,Math.ceil(x+w)),bottom:Math.min(height,Math.ceil(y+h))}))
    .filter(b=>b.right>b.left&&b.bottom>b.top).sort((a,b)=>a.top-b.top||a.left-b.left);
  const groups=[];
  for(const box of boxes){
    const previous=groups.at(-1);
    if(previous&&box.top<=previous.bottom+32){
      previous.left=Math.min(previous.left,box.left);previous.right=Math.max(previous.right,box.right);previous.bottom=Math.max(previous.bottom,box.bottom);
    }else groups.push({...box});
  }
  return groups.map(b=>{
    const x=Math.max(0,b.left-padding),y=Math.max(0,b.top-padding);
    return [x,y,Math.min(width,b.right+padding)-x,Math.min(height,b.bottom+padding)-y];
  });
}

function entryCropURL(page, region) {
  return page?.image_mode==='bundled_local'?page.sourceImageURL:'';
}

let activeHelpControl=null, helpPinned=false;
function hideCatalogueHelp() {
  const tip=document.getElementById('field-tooltip');if(tip)tip.hidden=true;
  if(activeHelpControl){activeHelpControl.setAttribute('aria-expanded','false');activeHelpControl.removeAttribute('aria-describedby');}
  activeHelpControl=null;helpPinned=false;
}

function setupCatalogueUsability(catalogue) {
  const records=new Map(catalogue.records.map(r=>[r.id,r]));
  const pages=new Map(catalogue.pages.map(p=>[p.source_order,p]));
  const tip=document.createElement('div');tip.id='field-tooltip';tip.className='field-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  function showHelp(button,pinned=false){
    hideCatalogueHelp();activeHelpControl=button;helpPinned=pinned;
    tip.textContent=button.dataset.fieldHelp;tip.hidden=false;
    button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-expanded','true');
    const box=button.getBoundingClientRect(),tw=tip.offsetWidth||300,th=tip.offsetHeight||110;
    tip.style.left=Math.max(12,Math.min(box.left,window.innerWidth-tw-12))+'px';
    tip.style.top=Math.max(12,box.bottom+8+th<=window.innerHeight-12?box.bottom+8:box.top-th-8)+'px';
  }
  document.addEventListener('pointerover',event=>{
    const button=event.target.closest('[data-field-help]');
    if(button&&button!==activeHelpControl)showHelp(button);
  });
  document.addEventListener('pointerout',event=>{
    if(!activeHelpControl||helpPinned||document.activeElement===activeHelpControl)return;
    const next=event.relatedTarget;
    if(next&&(activeHelpControl.contains(next)||tip.contains(next)))return;
    if(activeHelpControl.contains(event.target)||tip.contains(event.target))hideCatalogueHelp();
  });
  document.addEventListener('focusin',event=>{const button=event.target.closest('[data-field-help]');if(button)showHelp(button);});
  document.addEventListener('focusout',event=>{if(activeHelpControl===event.target)hideCatalogueHelp();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeHelpControl){event.preventDefault();hideCatalogueHelp();}});
  document.addEventListener('scroll',hideCatalogueHelp,true);window.addEventListener('resize',hideCatalogueHelp);
  document.addEventListener('click',event=>{
    const help=event.target.closest('[data-field-help]');
    if(help?.dataset.helpPassive){hideCatalogueHelp();return;}
    if(help){if(activeHelpControl===help&&helpPinned)hideCatalogueHelp();else showHelp(help,true);return;}
    if(!tip.contains(event.target))hideCatalogueHelp();
    const notesButton=event.target.closest('[data-notes-toggle]');
    if(notesButton){
      const panel=document.getElementById(notesButton.getAttribute('aria-controls'));
      const open=notesButton.getAttribute('aria-expanded')==='true';
      panel.hidden=open;notesButton.setAttribute('aria-expanded',String(!open));return;
    }
    const button=event.target.closest('[data-entry-crop]');if(!button)return;
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    const expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));button.textContent=expanded?'Image':'Hide image';button.setAttribute('aria-label',expanded?'Show entry image':'Hide entry image');panel.hidden=expanded;
    if(expanded||panel.dataset.loaded)return;
    const record=records.get(button.dataset.entryCrop),page=pages.get(record?.source_order);
    const regions=record?getEntryCropRegions(record,page):[];
    const fullLink=page?`<a href="?page=${page.source_order}" data-open-folio="${page.source_order}" data-record="${escapeUIValue(record.id)}">View whole folio ↗</a>`:'';
    panel.dataset.loaded='true';
    if(!regions.length){panel.innerHTML=`<p class="entry-image-message">This record has no usable crop location. ${fullLink}</p>`;return;}
    panel.innerHTML=`<p class="entry-image-caption">${escapeUIValue(page.folio_label)} · approximate entry bounds${regions.length>1?' · separate parts of the entry':''}. ${fullLink}</p>`+
      regions.map((region,index)=>{
        const url=entryCropURL(page,region),[x,y,width,height]=region;
        return `<figure class="entry-crop-figure"><div class="entry-crop-frame" style="aspect-ratio:${width}/${height}"><img class="entry-crop-image" width="${width}" height="${height}" alt="Handwritten entry ${escapeUIValue(record.shelfmark||record.displayTitle||record.id)}, ${escapeUIValue(page.folio_label)}${regions.length>1?', part '+(index+1):''}"></div><figcaption><span class="entry-crop-status" role="status">Loading entry image…</span><a href="${escapeUIValue(url)}" target="_blank" rel="noopener noreferrer">Open bundled folio ↗</a><a href="${escapeUIValue(page.originalSourceImageURL)}" target="_blank" rel="noopener noreferrer">High-resolution at the Bodleian ↗</a></figcaption></figure>`;
      }).join('');
    panel.querySelectorAll('.entry-crop-image').forEach((img,index)=>{
      const region=regions[index],status=img.closest('figure').querySelector('.entry-crop-status');
      const [cropX,cropY,cropW,cropH]=region;
      Object.assign(img.style,{position:'absolute',width:(page.native_dimensions[0]/cropW*100)+'%',height:'auto',maxWidth:'none',left:(-cropX/cropW*100)+'%',top:(-cropY/cropH*100)+'%'});
      img.addEventListener('load',()=>{status.textContent=img.dataset.fallback?'Offline preview · lower resolution':`Bundled-image crop · ${page.bundled_dimensions[1].toLocaleString()} px source height · below native resolution`;});
      img.addEventListener('error',()=>{
        if(img.dataset.fallback){img.hidden=true;status.textContent='Image unavailable. Use the whole-folio link.';return;}
        img.dataset.fallback='true';status.textContent='Loading local preview…';
        const [x,y,width,height]=region;
        Object.assign(img.style,{position:'absolute',width:(page.native_dimensions[0]/width*100)+'%',height:'auto',maxWidth:'none',left:(-x/width*100)+'%',top:(-y/height*100)+'%'});
        img.src=page.imagePath;
      });
      img.src=entryCropURL(page,region);
    });
  });
}

// Editorial subject classification, kept separate from the literal subject field.
function classificationTagLabel(tag){return tag.label+(tag.confidence==='uncertain'?' · uncertain':'');}
function classificationEvidence(record){
 const c=record.classification;if(!c)return [];
 return [...c.subjects,...c.traditions].map(tag=>`${classificationTagLabel(tag)}: ${tag.evidence.map(e=>e.text).join(' | ')}`).concat(c.notes||[]);
}
function classificationFilter(record,subjectTags=[],traditionTags=[]){
 const c=record.classification;
 if(!c)return !subjectTags.length&&!traditionTags.length;
 if(subjectTags.length&&!subjectTags.some(id=>c.subjects.some(tag=>tag.id===id)))return false;
 if(traditionTags.length&&!traditionTags.some(id=>c.traditions.some(tag=>tag.id===id)))return false;
 return true;
}
function classificationHTML(record,escape){
 const c=record.classification;if(!c)return '';
 function badges(tags,dimension){return tags.map(tag=>{
  const evidence=tag.evidence.map(e=>e.text).join(' | ');
  return `<button type="button" class="classification-tag" data-filter-${dimension}-tag="${escape(tag.id)}" title="${escape(evidence)}" aria-label="Filter by ${escape(tag.label)}">${escape(tag.label)}</button>`;
 }).join('');}
 return `<div class="entry-classification" aria-label="Editorial classification"><div class="classification-row"><span class="classification-label">Subject tags</span>${c.subjects.length?badges(c.subjects,'subject'):'<span class="classification-unassigned">Unclassified · insufficient evidence</span>'}</div>${c.traditions.length?`<div class="classification-row"><span class="classification-label">Tradition</span>${badges(c.traditions,'tradition')}</div>`:''}</div>`;
}


function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function readingParts(value) {
  const text=String(value??'');const parts=[];let cursor=0;
  for(let start=0;start<text.length;start++){
    if(text[start]!=='⟦')continue;
    let depth=1,end=start+1;
    for(;end<text.length;end++){
      if(text[end]==='⟦')depth++;
      else if(text[end]==='⟧'&&!--depth)break;
    }
    // An incomplete delimiter does not establish where the cancellation ends.
    if(depth)break;
    parts.push({text:text.slice(cursor,start),cancelled:false},{text:text.slice(start+1,end).replace(/[⟦⟧]/g,''),cancelled:true});
    cursor=end+1;start=end;
  }
  parts.push({text:text.slice(cursor),cancelled:false});return parts;
}

/** Render only explicitly delimited cancellations; keep source strings intact. */
function readingHTML(value) {
  return readingParts(value).map(part=>part.cancelled?`<del class="cancelled-text" title="Cancelled in the source">${escapeHTML(part.text)}</del>`:escapeHTML(part.text)).join('');
}

function cancelledEntry(record){
  return record.status==='cancelled'||/^(?:cancelled|cancelled_(?:entry|holding|ditto_entry)(?:_(?:with_.+|redirected|moved|converted))?)$/.test(record.subtype||'');
}
const cancellationCache=new WeakMap();
const cancellationKey=text=>String(text??'').normalize('NFD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Carry source cancellation into extracted summary fields, not into other data. */
function summaryReadingHTML(record,field,displayed){
  const sourceValue=({title:record.titleLiteral||record.title_literal,author:record.authorOrSource||record.author_or_source,shelfmark:record.shelfmark})[field];
  const key=cancellationKey(sourceValue||displayed);
  let parts=cancellationCache.get(record);
  if(!parts){parts=readingParts(record.transcription).map(part=>({...part,key:cancellationKey(part.text)}));cancellationCache.set(record,parts);}
  const sourceCancelled=key.length>=4&&parts.some(p=>p.cancelled&&p.key.includes(key))&&!parts.some(p=>!p.cancelled&&p.key.includes(key));
  if((field==='title'&&cancelledEntry(record))||sourceCancelled){
    return `<del class="cancelled-text" title="Cancelled in the source">${escapeHTML(readingParts(displayed).map(p=>p.text).join(''))}</del>`;
  }
  return readingHTML(displayed);
}

const plain = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${fieldLabel(key)}: ${plain(item)}`).join('\n');
  return String(value);
};
const fieldLabel = key => ({title_literal:'Title as written',titleLiteral:'Title as written',title_normalized:'Normalized title',titleNormalized:'Normalized title',author_or_source:'Author / source',authorOrSource:'Author / source',shelfmark:'Shelfmark',extent:'Extent',status:'Status',date:'Date',lines:'Lines',script:'Script',transcription:'Catalogue text',subject:'Subject'}[key] || key.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2'));
const value = (record, camel, snake = camel) => record[camel] ?? record[snake];
const kindOf = record => record.kind || (record.shelfmark ? 'manuscript' : record.status === 'heading' ? 'heading' : 'note');
const capitalize = text => text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
const statusOf = record => [record.subtype?.includes('facing_page')?'Facing-page fragment / context':'',({manuscript:'Manuscript entry',heading:'Cross-reference',section:'Section heading',continuation:'Continuation note',note:'Unattached annotation',other:'Other catalogue text'}[kindOf(record)] || capitalize(kindOf(record))), record.isCancelled || record.status === 'cancelled' ? 'Contains cancelled writing' : '', record.needsReview ? 'Unresolved readings' : 'Machine reviewed'].filter(Boolean).join(' · ');
const originalReadings = record => value(record, 'originalFieldReadings', 'model_original_fields') || (record.change_audit || []).filter(c=>c.applied).map(c=>({field:c.field_path,before:c.before,after:c.after,reason:c.reason}));
const folioLink = record => `<a class="folio-link" href="?page=${encodeURIComponent(record.source_order)}" data-open-folio="${record.source_order}" data-record="${escapeHTML(record.id)}">fol. ${escapeHTML(record.folio)}</a>`;
const list = items => `<ul>${items.map(item => `<li>${readingHTML(item)}</li>`).join('')}</ul>`;
const noteSection = (label, items) => {
  const values = Array.isArray(items) ? items.filter(item => plain(item).trim()) : plain(items).trim() ? [items] : [];
  return values.length ? `<section class="entry-note-section"><h4>${fieldHelpHTML(label)}</h4>${list(values.map(plain))}</section>` : '';
};

function titleReadings(record) {
  return [
    ['Readable heading', record.readableTitle?.value],
    ['Expanded title', record.resolvedFields?.title?.value],
    ['As written', value(record, 'titleLiteral', 'title_literal')],
    ['Normalized', value(record, 'titleNormalized', 'title_normalized')],
    ['Work context', record.resolvedFields?.work?.value || value(record, 'contextWork', 'context_work')]
  ].filter(([, text]) => plain(text).trim()).map(([label, text]) => `${label}: ${plain(text)}`).join('\n');
}

const inheritedLabel=field=>({title:'Title',author:'Author',source:'Source',subject:'Subject',date:'Date',extent:'Extent',lines:'Lines',script:'Script',incipit:'Incipit',work:'Work context'})[field]||field;
const inheritedReadings=record=>Object.entries(record.resolvedFields||{}).map(([field,c])=>`${inheritedLabel(field)}: ${c.value} (${c.certainty==='secure'?'inherited':'inherited; uncertain'}). ${c.source_folio?'Source fol. '+c.source_folio+'. ':''}${c.source_record_id?'Record '+c.source_record_id+'. ':''}${c.evidence}`);
function inheritanceHTML(record){
 const fields=Object.entries(record.resolvedFields||{}).filter(([field])=>field!=='work'&&!(field==='title'&&record.readableTitle));
 if(record.readableTitle)fields.unshift(['title',record.readableTitle]);
 if(!fields.length)return '';
 return `<p class="entry-inheritance">${fields.map(([field,c])=>{
  const source=c.source_page_order?` from <a href="?page=${encodeURIComponent(c.source_page_order)}" data-open-folio="${c.source_page_order}"${c.source_record_id?` data-record="${escapeHTML(c.source_record_id)}"`:''}>catalogue fol. ${escapeHTML(c.source_folio||c.source_page_order)}</a>`:' from catalogue context';
  const verb=field==='title'&&record.readableTitle?'expanded':'supplied';
  return `<span class="inherited-field${c.certainty==='secure'?'':' uncertain'}" title="${escapeHTML(c.evidence||'')}">${inheritedLabel(field)} ${verb}${source}${c.certainty==='secure'||field==='title'?'':' · uncertain'}</span>`;
 }).join('; ')}.</p>`;
}

function authorReadings(record) {
  const displayed = authorOf(record);
  const raw = plain(value(record, 'authorOrSource', 'author_or_source'));
  return raw && raw !== displayed ? `${displayed}\nAs written: ${raw}`.trim() : displayed;
}

/** A complete source entry, with its evidence inline and editorial details closed. */
let notesCounter=0;
function catalogueEntryHTML(record) {
  const title = titleOf(record);
  const author = authorOf(record);
  const literal = plain(value(record, 'titleLiteral', 'title_literal'));
  const originalAuthor = plain(value(record, 'authorOrSource', 'author_or_source'));
  const normalizedTitle = plain(value(record, 'titleNormalized', 'title_normalized'));
  const context = plain(record.resolvedFields?.work?.value || value(record, 'contextWork', 'context_work'));
  const titleContext = record.readableTitle || record.resolvedFields?.title;
  const uncertainTitle=titleContext&&titleContext.certainty!=='secure';
  const recordID=record.id ?? record.record_id ?? '';
  const kindLabel=({manuscript:'Manuscript entry',heading:'Cross-reference',section:'Section heading',continuation:'Continuation note',note:'Unattached annotation',other:'Other catalogue text'}[kindOf(record)]||capitalize(kindOf(record)));
  const notes = [
    noteSection('Record subtype',record.subtype),
    noteSection('Type / status',statusOf(record)),
    literal && literal !== title ? noteSection('Title as written',literal) : '',
    originalAuthor && originalAuthor !== author ? noteSection('Author / source as written',originalAuthor) : '',
    context ? noteSection('Work context', context) : '',
    noteSection('Inherited readings', inheritedReadings(record)),
    record.readableTitle?noteSection('Readable heading',`${record.readableTitle.value} (${record.readableTitle.certainty==='secure'?'expanded catalogue abbreviation':'uncertain identification'}). ${record.readableTitle.evidence}`):'',
    normalizedTitle && normalizedTitle !== literal ? noteSection('Normalized title', normalizedTitle) : '',
    noteSection('Uncertain readings', record.uncertainties),
    noteSection('Annotations',record.annotations),
    noteSection('Relationships',(record.relationships||[]).map(l=>`${l.type} → image ${l.target_page_order}, ${l.target_anchor||l.target_record_id||l.target_block_id||''} (${l.certainty}). ${l.evidence||''}`)),
    noteSection('Review notes', value(record, 'reviewNotes', 'review_notes')),
    noteSection('Editorial notes', value(record, 'editorialNotes', 'editorial_notes')),
    noteSection('Classification evidence', classificationEvidence(record)),
    noteSection('Amended readings', Object.keys(originalReadings(record)).length ? plain(originalReadings(record)) : '')
  ].join('');
  const metadata = ['date','extent','lines','script'].map(field=>[inheritedLabel(field),fieldValue(record,field)]).filter(([,text])=>plain(text).trim());
  const descriptions = ['source','subject','incipit'].map(field=>[inheritedLabel(field),fieldValue(record,field)]).filter(([,text])=>plain(text).trim());
  const metadataHTML=(fields,extra='')=>fields.length?`<dl class="entry-metadata ${extra}">${fields.map(([label,text])=>`<div><dt>${fieldHelpHTML(label)}</dt><dd>${readingHTML(plain(text))}</dd></div>`).join('')}</dl>`:'';
  const unique=++notesCounter;
  const notesID=`readings-${unique}-${recordID}`;
  const citationID=`citation-${unique}-${recordID}`;
  const citation=citationFor(record);
  return `<article data-record-type="${escapeHTML(record.record_type)}" class="catalogue-entry${record.isCancelled || record.status === 'cancelled' ? ' cancelled-entry' : ''}" id="entry-${escapeHTML(recordID)}" aria-labelledby="title-${escapeHTML(recordID)}">
    <header class="catalogue-entry-header">
      <a class="entry-shelfmark" href="?record=${encodeURIComponent(recordID)}" data-record-link="${escapeHTML(recordID)}" aria-label="Link to ${escapeHTML(record.shelfmark||kindLabel)}">${record.shelfmark?summaryReadingHTML(record,'shelfmark',record.shelfmark):escapeHTML(kindLabel)}</a>
      <div class="entry-heading"><h3 class="entry-title" id="title-${escapeHTML(recordID)}">${summaryReadingHTML(record,'title',title)}</h3>${uncertainTitle?'<span class="entry-identification">Identification uncertain</span>':''}${kindOf(record)!=='manuscript'&&record.shelfmark?`<span class="entry-kind">${escapeHTML(kindLabel)}</span>`:''}${cancelledEntry(record)?'<span class="entry-cancellation">Struck through in the catalogue</span>':''}</div>
      ${folioLink(record).replace('>fol.','>Catalogue fol.')}
    </header>
    <div class="entry-body">
      <div class="entry-particulars">${author ? `<p class="entry-author">${summaryReadingHTML(record,'author',author)}</p>` : ''}${metadataHTML(metadata)}</div>
      ${inheritanceHTML(record)}
      ${record.resolvedFields?.work&&!record.readableTitle?.work?`<p class="entry-work-context"><span>Work context:</span> ${readingHTML(context)}${record.resolvedFields.work.certainty==='secure'?'':' <span class="inherited-field uncertain">· uncertain</span>'}</p>`:''}
      ${metadataHTML(descriptions,'entry-descriptive')}
      <div class="entry-source-text"><h4>${fieldHelpHTML('Catalogue text')}</h4><p class="transcription full-transcription">${readingHTML(record.transcription)}</p></div>
      ${record.attachedRecords?.length ? `<section class="attached-notes"><h4>Continuation notes</h4>${record.attachedRecords.map(n=>`<div class="attached-note">${folioLink(n)}<p class="transcription">${readingHTML(n.transcription)}</p>${noteSection('Uncertain readings',n.uncertainties)}${noteSection('Annotations',n.annotations)}${entryImageControlsHTML(n)}</div>`).join('')}</section>` : ''}
      ${record.attachedTo ? `<p class="attachment-label">Continuation note · <a href="?record=${encodeURIComponent(record.attachedTo)}" data-record-link="${escapeHTML(record.attachedTo)}">View parent entry</a></p>` : ''}
      <div class="entry-bottom">
        ${classificationHTML(record,escapeHTML)}
        <div class="entry-actions-row">
          ${entryImageControlsHTML(record)}
          <button type="button" class="notes-toggle" data-notes-toggle aria-expanded="false" aria-controls="${escapeHTML(notesID)}" aria-label="Readings and editorial notes"><span>Notes</span><span class="note-hit-count" data-note-hit-count hidden></span></button>
          <button type="button" class="citation-toggle" data-citation-toggle aria-expanded="false" aria-controls="${escapeHTML(citationID)}" aria-label="Citation for this catalogue entry">Cite</button>
          <a class="transcription-history" href="${escapeHTML(record.auditPath)}" download="transcription-history-image-${record.source_order}.json" title="Transcription history for the whole catalogue folio: machine readings, review corrections, unresolved alternatives and image locations." aria-label="Download transcription history as JSON">Download JSON</a>
        </div>
      </div>
      <div class="entry-notes" id="${escapeHTML(notesID)}" hidden>${notes}</div>
      <section class="entry-citation" id="${escapeHTML(citationID)}" hidden aria-label="Citation"><p class="citation-text">${escapeHTML(citation)}</p><p class="citation-explanation">This cites the handwritten catalogue and the entry it describes.</p><div><button type="button" data-copy-citation="${escapeHTML(citation)}">Copy citation</button><a href="?record=${encodeURIComponent(recordID)}" data-record-link="${escapeHTML(recordID)}">Link to this entry</a></div></section>
    </div>
  </article>`;
}


/** Every existing field remains available; likely witness-comparison fields lead. */
const spreadsheetColumns = [
  {key:'shelfmark',label:'Shelfmark',value:r=>plain(r.shelfmark),className:'sticky-shelfmark'},
  {key:'title',label:'Title',value:titleOf,className:'title-cell'},
  {key:'author',label:'Author / source',value:authorReadings,className:'author-cell'},
  {key:'date',label:'Date',value:r=>plain(fieldValue(r,'date'))},
  {key:'extent',label:'Extent',value:r=>plain(fieldValue(r,'extent'))},
  {key:'script',label:'Script',value:r=>plain(fieldValue(r,'script'))},
  {key:'lines',label:'Lines',value:r=>plain(fieldValue(r,'lines'))},
  {key:'incipit',label:'Incipit',value:r=>plain(fieldValue(r,'incipit')),className:'incipit-cell'},
  {key:'folio',label:'Catalogue folio',helpLabel:'Folio',value:r=>plain(r.folio)},
  {key:'subject',label:'Subject',value:r=>plain(fieldValue(r,'subject'))},
  {key:'subjectTags',label:'Subject tags',value:r=>(r.classification?.subjects||[]).map(tag=>tag.label).join('\n'),className:'tag-cell'},
  {key:'traditionTags',label:'Tradition tags',value:r=>(r.classification?.traditions||[]).map(tag=>tag.label).join('\n'),className:'tag-cell'},
  {key:'source',label:'Source',value:r=>plain(fieldValue(r,'source'))},
  {key:'transcription',label:'Full catalogue text',value:r=>plain(r.transcription),className:'wide-transcription'},
  {key:'uncertainties',label:'Uncertain readings',value:r=>plain(r.uncertainties),className:'notes-cell'},
  {key:'titleLiteral',label:'Title readings / context',value:titleReadings,className:'notes-cell'},
  {key:'inheritedReadings',label:'Inherited readings',value:r=>inheritedReadings(r).join('\n'),className:'notes-cell'},
  {key:'relationships',label:'Relationships',value:r=>plain(r.relationships),className:'notes-cell'},
  {key:'annotations',label:'Annotations',value:r=>plain(r.annotations),className:'notes-cell'},
  {key:'status',label:'Type / status',value:statusOf},
  {key:'classificationStatus',label:'Classification status',value:r=>r.classification?.status||''},
  {key:'reviewNotes',label:'Review notes',value:r=>plain(value(r,'reviewNotes','review_notes')),className:'notes-cell'},
  {key:'editorialNotes',label:'Editorial notes',value:r=>plain(value(r,'editorialNotes','editorial_notes')),className:'notes-cell'},
  {key:'originalFieldReadings',label:'Amended readings',value:r=>plain(originalReadings(r)),className:'notes-cell'},
  {key:'source_order',label:'Source image',value:r=>r.source_order},
  {key:'id',label:'Record',value:r=>plain(r.id ?? r.record_id)}
];

function spreadsheetInheritanceHTML(record,key){
  const reading=key==='title'?record.readableTitle||record.resolvedFields?.title:record.resolvedFields?.[key];
  if(!reading)return '';
  const certain=reading.certainty==='secure';
  return ` <span class="inherited-field${certain?'':' uncertain'}">(${certain?'inherited':'inherited; uncertain'})</span>`;
}

/** Sort keys, help, complete text and reading provenance survive the column reorder. */
function spreadsheetHTML(records, {sortKey, sortDirection = 'asc'} = {}) {
  const column = spreadsheetColumns.find(item => item.key === sortKey);
  const descending = sortDirection === 'desc' || sortDirection === 'descending';
  const headings = spreadsheetColumns.map(item => `<th scope="col" data-column="${item.key}"${item.className ? ` class="${item.className}"` : ''} aria-sort="${column?.key === item.key ? descending ? 'descending' : 'ascending' : 'none'}"><div class="column-heading"><button type="button" data-column-sort="${item.key}" ${fieldHelpAttributes(item.helpLabel||item.label)}>${escapeHTML(item.label)}${column?.key === item.key ? `<span aria-hidden="true"> ${descending ? '↓' : '↑'}</span>` : ''}</button></div></th>`).join('');
  const rows = records.map(record => `<tr data-record-id="${escapeHTML(record.id ?? record.record_id ?? '')}"${record.isCancelled || record.status === 'cancelled' ? ' class="cancelled-entry"' : ''}>${spreadsheetColumns.map(item => `<td data-column="${item.key}"${item.className ? ` class="${item.className}"` : ''}>${item.key === 'folio' ? folioLink(record) : (['title','author','shelfmark'].includes(item.key)?summaryReadingHTML(record,item.key,item.value(record)):readingHTML(item.value(record)))+spreadsheetInheritanceHTML(record,item.key)}</td>`).join('')}</tr>`).join('');
  return `<table class="catalogue-spreadsheet"><caption class="sr-only">Manuscript catalogue entries. Shelfmark, title, author and manuscript particulars appear first; all catalogue text and editorial evidence remain available in later columns. Scroll horizontally to read every field.</caption><thead><tr>${headings}</tr></thead><tbody>${rows || `<tr><td colspan="${spreadsheetColumns.length}" class="empty-cell">No entries match the current search.</td></tr>`}</tbody></table>`;
}

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

function ensureRecordDetails(records){return dataLoadRecordSet(records);}
function ensurePageDetails(sourceOrder){return dataLoadPage(sourceOrder);}
function ensureAllRecordDetails(){
 const catalogue=dataLoadState();
 if(!catalogue.lazyData)return Promise.resolve(catalogue.records);
 return Promise.all(catalogue.pages.map(page=>dataLoadPage(page.source_order))).then(()=>catalogue.records);
}
function ensureSearchIndex(){
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

const esc=escapeHTML;

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
 if(b.dataset.view||b.dataset.query!==undefined||b.dataset.page||b.dataset.filterSubjectTag||b.dataset.filterTraditionTag||b.dataset.remove||b.dataset.columnSort)state.focusRecord=null;
 if(b.dataset.view){showView(b.dataset.view);window.scrollTo({top:0});}
 if(b.dataset.query!==undefined){Object.assign(state,{query:b.dataset.query,kind:state.kind,subject:'',folio:'',review:false,includeCancelled:true,sort:'relevance',page:1});syncControls();renderResults();}
 if(b.dataset.filterFolio)browseFolio(b.dataset.filterFolio);
 if(b.dataset.page){state.page=Number(b.dataset.page);renderResults();$('.results-toolbar').scrollIntoView({block:'start'});}
 if(b.dataset.filterSubjectTag){addTag('subjects',b.dataset.filterSubjectTag);return;}
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

})();
