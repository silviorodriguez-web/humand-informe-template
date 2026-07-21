export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { DaySummary, HumandUser, ProcessedRow } from '@/app/types';

const BASE = process.env.HUMAND_API_BASE!;
const AUTH = `Basic ${process.env.HUMAND_API_KEY}`;

const DIAS: Record<string, string> = {
  MONDAY: 'Lunes', TUESDAY: 'Martes', WEDNESDAY: 'Miércoles',
  THURSDAY: 'Jueves', FRIDAY: 'Viernes', SATURDAY: 'Sábado', SUNDAY: 'Domingo',
};

const DOW_NAMES: string[] = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function toMX(isoTime: string): string {
  const d = new Date(isoTime);
  return d.toLocaleTimeString('es-MX', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function minsToHHMM(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Split date range into ≤31-day chunks (API hard limit)
function splitDateRange(start: string, end: string): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let cur = new Date(start + 'T00:00:00Z');
  const endD = new Date(end + 'T00:00:00Z');
  while (cur <= endD) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 30);
    if (chunkEnd > endD) chunkEnd.setTime(endD.getTime());
    chunks.push({ start: cur.toISOString().split('T')[0], end: chunkEnd.toISOString().split('T')[0] });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

async function hFetch(path: string, timeoutMs = 25000) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// Fetch ALL pages of a paginated endpoint
async function fetchAllPages<T>(
  buildPath: (page: number) => string,
  getItems: (body: Record<string, unknown>) => T[],
  limit = 50,
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  while (true) {
    const body = await hFetch(buildPath(page));
    const items = getItems(body);
    results.push(...items);
    if (items.length < limit) break;
    page++;
  }
  return results;
}

// Fetch day-summaries for all employees across a date chunk (paginates internally)
async function fetchDaySummariesChunk(
  allIds: string[],
  start: string,
  end: string,
): Promise<DaySummary[]> {
  const ids = encodeURIComponent(allIds.join(','));
  return fetchAllPages<DaySummary>(
    page => `/time-tracking/day-summaries?employeeIds=${ids}&startDate=${start}&endDate=${end}&limit=50&page=${page}`,
    b => (b.items as DaySummary[]) ?? [],
  );
}

interface TimeOffRequest {
  id: number;
  state: string;
  from: { date: string };
  to: { date: string };
  policyType: { name: string; activityType: string };
  issuer: { employeeInternalId: string; firstName: string; lastName: string };
}

function processDay(summary: DaySummary, userName: string): ProcessedRow {
  const starts = summary.entries
    .filter(e => e.type === 'START')
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const ends = summary.entries
    .filter(e => e.type === 'END')
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const s1 = starts[0] ?? null;
  const e1 = ends[0] ?? null;
  const s2 = starts[1] ?? null;
  const e2 = ends[1] ?? null;

  const ent1 = s1 ? (s1.source === 'AUTO_CLOSE' ? '00:00' : toMX(s1.time)) : null;
  const sal1 = e1 ? (e1.source === 'AUTO_CLOSE' ? '00:00' : toMX(e1.time)) : null;
  const ent2 = s2 ? (s2.source === 'AUTO_CLOSE' ? '00:00' : toMX(s2.time)) : null;
  const sal2 = e2 ? (e2.source === 'AUTO_CLOSE' ? '00:00' : toMX(e2.time)) : null;

  let almuerzo: string | null = null;
  if (s2 && e1 && s2.source !== 'AUTO_CLOSE' && e1.source !== 'AUTO_CLOSE') {
    const diffMins = (new Date(s2.time).getTime() - new Date(e1.time).getTime()) / 60000;
    almuerzo = minsToHHMM(diffMins);
  }

  const worked = summary.hours?.worked ?? 0;
  const hrsTrab = worked > 0 ? worked.toFixed(2) : null;

  const [year, month, day] = summary.referenceDate.split('-');
  const feriado = summary.holidays?.length > 0 ? summary.holidays[0].name : null;
  const licencia = summary.timeOffRequests?.length > 0
    ? summary.timeOffRequests.map((t: { name: string }) => t.name).join(' / ')
    : null;

  return {
    fecha: `${day}/${month}/${year.slice(2)}`,
    rawDate: summary.referenceDate,
    dia: DIAS[summary.weekday] ?? summary.weekday,
    colaborador: userName,
    employeeId: summary.employeeId,
    userId: summary.userId,
    ent1, sal1, ent2, sal2, almuerzo, hrsTrab,
    metEnt1: s1?.source ?? null,
    metSal1: e1?.source ?? null,
    metEnt2: s2?.source ?? null,
    metSal2: e2?.source ?? null,
    feriado, licencia,
    incidencias: summary.incidences ?? [],
    hoursWorked: worked,
    isWorkday: summary.isWorkday,
  };
}

// Build synthetic day rows from a time-off request date range
function buildVacationRows(
  req: TimeOffRequest,
  queryStart: string,
  queryEnd: string,
  userName: string,
): ProcessedRow[] {
  const rows: ProcessedRow[] = [];
  const rangeStart = queryStart > req.from.date ? queryStart : req.from.date;
  const rangeEnd = queryEnd < req.to.date ? queryEnd : req.to.date;

  let cur = new Date(rangeStart + 'T00:00:00Z');
  const endD = new Date(rangeEnd + 'T00:00:00Z');

  while (cur <= endD) {
    const dateStr = cur.toISOString().split('T')[0];
    const [year, month, day] = dateStr.split('-');
    const dow = cur.getUTCDay(); // 0=Sun, 6=Sat

    rows.push({
      fecha: `${day}/${month}/${year.slice(2)}`,
      rawDate: dateStr,
      dia: DOW_NAMES[dow],
      colaborador: userName,
      employeeId: req.issuer.employeeInternalId,
      userId: 0,
      ent1: null, sal1: null, ent2: null, sal2: null,
      almuerzo: null, hrsTrab: null,
      metEnt1: null, metSal1: null, metEnt2: null, metSal2: null,
      feriado: null,
      licencia: req.policyType.name,
      incidencias: [],
      hoursWorked: 0,
      isWorkday: dow >= 1 && dow <= 5,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
  }

  try {
    // 1. Fetch all active employees (paginated, max 50 per page)
    const users = await fetchAllPages<HumandUser>(
      page => `/users?limit=50&page=${page}`,
      b => (b.users as HumandUser[]) ?? [],
    ).then(all => all.filter(u => !u.deleted));

    const userMap = new Map<string, string>();
    const userByEmpId = new Map<string, HumandUser>();
    users.forEach(u => {
      userMap.set(u.employeeInternalId, `${u.firstName} ${u.lastName}`);
      userByEmpId.set(u.employeeInternalId, u);
    });

    const allIds = users.map(u => u.employeeInternalId);

    // 2. Fetch time-off requests (all pages) — parallel with day-summaries
    const dateChunks = splitDateRange(startDate, endDate);

    const [timeOffRequests, ...chunkSummaries] = await Promise.all([
      // All time-off requests (approved + pending)
      fetchAllPages<TimeOffRequest>(
        page => `/time-off/requests?limit=50&page=${page}`,
        b => (b.items as TimeOffRequest[]) ?? [],
      ).catch(err => { console.error('time-off/requests error:', err); return []; }),

      // Day summaries for each 31-day chunk (run in parallel)
      ...dateChunks.map(chunk => fetchDaySummariesChunk(allIds, chunk.start, chunk.end)),
    ]);

    const allSummaries: DaySummary[] = chunkSummaries.flat();

    // 3. Build a set of days already covered by day-summaries (employeeId|date)
    const coveredKeys = new Set<string>();
    const rows: ProcessedRow[] = [];

    for (const s of allSummaries) {
      const hasEntries = s.entries?.length > 0;
      const hasTimeOff = s.timeOffRequests?.length > 0;
      const hasHoliday = s.holidays?.length > 0;
      const hasWorked = (s.hours?.worked ?? 0) > 0;

      const key = `${s.employeeId}|${s.referenceDate}`;
      coveredKeys.add(key);

      if (hasEntries || hasTimeOff || hasHoliday || hasWorked) {
        const name = userMap.get(s.employeeId) ?? s.employeeId;
        rows.push(processDay(s, name));
      }
    }

    // 4. Overlay time-off requests for days NOT already covered by day-summaries
    const relevantTOReqs = timeOffRequests.filter(r =>
      ['APPROVED', 'PENDING', 'IN_PROGRESS'].includes(r.state) &&
      r.from?.date && r.to?.date &&
      r.from.date <= endDate && r.to.date >= startDate,
    );

    for (const tor of relevantTOReqs) {
      const empId = tor.issuer?.employeeInternalId;
      if (!empId) continue;
      const userName = userMap.get(empId) ?? `${tor.issuer.firstName} ${tor.issuer.lastName}`;

      const vacRows = buildVacationRows(tor, startDate, endDate, userName);
      for (const vRow of vacRows) {
        const key = `${vRow.employeeId}|${vRow.rawDate}`;
        if (!coveredKeys.has(key)) {
          rows.push(vRow);
          coveredKeys.add(key); // prevent duplicates from multiple requests
        } else {
          // If day exists but has no licencia, add the licencia info
          const existing = rows.find(r => r.employeeId === vRow.employeeId && r.rawDate === vRow.rawDate);
          if (existing && !existing.licencia) {
            existing.licencia = vRow.licencia;
          }
        }
      }
    }

    // 5. Sort: date DESC, then name ASC
    rows.sort((a, b) => {
      const d = b.rawDate.localeCompare(a.rawDate);
      return d !== 0 ? d : a.colaborador.localeCompare(b.colaborador);
    });

    return NextResponse.json({ rows, users });
  } catch (err) {
    console.error('time-tracking route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
