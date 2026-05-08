import { NextRequest } from 'next/server';
import { withBrowser, discoverTargets, buildLeadFromTarget } from '@/lib/engine';
import { saveLead } from '@/lib/database';
import { Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';

type StreamEvent = {
  status: 'hunting' | 'auditing' | 'result' | 'error' | 'done';
  msg?: string;
  data?: Lead;
};

export async function POST(req: NextRequest) {
  const { niche, location, tier } = await req.json();

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

        await withBrowser(async (browser) => {
          send({ status: 'hunting', msg: 'Searching Google Maps...' });
          const targets = await discoverTargets(browser, niche, location, scanLimit);

          if (targets.length === 0) {
            send({ status: 'error', msg: 'No targets found.' });
            return;
          }

          // Apply tier-based ordering: lower authority first means juicier leads at the top
          const sorted = [...targets].sort((a, b) => (a.authorityScore || 0) - (b.authorityScore || 0));
          const finalTargets = sorted.slice(0, returnLimit);

          send({ status: 'hunting', msg: `Discovered ${finalTargets.length} businesses. Auditing now...` });

          for (let i = 0; i < finalTargets.length; i++) {
            const target = finalTargets[i];
            send({
              status: 'auditing',
              msg: `Auditing ${i + 1}/${finalTargets.length}: ${target.name}${target.website ? '' : ' (no website on Maps)'}`,
            });
            try {
              const lead = await buildLeadFromTarget(browser, target);
              await saveLead(lead);
              send({ status: 'result', data: lead });
            } catch (err) {
              console.error(`Audit failed for ${target.name}`, err);
            }
          }
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
