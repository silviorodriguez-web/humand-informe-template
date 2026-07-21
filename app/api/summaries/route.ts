import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.HUMAND_API_BASE!;
const AUTH = `Basic ${process.env.HUMAND_API_KEY}`;

// Thin proxy: returns ONE page of day-summaries for a given employee group
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';
  const employeeIds = searchParams.get('employeeIds') ?? '';
  const page = searchParams.get('page') ?? '1';
  const limit = searchParams.get('limit') ?? '50';

  if (!startDate || !endDate || !employeeIds) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  try {
    const url = `${BASE}/time-tracking/day-summaries?employeeIds=${encodeURIComponent(employeeIds)}&startDate=${startDate}&endDate=${endDate}&limit=${limit}&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return NextResponse.json({ error: `${res.status}: ${t}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
