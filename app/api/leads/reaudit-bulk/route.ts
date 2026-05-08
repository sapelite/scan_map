import { NextRequest } from 'next/server';
import { reauditMany } from '@/lib/engine';
import { getLeads, replaceLead } from '@/lib/database';
import { Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Streams re-audit progress for either:
 *   - a specific list of lead ids (body.ids)
 *   - or all "stale" leads (no audit, websiteStatus='none', or 'unreachable')
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const leads = await getLeads();

  const targetIds: Set<string> | null =
    Array.isArray(body.ids) && body.ids.length > 0
      ? new Set(body.ids.map((id: unknown) => String(id)))
      : null;

  const candidates: Lead[] = leads.filter((l) => {
    if (targetIds) return targetIds.has(String(l.id));
    // "stale" = anything not freshly audited
    if (!l.audit) return true;
    if (!l.websiteStatus) return true;
    if (l.websiteStatus !== 'audited') return true;
    return false;
  });

  if (candidates.length === 0) {
    return new Response(JSON.stringify({ error: 'No stale leads to re-audit' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* closed */ }
      };
      try {
        for await (const event of reauditMany(candidates)) {
          if (event.type === 'lead' && event.lead) {
            await replaceLead(event.lead);
            send({ type: 'lead', index: event.index, total: event.total, lead: event.lead });
          } else if (event.type === 'progress') {
            send({ type: 'progress', index: event.index, total: event.total, msg: event.msg });
          } else if (event.type === 'error') {
            send({ type: 'error', index: event.index, total: event.total, msg: event.msg });
          }
        }
        send({ type: 'done' });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        send({ type: 'error', msg: err instanceof Error ? err.message : 'bulk re-audit failed' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
