import type { ProcessedRow } from '@/app/types';

interface EmployeeGroup {
  name: string;
  rows: ProcessedRow[];
}

function groupByEmployee(rows: ProcessedRow[]): EmployeeGroup[] {
  const map = new Map<string, ProcessedRow[]>();
  for (const row of rows) {
    const key = row.colaborador;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  const groups: EmployeeGroup[] = [];
  map.forEach((empRows, name) => {
    const sorted = [...empRows].sort((a, b) => a.rawDate.localeCompare(b.rawDate));
    groups.push({ name, rows: sorted });
  });
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

function chunkRows(rows: ProcessedRow[], size: number): ProcessedRow[][] {
  const chunks: ProcessedRow[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function getEntradaCell(row: ProcessedRow): string {
  if (row.licencia) return row.licencia;
  if (!row.isWorkday) return 'Día de Descanso';
  return row.ent1 ?? '';
}

function getSalidaCell(row: ProcessedRow): string {
  if (row.licencia) return '';
  if (!row.isWorkday) return '';
  return row.sal2 ?? row.sal1 ?? '';
}

function getInicioComida(row: ProcessedRow): string {
  if (!row.isWorkday || row.licencia) return '';
  return row.sal1 && row.ent2 ? row.sal1 : '';
}

function getFinComida(row: ProcessedRow): string {
  if (!row.isWorkday || row.licencia) return '';
  return row.ent2 ?? '';
}

export async function generatePDF(
  rows: ProcessedRow[],
  startDate: string,
  endDate: string,
  filename: string,
) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const groups = groupByEmployee(rows);
  const ROWS_PER_SECTION = 7;
  const SECTIONS_PER_PAGE = 2;
  const ROWS_PER_PAGE = ROWS_PER_SECTION * SECTIONS_PER_PAGE;
  const pageW = doc.internal.pageSize.getWidth();
  let firstPage = true;

  for (const group of groups) {
    const pages = chunkRows(group.rows, ROWS_PER_PAGE);

    for (const pageRows of pages) {
      if (!firstPage) doc.addPage();
      firstPage = false;

      const sections = chunkRows(pageRows, ROWS_PER_SECTION);

      // -- Header --
      doc.setFontSize(13);
      doc.setFont('courier', 'bold');
      doc.text('[NOMBRE_CLIENTE]', pageW / 2, 36, { align: 'center' });
      doc.setFontSize(11);
      doc.text('Tarjeta de Tiempo', pageW / 2, 52, { align: 'center' });

      doc.setLineWidth(0.5);
      doc.line(36, 58, pageW - 36, 58);

      // Employee name
      doc.setFontSize(9);
      doc.setFont('courier', 'normal');
      doc.text(`Colaborador: ${group.name}`, 40, 72);
      doc.text(`Período: ${startDate} al ${endDate}`, pageW - 40, 72, { align: 'right' });

      // Declaration
      doc.setFontSize(8);
      const decl = 'Hago constar que la presente Tarjeta de Tiempo  ha  sido marcada personalmente por  mi  en las  horas  de entrada y salidas mostradas, y corresponde al registro de mi asistencia durante el periodo señalado.';
      const lines = doc.splitTextToSize(decl, pageW - 80);
      doc.text(lines, 40, 88);

      let yOffset = 108;

      for (let si = 0; si < sections.length; si++) {
        const sectionRows = sections[si];

        // Calculate totals for this section
        let totalDef = 0;
        let totalLnch = 0;
        let totalReg = 0;
        let totalVac = 0;
        for (const r of sectionRows) {
          totalDef += r.hoursWorked ?? 0;
          if (r.almuerzo) {
            const [hh, mm] = r.almuerzo.split(':').map(Number);
            totalLnch += hh * 60 + mm;
          }
          if (r.licencia) {
            totalVac += 8;
          }
          const reg = Math.min(r.hoursWorked ?? 0, 8);
          totalReg += reg;
        }

        const totalDefHHMM = `${String(Math.floor(totalDef)).padStart(2, '0')}:${String(Math.round((totalDef % 1) * 60)).padStart(2, '0')}`;
        const totalLnchHHMM = `${String(Math.floor(totalLnch / 60)).padStart(2, '0')}:${String(totalLnch % 60).padStart(2, '0')}`;
        const totalRegHHMM = `${String(Math.floor(totalReg)).padStart(2, '0')}:${String(Math.round((totalReg % 1) * 60)).padStart(2, '0')}`;

        const tableData = sectionRows.map(row => {
          const entrada = getEntradaCell(row);
          const salida = getSalidaCell(row);
          const inicioComida = getInicioComida(row);
          const finComida = getFinComida(row);
          const def = row.isWorkday && !row.licencia ? (row.hrsTrab ?? '') : '';
          const lnch = row.almuerzo ?? '';
          const reg = row.isWorkday && !row.licencia && row.hoursWorked
            ? `${String(Math.floor(Math.min(row.hoursWorked, 8))).padStart(2, '0')}:00`
            : (row.licencia ? 'VAC' : '');
          const te1 = row.hoursWorked > 8
            ? `${String(Math.floor(Math.min(row.hoursWorked - 8, 8))).padStart(2, '0')}:00`
            : '';
          const te2 = row.hoursWorked > 16
            ? `${String(Math.floor(row.hoursWorked - 16)).padStart(2, '0')}:00`
            : '';
          const fes = row.feriado ? row.feriado.slice(0, 6) : '';

          return [row.fecha, entrada, inicioComida, finComida, salida, def, lnch, reg, te1, te2, '', '', fes];
        });

        autoTable(doc, {
          startY: yOffset,
          head: [[
            { content: 'Fecha', rowSpan: 2 },
            { content: 'Entrada', rowSpan: 2 },
            { content: 'Inicio\nComida', rowSpan: 2 },
            { content: 'Fin\nComida', rowSpan: 2 },
            { content: 'Salida', rowSpan: 2 },
            { content: 'Totales', colSpan: 2 },
            { content: 'Detalle de Niveles de Tiempo', colSpan: 6 },
          ],
          [
            'DEF', 'LNCH',
            'REG', 'TE1', 'TE2', 'DOM', 'DES', 'FES',
          ]],
          body: tableData,
          foot: [[
            { content: '', colSpan: 5 },
            { content: totalDefHHMM },
            { content: totalLnchHHMM },
            { content: totalRegHHMM },
            { content: '' }, { content: '' }, { content: '' }, { content: '' }, { content: '' },
          ]],
          styles: {
            font: 'courier',
            fontSize: 7.5,
            cellPadding: 2,
            lineWidth: 0.3,
            halign: 'center',
          },
          headStyles: {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            fontSize: 7,
            halign: 'center',
          },
          footStyles: {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            fontSize: 7,
          },
          columnStyles: {
            0: { halign: 'left', cellWidth: 70 },
            1: { cellWidth: 55 },
            2: { cellWidth: 45 },
            3: { cellWidth: 45 },
            4: { cellWidth: 45 },
            5: { cellWidth: 42 },
            6: { cellWidth: 42 },
            7: { cellWidth: 42 },
            8: { cellWidth: 35 },
            9: { cellWidth: 35 },
            10: { cellWidth: 35 },
            11: { cellWidth: 35 },
            12: { cellWidth: 40 },
          },
          margin: { left: 36, right: 36 },
        });

        // Section totals summary lines
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
        doc.setFontSize(7.5);
        doc.setFont('courier', 'normal');
        const summaryX = 36 + 70 + 55 + 45 + 45 + 45;
        doc.text(`+REG   ${totalDefHHMM}   ${totalRegHHMM}`, summaryX, finalY);
        doc.text(`-LNCH  ${totalLnchHHMM}`, summaryX, finalY + 10);
        if (totalVac > 0) {
          doc.text(`+VAC   ${String(Math.floor(totalVac)).padStart(2, '0')}:00   ${String(Math.floor(totalVac)).padStart(2, '0')}:00`, summaryX, finalY + 20);
        }

        yOffset = finalY + (totalVac > 0 ? 32 : 22);

        if (si < sections.length - 1) {
          doc.setLineWidth(0.3);
          doc.line(36, yOffset, pageW - 36, yOffset);
          yOffset += 8;
        }
      }

      // Signature lines
      const sigY = doc.internal.pageSize.getHeight() - 40;
      doc.setFontSize(8);
      doc.setFont('courier', 'normal');
      doc.line(50, sigY, 280, sigY);
      doc.line(pageW / 2 + 20, sigY, pageW - 50, sigY);
      doc.text('Firma del Colaborador', 165, sigY + 12, { align: 'center' });
      doc.text('Firma de Autorización', pageW / 2 + 20 + (pageW - 50 - pageW / 2 - 20) / 2, sigY + 12, { align: 'center' });
    }
  }

  doc.save(filename + '.pdf');
}
