import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.HUMAND_API_BASE!;
const AUTH = `Basic ${process.env.HUMAND_API_KEY}`;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';

  try {
    // Fetch up to 2 pages of time-off requests (they are usually few)
    const r1 = await fetch(`${BASE}/time-off/requests?limit=50&page=1`, {
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r1.ok) return NextResponse.json({ requests: [] });
    const d1 = await r1.json();
    let all = d1.items ?? [];

    if (all.length === 50) {
      const r2 = await fetch(`${BASE}/time-off/requests?limit=50&page=2`, {
        headers: { Authorization: AUTH, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (r2?.ok) {
        const d2 = await r2.json();
        all = [...all, ...(d2.items ?? [])];
      }
    }

    // Filter to requests overlapping the query date range
    const relevant = startDate && endDate
      ? all.filter((r: { from?: { date: string }; to?: { date: string } }) =>
          r.from?.date && r.to?.date &&
          r.from.date <= endDate && r.to.date >= startDate
        )
      : all;

    return NextResponse.json({ requests: relevant });
  } catch (err) {
    console.error('timeoff route error:', err);
    return NextResponse.json({ requests: [] }); // graceful degradation
  }
}
