import { slugify } from './slug';

export interface VeidsInfo {
  /** Exact value of the "Veids" column. */
  value: string;
  /** Used in URLs: /iestades?veids=<slug> */
  slug: string;
  /** Short name for cards and badges. */
  label: string;
  /** What this type includes, in plain words. */
  examples: string;
}

// Ordered by how likely students are to look for them.
export const VEIDI: VeidsInfo[] = [
  {
    value: 'Vispārējās izglītības iestāde',
    slug: 'vispareja',
    label: 'Vispārējā izglītība',
    examples: 'Pamatskolas, vidusskolas, ģimnāzijas',
  },
  {
    value: 'Augstākās izglītības iestāde',
    slug: 'augstaka',
    label: 'Augstākā izglītība',
    examples: 'Universitātes, augstskolas, koledžas',
  },
  {
    value: 'Profesionālās pamata un vidējās izglītības iestāde',
    slug: 'profesionala',
    label: 'Profesionālā izglītība',
    examples: 'Tehnikumi, profesionālās vidusskolas',
  },
  {
    value: 'Profesionālās ievirzes izglītības iestāde',
    slug: 'ievirze',
    label: 'Profesionālā ievirze',
    examples: 'Sporta, mūzikas, mākslas un deju skolas',
  },
  {
    value: 'Speciālās izglītības iestāde',
    slug: 'speciala',
    label: 'Speciālā izglītība',
    examples: 'Speciālās skolas, attīstības centri',
  },
  {
    value: 'Bērnu un jauniešu interešu izglītības iestāde',
    slug: 'interesu',
    label: 'Interešu izglītība',
    examples: 'Bērnu un jauniešu centri',
  },
  {
    value: 'Profesionālās tālākizglītības un pilnveides izglītības iestāde',
    slug: 'talakizglitiba',
    label: 'Tālākizglītība',
    examples: 'Profesionālās tālākizglītības centri',
  },
  {
    value: 'Pieaugušo neformālās izglītības iestāde',
    slug: 'pieauguso',
    label: 'Pieaugušo izglītība',
    examples: 'Neformālās izglītības iestādes',
  },
];

const byValue = new Map(VEIDI.map((v) => [v.value, v]));
const bySlug = new Map(VEIDI.map((v) => [v.slug, v]));

/** Info for a Veids value; unknown values (from a future export) get a generated slug. */
export function veidsInfo(value: string): VeidsInfo {
  return byValue.get(value) ?? { value, slug: slugify(value), label: value, examples: '' };
}

/** Position in the curated VEIDI order; unknown types sort last. */
export function veidsOrder(info: VeidsInfo): number {
  const i = VEIDI.findIndex((v) => v.slug === info.slug);
  return i === -1 ? VEIDI.length : i;
}

export function veidsFromSlug(slug: string | null): VeidsInfo | null {
  return (slug && bySlug.get(slug)) || null;
}
