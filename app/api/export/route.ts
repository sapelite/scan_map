import { NextResponse } from 'next/server';
import { getLeads } from '@/lib/database';

const escapeCsv = (value: unknown): string => {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export async function GET() {
  try {
    const leads = await getLeads();
    const headers = [
      'id', 'name', 'status', 'score', 'riskLevel', 'rating', 'reviews',
      'tech', 'url', 'email', 'phone', 'address', 'mapsUrl', 'date', 'notes'
    ];

    const rows = leads.map((l) => [
      l.id, l.name, l.status ?? 'NEW', l.stats?.score ?? 0, l.stats?.riskLevel ?? '',
      l.rating ?? '', l.reviews ?? '', l.tech ?? '', l.url ?? '', l.email ?? '',
      l.phone ?? '', l.address ?? '', l.mapsUrl ?? '', l.date ?? '',
      (l as { notes?: string }).notes ?? ''
    ].map(escapeCsv).join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="command-center-vault-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'EXPORT_FAILURE' }, { status: 500 });
  }
}
