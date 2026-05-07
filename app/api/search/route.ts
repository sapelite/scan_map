import { NextRequest } from 'next/server';
import { findLeads, processLead } from '@/lib/engine';
import { saveLead } from '@/lib/database';
import { Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Define the shape of the raw data coming from the findLeads function
interface RawLead {
  name: string;
  rating: number;
  reviews: string;
  website: string | null;
  address: string;
  phone: string;
  mapsUrl: string;
  authorityScore: number;
  competitor?: {
    name: string;
  };
}

// Define the streaming event types
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

  if (tier === 'PRO') {
    scanLimit = 40;
    returnLimit = 15;
  } else if (tier === 'PREMIUM') {
    scanLimit = 150;
    returnLimit = 150;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // If the stream is closed, we log it and stop
          console.error("Stream closed before data could be sent");
        }
      };

      try {
        send({ status: 'hunting', msg: `Initializing Scan (Depth: ${scanLimit})...` });

        // Get raw data from engine
        const allTargetsRaw = await findLeads(niche, location, scanLimit);
        const allTargets = allTargetsRaw as RawLead[];

        if (!allTargets || allTargets.length === 0) {
          send({ status: 'error', msg: 'No targets found.' });
          return; 
        }

        // Filtering Logic
        let finalTargets: RawLead[] = [];
        if (tier === 'PREMIUM') {
          const alphaName = allTargets[0]?.competitor?.name;
          finalTargets = allTargets.filter((t: RawLead) => t.name !== alphaName);
        } else {
          finalTargets = allTargets
            .filter((t: RawLead) => t.name !== t.competitor?.name)
            .sort((a: RawLead, b: RawLead) => (a.authorityScore || 0) - (b.authorityScore || 0))
            .slice(0, returnLimit);
        }

        // Auditing Logic
        for (let i = 0; i < finalTargets.length; i++) {
          const target = finalTargets[i];
          send({ 
            status: 'auditing', 
            msg: `Auditing ${i + 1}/${finalTargets.length}: ${target.name}` 
          });

          try {
            const auditResult: Lead = await processLead(target);
            await saveLead(auditResult);
            send({ status: 'result', data: auditResult });
          } catch (err) {
            console.error(`Audit failed for ${target.name}`, err);
          }
        }
      } catch (error) {
        console.error("Critical stream error:", error);
        send({ status: 'error', msg: 'System Failure.' });
      } finally {
        try {
          send({ status: 'done' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          // Controller already closed, safe to ignore
        }
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