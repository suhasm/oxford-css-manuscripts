import {escapeHTML, readingHTML, summaryReadingHTML, plain, value, statusOf, authorReadings, titleReadings, inheritedReadings, originalReadings, folioLink} from './presentation.mjs';
import {titleOf, fieldValue} from './search.mjs';
import {fieldHelpAttributes} from './usability.mjs';

/** Every existing field remains available; likely witness-comparison fields lead. */
export const spreadsheetColumns = [
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
export function spreadsheetHTML(records, {sortKey, sortDirection = 'asc'} = {}) {
  const column = spreadsheetColumns.find(item => item.key === sortKey);
  const descending = sortDirection === 'desc' || sortDirection === 'descending';
  const headings = spreadsheetColumns.map(item => `<th scope="col" data-column="${item.key}"${item.className ? ` class="${item.className}"` : ''} aria-sort="${column?.key === item.key ? descending ? 'descending' : 'ascending' : 'none'}"><div class="column-heading"><button type="button" data-column-sort="${item.key}" ${fieldHelpAttributes(item.helpLabel||item.label)}>${escapeHTML(item.label)}${column?.key === item.key ? `<span aria-hidden="true"> ${descending ? '↓' : '↑'}</span>` : ''}</button></div></th>`).join('');
  const rows = records.map(record => `<tr data-record-id="${escapeHTML(record.id ?? record.record_id ?? '')}"${record.isCancelled || record.status === 'cancelled' ? ' class="cancelled-entry"' : ''}>${spreadsheetColumns.map(item => `<td data-column="${item.key}"${item.className ? ` class="${item.className}"` : ''}>${item.key === 'folio' ? folioLink(record) : (['title','author','shelfmark'].includes(item.key)?summaryReadingHTML(record,item.key,item.value(record)):readingHTML(item.value(record)))+spreadsheetInheritanceHTML(record,item.key)}</td>`).join('')}</tr>`).join('');
  return `<table class="catalogue-spreadsheet"><caption class="sr-only">Manuscript catalogue entries. Shelfmark, title, author and manuscript particulars appear first; all catalogue text and editorial evidence remain available in later columns. Scroll horizontally to read every field.</caption><thead><tr>${headings}</tr></thead><tbody>${rows || `<tr><td colspan="${spreadsheetColumns.length}" class="empty-cell">No entries match the current search.</td></tr>`}</tbody></table>`;
}
