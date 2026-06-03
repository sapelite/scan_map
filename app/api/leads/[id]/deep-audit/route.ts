import { NextRequest, NextResponse } from 'next/server';
import { reauditLead } from '@/lib/engine';
import { getLeads, replaceLead } from '@/lib/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Deep audit: re-pull the Maps listing, then crawl several internal pages of the
// website (about / contact / services / booking / blog) for richer findings.
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
      return NextResponse.json({ error: 'No Maps URL on this lead. Cannot audit.' }, { status: 400 });
    }

    const refreshed = await reauditLead(existing, { deep: true });
    await replaceLead(refreshed);
    return NextResponse.json({ success: true, lead: refreshed });
  } catch (err) {
    console.error('Deep-audit error:', err);
    return NextResponse.json({ error: 'DEEP_AUDIT_FAILURE' }, { status: 500 });
  }
}
