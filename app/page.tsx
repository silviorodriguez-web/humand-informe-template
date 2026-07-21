'use client';

import { useState, useCallback, useMemo } from 'react';
import type { ProcessedRow, HumandUser, DaySummary } from './types';
import { exportCSV, exportXLSX } from './utils/export';

// ─── helpers ────────────────────────────────────────────────────────────────

const DIAS: Record<string, string> = {
  MONDAY: 'Lunes', TUESDAY: 'Martes', WEDNESDAY: 'Miércoles',
  THURSDAY: 'Jueves', FRIDAY: 'Viernes', SATURDAY: 'Sábado', SUNDAY: 'Domingo',
};
const DOW: string[] = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function toMX(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function minsToHHMM(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function processDay(s: DaySummary, userName: string, employeeId: string): ProcessedRow {
  const starts = (s.entries ?? []).filter(e => e.type === 'START').sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const ends = (s.entries ?? []).filter(e => e.type === 'END').sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const s1 = starts[0] ?? null; const e1 = ends[0] ?? null;
  const s2 = starts[1] ?? null; const e2 = ends[1] ?? null;

  const ent1 = s1 ? (s1.source === 'AUTO_CLOSE' ? '00:00' : toMX(s1.time)) : null;
  const sal1 = e1 ? (e1.source === 'AUTO_CLOSE' ? '00:00' : toMX(e1.time)) : null;
  const ent2 = s2 ? (s2.source === 'AUTO_CLOSE' ? '00:00' : toMX(s2.time)) : null;
  const sal2 = e2 ? (e2.source === 'AUTO_CLOSE' ? '00:00' : toMX(e2.time)) : null;

  let almuerzo: string | null = null;
  if (s2 && e1 && s2.source !== 'AUTO_CLOSE' && e1.source !== 'AUTO_CLOSE') {
    almuerzo = minsToHHMM((new Date(s2.time).getTime() - new Date(e1.time).getTime()) / 60000);
  }

  const worked = s.hours?.worked ?? 0;
  const [year, month, day] = s.referenceDate.split('-');
  const licencia = s.timeOffRequests?.length > 0 ? s.timeOffRequests.map((t: { name: string }) => t.name).join(' / ') : null;

  return {
    fecha: `${day}/${month}/${year.slice(2)}`, rawDate: s.referenceDate,
    dia: DIAS[s.weekday] ?? s.weekday, colaborador: userName, employeeId,
    userId: s.userId,
    ent1, sal1, ent2, sal2, almuerzo,
    hrsTrab: worked > 0 ? worked.toFixed(2) : null,
    metEnt1: s1?.source ?? null, metSal1: e1?.source ?? null,
    metEnt2: s2?.source ?? null, metSal2: e2?.source ?? null,
    feriado: s.holidays?.length > 0 ? s.holidays[0].name : null,
    licencia, incidencias: s.incidences ?? [], hoursWorked: worked, isWorkday: s.isWorkday,
  };
}

interface TimeOffReq {
  state: string;
  from: { date: string };
  to: { date: string };
  policyType: { name: string };
  issuer: { employeeInternalId: string; firstName: string; lastName: string };
}

function vacationRows(tor: TimeOffReq, queryStart: string, queryEnd: string, userMap: Map<string, string>): ProcessedRow[] {
  const rows: ProcessedRow[] = [];
  const s = queryStart > tor.from.date ? queryStart : tor.from.date;
  const e = queryEnd < tor.to.date ? queryEnd : tor.to.date;
  let cur = new Date(s + 'T00:00:00Z');
  const end = new Date(e + 'T00:00:00Z');
  const empId = tor.issuer.employeeInternalId;
  const name = userMap.get(empId) ?? `${tor.issuer.firstName} ${tor.issuer.lastName}`;

  while (cur <= end) {
    const dateStr = cur.toISOString().split('T')[0];
    const [year, month, day] = dateStr.split('-');
    const dow = cur.getUTCDay();
    rows.push({
      fecha: `${day}/${month}/${year.slice(2)}`, rawDate: dateStr,
      dia: DOW[dow], colaborador: name, employeeId: empId, userId: 0,
      ent1: null, sal1: null, ent2: null, sal2: null, almuerzo: null, hrsTrab: null,
      metEnt1: null, metSal1: null, metEnt2: null, metSal2: null, feriado: null,
      licencia: tor.policyType.name, incidencias: [], hoursWorked: 0,
      isWorkday: dow >= 1 && dow <= 5,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return rows;
}

// Split a date range into ≤31-day chunks
function splitRange(start: string, end: string) {
  const chunks: { start: string; end: string }[] = [];
  let cur = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (cur <= endD) {
    const ce = new Date(cur); ce.setUTCDate(ce.getUTCDate() + 30);
    if (ce > endD) ce.setTime(endD.getTime());
    chunks.push({ start: cur.toISOString().split('T')[0], end: ce.toISOString().split('T')[0] });
    cur = new Date(ce); cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

// ─── badges ─────────────────────────────────────────────────────────────────

const SRC: Record<string, { label: string; color: string }> = {
  APP: { label: 'APP', color: 'bg-blue-100 text-blue-700' },
  KIOSK: { label: 'KIOSK', color: 'bg-purple-100 text-purple-700' },
  MANUAL: { label: 'MANUAL', color: 'bg-amber-100 text-amber-700' },
  AUTO_CLOSE: { label: 'AUTO', color: 'bg-red-100 text-red-700' },
  INTEGRATION: { label: 'INTEG', color: 'bg-teal-100 text-teal-700' },
};

function Badge({ source }: { source: string | null }) {
  if (!source) return <span className="text-gray-300 text-xs">—</span>;
  const s = SRC[source] ?? { label: source.slice(0, 5), color: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.color}`}>{s.label}</span>;
}

function TC({ val, auto }: { val: string | null; auto?: boolean }) {
  if (!val) return <span className="text-gray-300 text-xs">—</span>;
  return <span className={`font-mono text-sm ${auto ? 'text-red-500' : ''}`}>{val}</span>;
}

// ─── main component ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [startDate, setStartDate] = useState(fmt(firstOfMonth));
  const [endDate, setEndDate] = useState(fmt(today));
  const [rows, setRows] = useState<ProcessedRow[]>([]);
  const [users, setUsers] = useState<HumandUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [filterColab, setFilterColab] = useState('Todos');
  const [loaded, setLoaded] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    setRows([]);
    setLoaded(false);

    try {
      // Step 1: employees (fast, parallel pages)
      setLoadingMsg('Cargando colaboradores…');
      const empRes = await fetch('/api/employees');
      if (!empRes.ok) throw new Error(await empRes.text());
      const { users: allUsers } = await empRes.json();
      setUsers(allUsers);

      const userMap = new Map<string, string>();
      allUsers.forEach((u: HumandUser) => userMap.set(u.employeeInternalId, `${u.firstName} ${u.lastName}`));
      const allIds: string[] = allUsers.map((u: HumandUser) => u.employeeInternalId);

      // Split employees into groups of 25 to keep URLs short and API calls fast
      const GROUP_SIZE = 25;
      const empGroups: string[][] = [];
      for (let i = 0; i < allIds.length; i += GROUP_SIZE) {
        empGroups.push(allIds.slice(i, i + GROUP_SIZE));
      }

      const dateChunks = splitRange(startDate, endDate);
      const totalCalls = empGroups.length * dateChunks.length;
      setLoadingMsg(`Cargando registros (${empGroups.length} grupos · ${dateChunks.length} período${dateChunks.length > 1 ? 's' : ''})…`);

      // Helper: fetch ALL pages for one (empGroup × dateChunk) combination
      // Uses limit=50 — the proven page size the Humand API honours
      const PAGE_LIMIT = 50;
      async function fetchAllSummaryPages(ids: string[], chunk: { start: string; end: string }): Promise<DaySummary[]> {
        const results: DaySummary[] = [];
        let page = 1;
        while (true) {
          const r = await fetch(
            `/api/summaries?startDate=${chunk.start}&endDate=${chunk.end}&employeeIds=${encodeURIComponent(ids.join(','))}&page=${page}&limit=${PAGE_LIMIT}`
          ).then(res => res.ok ? res.json() : { items: [] }).catch(() => ({ items: [] }));
          const items: DaySummary[] = r.items ?? [];
          results.push(...items);
          if (items.length < PAGE_LIMIT) break; // last page
          page++;
        }
        return results;
      }

      // Fire time-off + all group×chunk page-1 calls in parallel
      const allSummaryItems: DaySummary[] = [];
      const coveredKeys = new Set<string>();

      // Fetch all groups × chunks in parallel (up to ~16 calls), plus time-off
      const [timeOffResult, ...groupChunkResults] = await Promise.allSettled([
        fetch(`/api/timeoff?startDate=${startDate}&endDate=${endDate}`).then(r => r.json()).catch(() => ({ requests: [] })),
        ...empGroups.flatMap(group =>
          dateChunks.map(chunk => fetchAllSummaryPages(group, chunk))
        ),
      ]);

      setLoadingMsg(`Procesando ${totalCalls} lotes…`);
      groupChunkResults.forEach(r => {
        if (r.status === 'fulfilled') allSummaryItems.push(...(r.value as DaySummary[]));
      });

      // Build rows from day-summaries
      const finalRows: ProcessedRow[] = [];

      for (const s of allSummaryItems) {
        if (!s.entries?.length && !s.timeOffRequests?.length && !s.holidays?.length && !(s.hours?.worked > 0)) continue;
        const key = `${s.employeeId}|${s.referenceDate}`;
        coveredKeys.add(key);
        const name = userMap.get(s.employeeId) ?? s.employeeId;
        finalRows.push(processDay(s, name, s.employeeId));
      }

      // Overlay time-off requests
      const torList: TimeOffReq[] = timeOffResult.status === 'fulfilled'
        ? (timeOffResult.value as { requests?: TimeOffReq[] }).requests ?? []
        : [];

      for (const tor of torList) {
        if (!['APPROVED', 'PENDING', 'IN_PROGRESS'].includes(tor.state)) continue;
        if (!tor.from?.date || !tor.to?.date) continue;
        if (tor.from.date > endDate || tor.to.date < startDate) continue;

        const vRows = vacationRows(tor, startDate, endDate, userMap);
        for (const vr of vRows) {
          const key = `${vr.employeeId}|${vr.rawDate}`;
          if (!coveredKeys.has(key)) {
            finalRows.push(vr);
            coveredKeys.add(key);
          } else {
            const existing = finalRows.find(r => r.employeeId === vr.employeeId && r.rawDate === vr.rawDate);
            if (existing && !existing.licencia) existing.licencia = vr.licencia;
          }
        }
      }

      // Sort: date DESC, name ASC
      finalRows.sort((a, b) => {
        const d = b.rawDate.localeCompare(a.rawDate);
        return d !== 0 ? d : a.colaborador.localeCompare(b.colaborador);
      });

      setRows(finalRows);
      setLoaded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }, [startDate, endDate]);

  const collaborators = useMemo(() => ['Todos', ...[...new Set(rows.map(r => r.colaborador))].sort()], [rows]);
  const filtered = useMemo(() => filterColab === 'Todos' ? rows : rows.filter(r => r.colaborador === filterColab), [rows, filterColab]);
  const filename = `ControlHorario_NOMBRE_CLIENTE_${startDate}_${endDate}`;

  async function handlePDF() {
    if (!filtered.length) return;
    setPdfLoading(true);
    try {
      const { generatePDF } = await import('./utils/pdf');
      await generatePDF(filtered, startDate, endDate, filename);
    } finally { setPdfLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard Control Horario</h1>
          <p className="text-sm text-gray-500 mt-1">[NOMBRE_CLIENTE]</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
          <div className="flex flex-wrap gap-5 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">fecha_inicio</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">fecha_fin</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={fetchData} disabled={loading}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2">
              {loading
                ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>{loadingMsg || 'Cargando…'}</>
                : 'Consultar'}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>}
        </div>

        {/* Export + Stats */}
        {loaded && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
            <div className="flex flex-wrap gap-6 items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-800 mb-3">📊 Descargar Informe</h2>
                <div className="flex flex-wrap gap-4">
                  <button onClick={() => exportXLSX(filtered, filename)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">↓ Excel (.xlsx)</button>
                  <button onClick={() => exportCSV(filtered, filename)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">↓ CSV</button>
                  <button onClick={handlePDF} disabled={pdfLoading} className="text-sm text-rose-600 hover:text-rose-800 font-medium disabled:opacity-50">
                    {pdfLoading ? '⏳ Generando…' : '↓ Fichas Horarias PDF'}
                  </button>
                </div>
              </div>
              <div className="flex gap-4 text-center">
                {[
                  { v: users.length, l: 'Colaboradores', c: 'text-blue-600', bg: 'bg-blue-50' },
                  { v: filtered.length, l: 'Registros', c: 'text-gray-800', bg: 'bg-gray-50' },
                  { v: filtered.filter(r => r.feriado).length, l: 'Feriados', c: 'text-amber-600', bg: 'bg-amber-50' },
                  { v: filtered.filter(r => r.licencia).length, l: 'Licencias/Vac.', c: 'text-green-600', bg: 'bg-green-50' },
                ].map(({ v, l, c, bg }) => (
                  <div key={l} className={`px-4 py-2 rounded-lg ${bg}`}>
                    <p className={`text-xl font-bold ${c}`}>{v}</p>
                    <p className="text-xs text-gray-500">{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {loaded && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex flex-wrap gap-4 items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Registros Diarios por Colaborador</h2>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">colaborador</label>
                <select value={filterColab} onChange={e => setFilterColab(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[200px]">
                  {collaborators.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Fecha', 'Día', 'Colaborador', 'Ent. 1', 'Sal. 1', 'Ent. 2', 'Sal. 2', 'Almuerzo', 'Hrs. Trab.', 'Mét. Ent. 1', 'Mét. Sal. 1', 'Mét. Ent. 2', 'Mét. Sal. 2', 'Feriado', 'Licencia']
                      .map(h => <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={15} className="text-center py-12 text-gray-400">No hay registros para el período seleccionado.</td></tr>
                  ) : filtered.map((row, i) => {
                    const isVac = !!row.licencia;
                    const isFer = !!row.feriado;
                    let bg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40';
                    if (isVac) bg = 'bg-green-50';
                    else if (isFer) bg = 'bg-amber-50';

                    return (
                      <tr key={`${row.employeeId}|${row.rawDate}`} className={`${bg} border-b border-gray-100 hover:brightness-95`}>
                        <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{row.fecha}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{row.dia}</td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">{row.colaborador}</td>
                        <td className="px-3 py-2.5 text-center"><TC val={row.ent1} auto={row.metEnt1 === 'AUTO_CLOSE'} /></td>
                        <td className="px-3 py-2.5 text-center"><TC val={row.sal1} auto={row.metSal1 === 'AUTO_CLOSE'} /></td>
                        <td className="px-3 py-2.5 text-center"><TC val={row.ent2} auto={row.metEnt2 === 'AUTO_CLOSE'} /></td>
                        <td className="px-3 py-2.5 text-center"><TC val={row.sal2} auto={row.metSal2 === 'AUTO_CLOSE'} /></td>
                        <td className="px-3 py-2.5 text-center font-mono text-sm">{row.almuerzo ?? <span className="text-gray-300 text-xs">—</span>}</td>
                        <td className="px-3 py-2.5 text-center font-mono text-sm font-semibold">
                          {row.hrsTrab ?? (row.licencia ? <span className="text-green-600 text-xs font-semibold">VAC</span> : <span className="text-gray-300 text-xs">—</span>)}
                        </td>
                        <td className="px-3 py-2.5 text-center"><Badge source={row.metEnt1} /></td>
                        <td className="px-3 py-2.5 text-center"><Badge source={row.metSal1} /></td>
                        <td className="px-3 py-2.5 text-center"><Badge source={row.metEnt2} /></td>
                        <td className="px-3 py-2.5 text-center"><Badge source={row.metSal2} /></td>
                        <td className="px-3 py-2.5 text-xs text-amber-700 font-medium whitespace-nowrap">{row.feriado ?? <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-xs text-green-700 font-medium whitespace-nowrap">{row.licencia ?? <span className="text-gray-300">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filtered.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-6 text-xs text-gray-500 flex-wrap">
                <span>{filtered.length} registros · {startDate} → {endDate}</span>
                {filterColab !== 'Todos' && <span>Filtrado: <strong>{filterColab}</strong></span>}
                <span className="flex gap-4 ml-auto">
                  <span><span className="inline-block w-3 h-3 rounded-sm bg-green-100 mr-1 align-middle" />Licencia/Vac.</span>
                  <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 mr-1 align-middle" />Feriado</span>
                </span>
              </div>
            )}
          </div>
        )}

        {!loaded && !loading && (
          <div className="text-center py-24 text-gray-400">
            <div className="text-6xl mb-4">🕐</div>
            <p className="text-lg font-medium text-gray-600">Selecciona un rango de fechas y presiona <strong>Consultar</strong></p>
            <p className="text-sm mt-1 text-gray-400">Los datos se cargan desde Humand automáticamente.</p>
          </div>
        )}
      </div>
    </div>
  );
}
