// CSV för kundunderlaget.
// Format: UTF-8 med BOM, semikolon som avgränsare, CRLF mellan rader, fält med ; " eller radbrytning citeras.
// "Tid (h:mm)" är avrundat till minut. "Timmar (decimal)" har två decimaler och decimalkomma (svenskt kalkylblad).
// Textfält som börjar med = + - @ tab eller CR får ett inledande apostrof så att kalkylblad inte tolkar dem som formler.
import { decimalHours, formatHmm } from './format.js';
import { MISSING_TEXT } from './report.js';

export const CSV_HEADER = ['Datum', 'Kund', 'Projekt', 'Arbetsbeskrivning', 'Debiterbar', 'Tid (h:mm)', 'Timmar (decimal)'];

export function safeText(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvField(value) {
  const s = String(value ?? '');
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(report) {
  const lines = [CSV_HEADER.map(csvField).join(';')];
  for (const r of report.rows) {
    lines.push([
      r.day,
      safeText(r.client),
      safeText(r.projectName),
      safeText(r.missing ? MISSING_TEXT : r.description),
      r.billable ? 'Ja' : 'Nej',
      formatHmm(r.ms),
      decimalHours(r.ms),
    ].map(csvField).join(';'));
  }
  lines.push(['Summa', '', '', '', '', formatHmm(report.totalMs), decimalHours(report.totalMs)].map(csvField).join(';'));
  return lines.join('\r\n') + '\r\n';
}

export function toCsvBlob(report) {
  return new Blob(['﻿', toCsv(report)], { type: 'text/csv;charset=utf-8' });
}
