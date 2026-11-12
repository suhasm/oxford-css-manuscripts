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
export function normalize(value) {
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

export function titleOf(record = {}) {
  return first(record.readableTitle?.value, record.resolvedFields?.title?.value, record.displayTitle, record.display_title, record.titleNormalized, record.title_normalized,
    record.titleLiteral, record.title_literal) || (record.kind === 'note' || record.status === 'note' ? 'Catalogue note' : 'Untitled entry');
}

export function authorOf(record = {}) {
  return first(record.resolvedFields?.author?.value, record.displayAuthor, record.display_author, record.authorOrSource, record.author_or_source);
}

export function fieldValue(record,field){
  return record.resolvedFields?.[field]?.value ?? record[({author:'authorOrSource',title:'titleLiteral'})[field]||field] ?? '';
}

/** Cite the source catalogue, distinguishing the catalogued item from its source. */
export function citationFor(record = {}) {
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

export const searchScopeLabels={all:'All fields',title:'Title',author:'Author',shelfmark:'Shelfmark',transcription:'Catalogue text'};
const scopeFields={all:[0,1,2,3,4,5,6],title:[0],author:[2],shelfmark:[1],transcription:[7]};

export function searchQueryTerms(query='') {
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
export function searchRecords(records, query = '', scope='all') {
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

export function searchMatchRanges(value, query='') {
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

export function precomputeSearchIndex(records){return Object.fromEntries(records.map(record=>[record.id,fieldsOf(record)]));}
