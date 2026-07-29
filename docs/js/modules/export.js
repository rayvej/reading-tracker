/**
 * Data Export Utilities (CSV, Excel SheetJS, Markdown Vault JSZip)
 */

import { showToast } from './ui.js';

export function exportAllDataToCSV(booksCache, logsCache) {
  if (!booksCache.length && !logsCache.length) {
    showToast('No data available to export.', 'error');
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Type,Title,Author,Pages,Status,ReadCount,Date,StartPage,EndPage,Minutes,Notes\n";

  booksCache.forEach(b => {
    const row = [
      'Book',
      `"${(b.title || '').replace(/"/g, '""')}"`,
      `"${(b.author || '').replace(/"/g, '""')}"`,
      b.total_pages || 0,
      `"${b.status || ''}"`,
      b.read_count || 0,
      '', '', '', '', ''
    ];
    csvContent += row.join(",") + "\n";
  });

  logsCache.forEach(l => {
    const row = [
      'Log',
      `"${(l.book_title || '').replace(/"/g, '""')}"`,
      '', '', '',
      l.read_cycle || 1,
      l.date || '',
      l.start_page || 0,
      l.end_page || 0,
      l.minutes_spent || '',
      `"${(l.notes || '').replace(/"/g, '""')}"`
    ];
    csvContent += row.join(",") + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `reading_tracker_export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('✓ CSV Export downloaded successfully!', 'success');
}

export function exportToExcel(booksCache, logsCache) {
  if (typeof XLSX === 'undefined') {
    showToast('Excel exporter library is loading, please try again in a moment.', 'error');
    return;
  }

  const wb = XLSX.utils.book_new();

  const booksData = booksCache.map(b => ({
    Title: b.title || '',
    Author: b.author || '',
    Pages: b.total_pages || 0,
    Status: b.status || '',
    'Read Count': b.read_count || 0,
    Category: b.category || '',
    Format: b.format || ''
  }));
  const wsBooks = XLSX.utils.json_to_sheet(booksData);
  XLSX.utils.book_append_sheet(wb, wsBooks, "Books Library");

  const logsData = logsCache.map(l => ({
    Date: l.date || '',
    'Book Title': l.book_title || '',
    Cycle: l.read_cycle || 1,
    'Start Page': l.start_page || 0,
    'End Page': l.end_page || 0,
    'Pages Read': Math.max(0, (l.end_page || 0) - (l.start_page || 0)),
    'Minutes Spent': l.minutes_spent || 0,
    Notes: l.notes || ''
  }));
  const wsLogs = XLSX.utils.json_to_sheet(logsData);
  XLSX.utils.book_append_sheet(wb, wsLogs, "Reading Logs");

  XLSX.writeFile(wb, `Reading_Tracker_Workbook_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast('✓ Excel (.xlsx) Workbook downloaded!', 'success');
}

export async function exportMarkdownVault(notesList) {
  if (typeof JSZip === 'undefined') {
    showToast('ZIP Exporter library is loading, please try again in a moment.', 'error');
    return;
  }

  const zip = new JSZip();
  const vaultFolder = zip.folder("Reading_Tracker_Markdown_Vault");

  notesList.forEach((n, idx) => {
    const fileName = `${(n.title || `Note_${idx + 1}`).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    const mdContent = `---
title: "${n.title || 'Untitled'}"
date: "${n.date || new Date().toISOString().slice(0, 10)}"
isQuote: ${Boolean(n.isQuote)}
isFavorite: ${Boolean(n.isFavorite)}
---

# ${n.title || 'Untitled Note'}

${n.notes || ''}
`;
    vaultFolder.file(fileName, mdContent);
  });

  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = `Reading_Tracker_Vault_${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('✓ Markdown Vault ZIP downloaded!', 'success');
}
