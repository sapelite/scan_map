import { NextRequest, NextResponse } from 'next/server';
import { getLeads } from '@/lib/database';
import { Lead } from '@/lib/types';

const escapeCsv = (value: unknown): string => {
  let str = value === null || value === undefined ? '' : String(value);
  // Guard against spreadsheet formula injection: a cell starting with = + - @ (or
  // tab/CR) can run as a formula in Excel/Sheets. Lead names and notes are
  // user-influenced, so neutralise it with a leading apostrophe.
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const rowFor = (l: Lead) => {
  const a = l.audit;
  const s = a?.socials;
  const d = l.stats?.dimensions;
  return [
    l.id,
    l.name,
    l.category ?? '',
    l.status ?? 'NEW',
    l.stats?.score ?? 0,
    l.stats?.riskLevel ?? '',
    d?.site ?? '', d?.social ?? '', d?.marketing ?? '', d?.reputation ?? '', d?.content ?? '',
    (l.opportunities ?? []).join(';'),
    l.websiteStatus ?? 'none',
    l.url ?? '',
    l.websiteFromMaps ?? '',
    l.websiteFailReason ?? '',
    l.email ?? '',
    (a?.emails ?? []).slice(1).join(';'),
    l.phone ?? '',
    (a?.phones ?? []).join(';'),
    l.whatsapp ?? '',
    s?.instagram ?? '',
    s?.facebook ?? '',
    s?.linkedin ?? '',
    s?.twitter ?? '',
    s?.tiktok ?? '',
    s?.youtube ?? '',
    l.tech ?? '',
    (a?.tech ?? []).join(';'),
    l.rating ?? '',
    l.reviewCount ?? '',
    l.reviews ?? '',
    l.address ?? '',
    l.mapsUrl ?? '',
    a?.httpStatus ?? '',
    a?.httpsActive ? 'yes' : 'no',
    a?.mobileViewport ? 'yes' : 'no',
    a?.jsonLd ? 'yes' : 'no',
    a?.hasGoogleAnalytics ? 'yes' : 'no',
    a?.hasGoogleTagManager ? 'yes' : 'no',
    a?.hasFacebookPixel ? 'yes' : 'no',
    a?.title ?? '',
    a?.metaDescription ?? '',
    a?.h1Count ?? '',
    a?.wordCount ?? '',
    a?.imageCount ?? '',
    a?.imagesWithAlt ?? '',
    a?.loadTimeMs ?? '',
    a?.hasRobotsTxt ? 'yes' : 'no',
    a?.hasSitemap ? 'yes' : 'no',
    l.date ?? '',
    l.lastAuditedAt ?? '',
    (l.notes ?? '').replace(/\n/g, ' '),
  ].map(escapeCsv).join(',');
};

const HEADERS = [
  'id', 'name', 'category', 'status', 'score', 'risk',
  'site_score', 'social_score', 'marketing_score', 'reputation_score', 'content_score',
  'opportunities',
  'website_status', 'final_url', 'maps_listed_url', 'website_fail_reason',
  'email_primary', 'emails_other', 'phone_maps', 'phones_on_site', 'whatsapp',
  'instagram', 'facebook', 'linkedin', 'twitter', 'tiktok', 'youtube',
  'tech_primary', 'tech_all', 'rating', 'review_count', 'reviews', 'address', 'maps_url',
  'http_status', 'https', 'mobile_viewport', 'schema_jsonld',
  'analytics_ga', 'analytics_gtm', 'meta_pixel',
  'page_title', 'meta_description',
  'h1_count', 'word_count', 'image_count', 'images_with_alt',
  'load_time_ms', 'robots_txt', 'sitemap_xml',
  'first_seen', 'last_audited', 'notes',
];

function buildCsv(leads: Lead[]): string {
  return ['﻿' + HEADERS.join(','), ...leads.map(rowFor)].join('\r\n');
}

function csvResponse(csv: string): NextResponse {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customy-leads-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

// GET exports the whole library (handy as a direct link).
export async function GET() {
  try {
    return csvResponse(buildCsv(await getLeads()));
  } catch {
    return NextResponse.json({ error: 'EXPORT_FAILURE' }, { status: 500 });
  }
}

// POST exports a subset by id (the current selection or filtered view).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body?.ids;
    const all = await getLeads();
    const leads = Array.isArray(ids) && ids.length
      ? all.filter((l) => ids.map(String).includes(String(l.id)))
      : all;
    return csvResponse(buildCsv(leads));
  } catch {
    return NextResponse.json({ error: 'EXPORT_FAILURE' }, { status: 500 });
  }
}
