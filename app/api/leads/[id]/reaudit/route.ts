import { NextRequest, NextResponse } from 'next/server';
import { reauditLead } from '@/lib/engine';
import { getLeads, replaceLead } from '@/lib/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const leads = await getLeads();
    const existing = leads.find(l => l.id.toString().trim() === id.toString().trim());
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    if (!existing.mapsUrl) {
      return NextResponse.json({ error: 'No Maps URL on this lead — cannot re-audit' }, { status: 400 });
    }

    const refreshed = await reauditLead(existing);
    await replaceLead(refreshed);
    return NextResponse.json({ success: true, lead: refreshed });
  } catch (err) {
    console.error('Re-audit error:', err);
    return NextResponse.json({ error: 'REAUDIT_FAILURE' }, { status: 500 });
  }
}
