import { NextResponse } from 'next/server';

const BASE = process.env.HUMAND_API_BASE!;
const AUTH = `Basic ${process.env.HUMAND_API_KEY}`;

export async function GET() {
  try {
    // Fetch pages 1 and 2 in parallel (max 50 per page, 98 total)
    const [r1, r2] = await Promise.all([
      fetch(`${BASE}/users?limit=50&page=1`, { headers: { Authorization: AUTH, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }),
      fetch(`${BASE}/users?limit=50&page=2`, { headers: { Authorization: AUTH, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }),
    ]);
    if (!r1.ok) throw new Error(`users p1: ${r1.status}`);
    const d1 = await r1.json();
    const users1 = d1.users ?? [];
    let users2: unknown[] = [];
    if (r2.ok) {
      const d2 = await r2.json();
      users2 = d2.users ?? [];
    }
    const all = [...users1, ...users2].filter((u: unknown) => !(u as { deleted?: boolean }).deleted);
    return NextResponse.json({ users: all });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
