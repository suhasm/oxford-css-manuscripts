import {fieldHelpHTML, entryImageControlsHTML} from './usability.mjs';
import {titleOf, authorOf, fieldValue, citationFor} from './search.mjs';
import {classificationHTML, classificationEvidence} from './tags.mjs';

export function escapeHTML(value) {
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
export function readingHTML(value) {
  return readingParts(value).map(part=>part.cancelled?`<del class="cancelled-text" title="Cancelled in the source">${escapeHTML(part.text)}</del>`:escapeHTML(part.text)).join('');
}

export function cancelledEntry(record){
  return record.status==='cancelled'||/^(?:cancelled|cancelled_(?:entry|holding|ditto_entry)(?:_(?:with_.+|redirected|moved|converted))?)$/.test(record.subtype||'');
}
const cancellationCache=new WeakMap();
const cancellationKey=text=>String(text??'').normalize('NFD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Carry source cancellation into extracted summary fields, not into other data. */
export function summaryReadingHTML(record,field,displayed){
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

export const plain = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${fieldLabel(key)}: ${plain(item)}`).join('\n');
  return String(value);
};
const fieldLabel = key => ({title_literal:'Title as written',titleLiteral:'Title as written',title_normalized:'Normalized title',titleNormalized:'Normalized title',author_or_source:'Author / source',authorOrSource:'Author / source',shelfmark:'Shelfmark',extent:'Extent',status:'Status',date:'Date',lines:'Lines',script:'Script',transcription:'Catalogue text',subject:'Subject'}[key] || key.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2'));
export const value = (record, camel, snake = camel) => record[camel] ?? record[snake];
const kindOf = record => record.kind || (record.shelfmark ? 'manuscript' : record.status === 'heading' ? 'heading' : 'note');
const capitalize = text => text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
export const statusOf = record => [record.subtype?.includes('facing_page')?'Facing-page fragment / context':'',({manuscript:'Manuscript entry',heading:'Cross-reference',section:'Section heading',continuation:'Continuation note',note:'Unattached annotation',other:'Other catalogue text'}[kindOf(record)] || capitalize(kindOf(record))), record.isCancelled || record.status === 'cancelled' ? 'Contains cancelled writing' : '', record.needsReview ? 'Unresolved readings' : 'Machine reviewed'].filter(Boolean).join(' · ');
export const originalReadings = record => value(record, 'originalFieldReadings', 'model_original_fields') || (record.change_audit || []).filter(c=>c.applied).map(c=>({field:c.field_path,before:c.before,after:c.after,reason:c.reason}));
export const folioLink = record => `<a class="folio-link" href="?page=${encodeURIComponent(record.source_order)}" data-open-folio="${record.source_order}" data-record="${escapeHTML(record.id)}">fol. ${escapeHTML(record.folio)}</a>`;
const list = items => `<ul>${items.map(item => `<li>${readingHTML(item)}</li>`).join('')}</ul>`;
const noteSection = (label, items) => {
  const values = Array.isArray(items) ? items.filter(item => plain(item).trim()) : plain(items).trim() ? [items] : [];
  return values.length ? `<section class="entry-note-section"><h4>${fieldHelpHTML(label)}</h4>${list(values.map(plain))}</section>` : '';
};

export function titleReadings(record) {
  return [
    ['Readable heading', record.readableTitle?.value],
    ['Expanded title', record.resolvedFields?.title?.value],
    ['As written', value(record, 'titleLiteral', 'title_literal')],
    ['Normalized', value(record, 'titleNormalized', 'title_normalized')],
    ['Work context', record.resolvedFields?.work?.value || value(record, 'contextWork', 'context_work')]
  ].filter(([, text]) => plain(text).trim()).map(([label, text]) => `${label}: ${plain(text)}`).join('\n');
}

const inheritedLabel=field=>({title:'Title',author:'Author',source:'Source',subject:'Subject',date:'Date',extent:'Extent',lines:'Lines',script:'Script',incipit:'Incipit',work:'Work context'})[field]||field;
export const inheritedReadings=record=>Object.entries(record.resolvedFields||{}).map(([field,c])=>`${inheritedLabel(field)}: ${c.value} (${c.certainty==='secure'?'inherited':'inherited; uncertain'}). ${c.source_folio?'Source fol. '+c.source_folio+'. ':''}${c.source_record_id?'Record '+c.source_record_id+'. ':''}${c.evidence}`);
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

export function authorReadings(record) {
  const displayed = authorOf(record);
  const raw = plain(value(record, 'authorOrSource', 'author_or_source'));
  return raw && raw !== displayed ? `${displayed}\nAs written: ${raw}`.trim() : displayed;
}

/** A complete source entry, with its evidence inline and editorial details closed. */
let notesCounter=0;
export function catalogueEntryHTML(record) {
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
