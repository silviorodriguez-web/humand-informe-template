import type { ProcessedRow } from '@/app/types';

const HEADERS = [
  'Fecha', 'Día', 'Colaborador',
  'Ent. 1', 'Sal. 1', 'Ent. 2', 'Sal. 2',
  'Almuerzo', 'Hrs. Trab.',
  'Mét. Ent. 1', 'Mét. Sal. 1', 'Mét. Ent. 2', 'Mét. Sal. 2',
  'Feriado', 'Licencia', 'Incidencia',
];

function rowToArray(r: ProcessedRow): string[] {
  return [
    r.fecha, r.dia, r.colaborador,
    r.ent1 ?? '', r.sal1 ?? '', r.ent2 ?? '', r.sal2 ?? '',
    r.almuerzo ?? '', r.hrsTrab ?? '',
    r.metEnt1 ?? '', r.metSal1 ?? '', r.metEnt2 ?? '', r.metSal2 ?? '',
    r.feriado ?? '', r.licencia ?? '', r.incidencias.join(', '),
  ];
}

export function exportCSV(rows: ProcessedRow[], filename: string) {
  const lines = [HEADERS.join(','), ...rows.map(r => rowToArray(r).map(v => `"${v}"`).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename + '.csv');
}

export async function exportXLSX(rows: ProcessedRow[], filename: string) {
  const { utils, writeFile } = await import('xlsx');
  const ws = utils.aoa_to_sheet([HEADERS, ...rows.map(rowToArray)]);
  ws['!cols'] = HEADERS.map((h, i) => ({ wch: i < 3 ? 20 : 12 }));
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Control Horario');
  writeFile(wb, filename + '.xlsx');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
