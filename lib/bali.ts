// lib/bali.ts
// Curated library for sweeping Bali business-by-business.

/** Key Bali areas where tourist-facing businesses cluster. */
export const BALI_AREAS = [
  "Canggu", "Berawa", "Pererenan", "Seminyak", "Kerobokan", "Legian", "Kuta",
  "Ubud", "Uluwatu", "Pecatu", "Jimbaran", "Nusa Dua", "Sanur", "Denpasar",
  "Tabanan", "Gianyar", "Nusa Penida", "Nusa Lembongan", "Amed", "Lovina",
] as const;

/** Default subset selected on first load (the high-density tourist zones). */
export const BALI_DEFAULT_AREAS = ["Canggu", "Seminyak", "Ubud", "Uluwatu", "Sanur"];

/** Curated niche bundles, grouped by what they tend to need from you. */
export interface SweepPreset {
  id: string;
  label: string;
  blurb: string;
  niches: string[];
}

export const SWEEP_PRESETS: SweepPreset[] = [
  {
    id: "hospitality",
    label: "Hospitality",
    blurb: "Villas, hotels, guesthouses. High spend, and they live or die by their online presence.",
    niches: ["villa rental", "boutique hotel", "hotel", "guesthouse", "hostel", "homestay"],
  },
  {
    id: "food",
    label: "Food & drink",
    blurb: "Cafés, restaurants, beach clubs, bars. Instagram-driven, and they always need content.",
    niches: ["restaurant", "cafe", "coffee shop", "beach club", "bar", "warung", "vegan restaurant"],
  },
  {
    id: "wellness",
    label: "Wellness",
    blurb: "Spas, yoga, retreats, gyms. Booking, content, and reputation plays.",
    niches: ["spa", "yoga studio", "massage", "wellness retreat", "gym", "pilates studio"],
  },
  {
    id: "activities",
    label: "Activities & tours",
    blurb: "Surf schools, dive shops, rentals, tours. Booking funnels are usually missing.",
    niches: ["surf school", "dive shop", "scooter rental", "car rental", "tour operator", "cooking class"],
  },
  {
    id: "services",
    label: "Local services",
    blurb: "Real estate, weddings, photographers, salons, clinics. Broad and high-ticket.",
    niches: ["real estate agency", "wedding planner", "photographer", "hair salon", "barber", "dentist", "clinic", "veterinarian"],
  },
  {
    id: "retail",
    label: "Retail & shops",
    blurb: "Boutiques, jewelry, surf shops, galleries. E-commerce and presence upsells.",
    niches: ["boutique", "jewelry store", "surf shop", "art gallery", "furniture store"],
  },
];

/** Flat list of every niche across presets (deduped) for the custom picker. */
export const ALL_BALI_NICHES = [...new Set(SWEEP_PRESETS.flatMap((p) => p.niches))].sort();
