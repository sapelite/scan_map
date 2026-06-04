import { NextRequest } from 'next/server';
import { withBrowser, discoverTargets, buildLeadFromTarget, runPool, LEAD_CONCURRENCY } from '@/lib/engine';
import { getLeads, saveLead } from '@/lib/database';
import { Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';

type StreamEvent = {
  status: 'hunting' | 'auditing' | 'result' | 'error' | 'done';
  msg?: string;
  data?: Lead;
};

export async function POST(req: NextRequest) {
  const { niche, location, tier, websiteFilter: rawFilter } = await req.json();
  const websiteFilter: 'none_only' | 'with_only' | 'any' =
    rawFilter === 'with_only' || rawFilter === 'any' ? rawFilter : 'none_only';

  if (!niche || !location) {
    return new Response(JSON.stringify({ error: 'Params required' }), { status: 400 });
  }

  let scanLimit = 10;
  let returnLimit = 3;
  if (tier === 'PRO') { scanLimit = 40; returnLimit = 15; }
  else if (tier === 'PREMIUM') { scanLimit = 150; returnLimit = 150; }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          console.error('Stream closed before data could be sent');
        }
      };

      try {
        send({ status: 'hunting', msg: `Initializing scan (depth: ${scanLimit})...` });

        // Load the library once so we can skip businesses we already have —
        // no point spending an audit on a lead that's already saved.
        const existing = await getLeads();
        const seenMaps = new Set(existing.map((l) => l.mapsUrl).filter(Boolean));
        const seenNames = new Set(existing.map((l) => l.name.toLowerCase().trim()));

        await withBrowser(async (browser) => {
          send({ status: 'hunting', msg: 'Searching Google Maps...' });
          const targets = await discoverTargets(
            browser, niche, location, scanLimit,
            (done, total, name) =>
              send({ status: 'hunting', msg: `Discovering ${done}/${total}: ${name}` }),
            (link) => seenMaps.has(link),
          );

          // Also drop any whose name already exists in the library (catches the
          // same business found via a slightly different Maps link).
          const fresh = targets.filter((t) => !seenNames.has(t.name.toLowerCase().trim()));
          const skipped = targets.length - fresh.length;

          if (fresh.length === 0) {
            send({
              status: 'error',
              msg: existing.length > 0
                ? 'No new businesses. Everything found is already in your library.'
                : 'No targets found.',
            });
            return;
          }
          if (skipped > 0) {
            send({ status: 'hunting', msg: `Skipped ${skipped} already in your library.` });
          }

          // Lower authority first means juicier leads at the top.
          const byAuthority = (a: typeof fresh[number], b: typeof fresh[number]) => (a.authorityScore || 0) - (b.authorityScore || 0);
          const noWeb = fresh.filter((t) => !t.website).sort(byAuthority);
          const withWeb = fresh.filter((t) => t.website).sort(byAuthority);

          // Website focus chosen up front, so we only audit what's actually wanted.
          let finalTargets;
          if (websiteFilter === 'none_only') finalTargets = noWeb.slice(0, returnLimit);
          else if (websiteFilter === 'with_only') finalTargets = withWeb.slice(0, returnLimit);
          else finalTargets = [...fresh].sort(byAuthority).slice(0, returnLimit);

          if (finalTargets.length === 0) {
            const what = websiteFilter === 'none_only' ? 'with no website' : websiteFilter === 'with_only' ? 'with a website' : '';
            send({ status: 'error', msg: `No new businesses ${what} found here. Try a different niche or area.` });
            return;
          }
          const kindLabel = websiteFilter === 'none_only' ? 'no-website ' : websiteFilter === 'with_only' ? 'with-website ' : '';
          send({ status: 'hunting', msg: `Auditing ${finalTargets.length} ${kindLabel}lead(s).` });

          send({ status: 'hunting', msg: `Discovered ${finalTargets.length} businesses. Auditing now...` });

          // Audit several at once (much faster than one-by-one) but stop on Stop.
          let done = 0;
          await runPool(finalTargets, LEAD_CONCURRENCY, async (target) => {
            send({
              status: 'auditing',
              msg: `Auditing ${++done}/${finalTargets.length}: ${target.name}${target.website ? '' : ' (no website on Maps)'}`,
            });
            try {
              const lead = await buildLeadFromTarget(browser, target);
              await saveLead(lead);
              send({ status: 'result', data: lead });
            } catch (err) {
              console.error(`Audit failed for ${target.name}`, err);
            }
          }, () => req.signal.aborted);
        });
      } catch (error) {
        console.error('Critical stream error:', error);
        send({ status: 'error', msg: 'System failure.' });
      } finally {
        try {
          send({ status: 'done' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch { /* already closed */ }
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
