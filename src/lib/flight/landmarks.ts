/**
 * Named places the kabootar can report from.
 *
 * Bundled rather than geocoded at runtime: an external geocoding call would
 * leak the route (and therefore both nests' locations) to a third party, which
 * defeats the point of encrypting the coordinates in the first place.
 *
 * `reach` is how far away (km) a feature can still claim the pigeon. Cities
 * claim a small area; oceans claim a large one.
 */

import { distanceKm, type LatLon } from './geo';

export type LandmarkKind =
  | 'city'
  | 'sea'
  | 'range'
  | 'desert'
  | 'ice'
  | 'island'
  | 'steppe'
  | 'forest';

export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  kind: LandmarkKind;
  /** Optional override for how far this feature reaches, in km. */
  reach?: number;
  /** Set for proper nouns that already read correctly without "the". */
  noArticle?: boolean;
}

const DEFAULT_REACH: Record<LandmarkKind, number> = {
  city: 320,
  sea: 1100,
  range: 650,
  desert: 800,
  ice: 1000,
  island: 450,
  steppe: 900,
  forest: 800,
};

/**
 * "over the Barents Sea", "near Tromso", "over Svalbard".
 *
 * Cities and islands take a bare name; geographic features take an article,
 * unless the name is already a proper noun that reads wrong with one.
 */
export function placePhrase(l: Landmark): string {
  if (l.kind === 'city') return `near ${l.name}`;
  if (l.kind === 'island' || l.noArticle) return `over ${l.name}`;
  return `over the ${l.name}`;
}

export const LANDMARKS: Landmark[] = [
  // --- North America -------------------------------------------------------
  { name: 'Toronto', lat: 43.6532, lon: -79.3832, kind: 'city' },
  { name: 'Ottawa', lat: 45.4215, lon: -75.6972, kind: 'city' },
  { name: 'Montreal', lat: 45.5019, lon: -73.5674, kind: 'city' },
  { name: 'Quebec City', lat: 46.8139, lon: -71.208, kind: 'city' },
  { name: 'Vancouver', lat: 49.2827, lon: -123.1207, kind: 'city' },
  { name: 'New York', lat: 40.7128, lon: -74.006, kind: 'city' },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298, kind: 'city' },
  { name: 'Mexico City', lat: 19.4326, lon: -99.1332, kind: 'city' },
  { name: 'Sept-Iles', lat: 50.2, lon: -66.38, kind: 'city' },
  { name: 'Labrador Sea', lat: 57.0, lon: -55.0, kind: 'sea' },
  { name: 'Gulf of St. Lawrence', lat: 48.0, lon: -62.0, kind: 'sea', reach: 500 },
  { name: 'Ungava Bay', lat: 59.5, lon: -67.5, kind: 'sea', reach: 500 },
  { name: 'Hudson Bay', lat: 59.0, lon: -85.0, kind: 'sea' },
  { name: 'Baffin Island', lat: 68.5, lon: -70.0, kind: 'island', reach: 700 },
  { name: 'Iqaluit', lat: 63.7467, lon: -68.5169, kind: 'city' },
  { name: 'Davis Strait', lat: 66.0, lon: -58.0, kind: 'sea', reach: 600 },
  { name: 'Rocky Mountains', lat: 50.0, lon: -115.0, kind: 'range', reach: 900 },
  { name: 'Great Plains', lat: 44.0, lon: -100.0, kind: 'steppe' },

  // --- Greenland, Iceland, the Arctic --------------------------------------
  { name: 'Greenland Ice Sheet', lat: 72.0, lon: -40.0, kind: 'ice', reach: 900 },
  { name: 'Nuuk', lat: 64.1836, lon: -51.7214, kind: 'city' },
  { name: 'Scoresby Sound', lat: 70.5, lon: -23.0, kind: 'sea', reach: 450, noArticle: true },
  { name: 'Greenland Sea', lat: 75.0, lon: -5.0, kind: 'sea' },
  { name: 'Reykjavik', lat: 64.1466, lon: -21.9426, kind: 'city', reach: 450 },
  { name: 'Denmark Strait', lat: 67.0, lon: -25.0, kind: 'sea', reach: 500 },
  { name: 'Jan Mayen', lat: 70.98, lon: -8.53, kind: 'island', reach: 350 },
  { name: 'Svalbard', lat: 78.22, lon: 15.63, kind: 'island', reach: 600 },
  { name: 'Arctic Ocean', lat: 85.0, lon: 0.0, kind: 'ice', reach: 1400 },
  { name: 'Fram Strait', lat: 79.0, lon: 0.0, kind: 'sea', reach: 500 },
  { name: 'Barents Sea', lat: 74.0, lon: 38.0, kind: 'sea' },
  { name: 'Novaya Zemlya', lat: 74.0, lon: 56.0, kind: 'island', reach: 600 },
  { name: 'Kara Sea', lat: 74.0, lon: 70.0, kind: 'sea' },
  { name: 'Franz Josef Land', lat: 81.0, lon: 55.0, kind: 'ice', reach: 600, noArticle: true },

  // --- Northern Europe -----------------------------------------------------
  { name: 'Norwegian Sea', lat: 68.0, lon: 5.0, kind: 'sea' },
  { name: 'Tromso', lat: 69.6492, lon: 18.9553, kind: 'city' },
  { name: 'Lofoten Islands', lat: 68.2, lon: 14.0, kind: 'island', reach: 350 },
  { name: 'Trondheim', lat: 63.4305, lon: 10.3951, kind: 'city' },
  { name: 'Oslo', lat: 59.9139, lon: 10.7522, kind: 'city' },
  { name: 'Stockholm', lat: 59.3293, lon: 18.0686, kind: 'city' },
  { name: 'Helsinki', lat: 60.1699, lon: 24.9384, kind: 'city' },
  { name: 'Murmansk', lat: 68.9585, lon: 33.0827, kind: 'city' },
  { name: 'Arkhangelsk', lat: 64.5401, lon: 40.5433, kind: 'city' },
  { name: 'White Sea', lat: 65.5, lon: 37.0, kind: 'sea', reach: 450 },
  { name: 'Lapland', lat: 67.5, lon: 26.0, kind: 'forest', reach: 600, noArticle: true },
  { name: 'Copenhagen', lat: 55.6761, lon: 12.5683, kind: 'city' },
  { name: 'Baltic Sea', lat: 57.5, lon: 19.5, kind: 'sea', reach: 600 },
  { name: 'North Sea', lat: 56.0, lon: 3.0, kind: 'sea', reach: 600 },
  { name: 'London', lat: 51.5074, lon: -0.1278, kind: 'city' },
  { name: 'Dublin', lat: 53.3498, lon: -6.2603, kind: 'city' },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, kind: 'city' },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041, kind: 'city' },
  { name: 'Berlin', lat: 52.52, lon: 13.405, kind: 'city' },
  { name: 'Warsaw', lat: 52.2297, lon: 21.0122, kind: 'city' },
  { name: 'Prague', lat: 50.0755, lon: 14.4378, kind: 'city' },
  { name: 'Vienna', lat: 48.2082, lon: 16.3738, kind: 'city' },
  { name: 'Alps', lat: 46.5, lon: 10.0, kind: 'range', reach: 400 },

  // --- Russia and Central Asia (the long middle of the flight) -------------
  { name: 'Saint Petersburg', lat: 59.9311, lon: 30.3609, kind: 'city' },
  { name: 'Moscow', lat: 55.7558, lon: 37.6173, kind: 'city' },
  { name: 'Komi Taiga', lat: 63.0, lon: 54.0, kind: 'forest', reach: 700 },
  { name: 'Vorkuta', lat: 67.4997, lon: 64.0361, kind: 'city' },
  { name: 'Ural Mountains', lat: 60.0, lon: 59.0, kind: 'range', reach: 800 },
  { name: 'Perm', lat: 58.0105, lon: 56.2502, kind: 'city' },
  { name: 'Yekaterinburg', lat: 56.8389, lon: 60.6057, kind: 'city' },
  { name: 'Siberian Taiga', lat: 60.0, lon: 80.0, kind: 'forest', reach: 1000 },
  { name: 'Omsk', lat: 54.9885, lon: 73.3242, kind: 'city' },
  { name: 'Chelyabinsk', lat: 55.1644, lon: 61.4368, kind: 'city' },
  { name: 'Kazakh Steppe', lat: 49.0, lon: 66.0, kind: 'steppe', reach: 800 },
  { name: 'Astana', lat: 51.1694, lon: 71.4491, kind: 'city' },
  { name: 'Aral Sea', lat: 45.0, lon: 60.0, kind: 'sea', reach: 450 },
  { name: 'Caspian Sea', lat: 41.5, lon: 51.0, kind: 'sea', reach: 600 },
  { name: 'Aralsk', lat: 46.7972, lon: 61.6636, kind: 'city' },
  { name: 'Kyzylorda', lat: 44.8479, lon: 65.5093, kind: 'city' },
  { name: 'Kyzylkum Desert', lat: 42.0, lon: 64.0, kind: 'desert', reach: 550 },
  { name: 'Tashkent', lat: 41.2995, lon: 69.2401, kind: 'city' },
  { name: 'Samarkand', lat: 39.627, lon: 66.975, kind: 'city' },
  { name: 'Bukhara', lat: 39.7747, lon: 64.4286, kind: 'city' },
  { name: 'Dushanbe', lat: 38.5598, lon: 68.787, kind: 'city' },
  { name: 'Pamir Mountains', lat: 38.5, lon: 73.0, kind: 'range', reach: 450 },
  { name: 'Tian Shan', lat: 42.0, lon: 78.0, kind: 'range', reach: 550 },
  { name: 'Almaty', lat: 43.222, lon: 76.8512, kind: 'city' },
  { name: 'Hindu Kush', lat: 35.5, lon: 70.5, kind: 'range', reach: 420 },
  { name: 'Kabul', lat: 34.5553, lon: 69.2075, kind: 'city' },
  { name: 'Karakoram', lat: 35.8, lon: 76.5, kind: 'range', reach: 400 },

  // --- South Asia ----------------------------------------------------------
  { name: 'Islamabad', lat: 33.6844, lon: 73.0479, kind: 'city' },
  { name: 'Lahore', lat: 31.5204, lon: 74.3587, kind: 'city' },
  { name: 'Amritsar', lat: 31.634, lon: 74.8723, kind: 'city' },
  { name: 'Punjab Plains', lat: 30.5, lon: 75.5, kind: 'steppe', reach: 400 },
  { name: 'Delhi', lat: 28.6139, lon: 77.209, kind: 'city' },
  { name: 'Jaipur', lat: 26.9124, lon: 75.7873, kind: 'city' },
  { name: 'Thar Desert', lat: 27.0, lon: 71.5, kind: 'desert', reach: 500 },
  { name: 'Agra', lat: 27.1767, lon: 78.0081, kind: 'city' },
  { name: 'Gwalior', lat: 26.2183, lon: 78.1828, kind: 'city' },
  { name: 'Bhopal', lat: 23.2599, lon: 77.4126, kind: 'city' },
  { name: 'Vindhya Range', lat: 23.5, lon: 78.5, kind: 'range', reach: 380 },
  { name: 'Nagpur', lat: 21.1458, lon: 79.0882, kind: 'city' },
  { name: 'Deccan Plateau', lat: 18.5, lon: 77.0, kind: 'steppe', reach: 500 },
  { name: 'Hyderabad', lat: 17.385, lon: 78.4867, kind: 'city' },
  { name: 'Mumbai', lat: 19.076, lon: 72.8777, kind: 'city' },
  { name: 'Pune', lat: 18.5204, lon: 73.8567, kind: 'city' },
  { name: 'Bengaluru', lat: 12.9716, lon: 77.5946, kind: 'city' },
  { name: 'Chennai', lat: 13.0827, lon: 80.2707, kind: 'city' },
  { name: 'Kolkata', lat: 22.5726, lon: 88.3639, kind: 'city' },
  { name: 'Karachi', lat: 24.8607, lon: 67.0011, kind: 'city' },
  { name: 'Kathmandu', lat: 27.7172, lon: 85.324, kind: 'city' },
  { name: 'Himalayas', lat: 29.0, lon: 84.0, kind: 'range', reach: 500 },
  { name: 'Colombo', lat: 6.9271, lon: 79.8612, kind: 'city' },
  { name: 'Dhaka', lat: 23.8103, lon: 90.4125, kind: 'city' },
  { name: 'Bay of Bengal', lat: 15.0, lon: 88.0, kind: 'sea' },
  { name: 'Arabian Sea', lat: 15.0, lon: 65.0, kind: 'sea' },

  // --- Middle East and Africa ---------------------------------------------
  { name: 'Tehran', lat: 35.6892, lon: 51.389, kind: 'city' },
  { name: 'Zagros Mountains', lat: 32.0, lon: 50.0, kind: 'range', reach: 500 },
  { name: 'Baghdad', lat: 33.3152, lon: 44.3661, kind: 'city' },
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784, kind: 'city' },
  { name: 'Black Sea', lat: 43.0, lon: 34.0, kind: 'sea', reach: 500 },
  { name: 'Yerevan', lat: 40.1792, lon: 44.4991, kind: 'city' },
  { name: 'Caucasus Mountains', lat: 43.0, lon: 44.0, kind: 'range', reach: 400 },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708, kind: 'city' },
  { name: 'Riyadh', lat: 24.7136, lon: 46.6753, kind: 'city' },
  { name: 'Mecca', lat: 21.3891, lon: 39.8579, kind: 'city' },
  { name: 'Medina', lat: 24.5247, lon: 39.5692, kind: 'city' },
  { name: 'Red Sea', lat: 20.0, lon: 38.5, kind: 'sea', reach: 450 },
  { name: 'Cairo', lat: 30.0444, lon: 31.2357, kind: 'city' },
  { name: 'Sahara', lat: 23.0, lon: 12.0, kind: 'desert', reach: 1200 },
  { name: 'Mediterranean', lat: 35.0, lon: 18.0, kind: 'sea', reach: 700 },
  { name: 'Nairobi', lat: -1.2921, lon: 36.8219, kind: 'city' },
  { name: 'Lagos', lat: 6.5244, lon: 3.3792, kind: 'city' },
  { name: 'Congo Basin', lat: -1.0, lon: 22.0, kind: 'forest', reach: 900 },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241, kind: 'city' },
  { name: 'Kalahari', lat: -23.0, lon: 22.0, kind: 'desert', reach: 700 },

  // --- East and Southeast Asia --------------------------------------------
  { name: 'Gobi Desert', lat: 43.0, lon: 105.0, kind: 'desert', reach: 800 },
  { name: 'Ulaanbaatar', lat: 47.8864, lon: 106.9057, kind: 'city' },
  { name: 'Beijing', lat: 39.9042, lon: 116.4074, kind: 'city' },
  { name: 'Shanghai', lat: 31.2304, lon: 121.4737, kind: 'city' },
  { name: 'Tibetan Plateau', lat: 33.0, lon: 88.0, kind: 'steppe', reach: 700 },
  { name: 'Lake Baikal', lat: 53.5, lon: 108.0, kind: 'sea', reach: 450, noArticle: true },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, kind: 'city' },
  { name: 'Seoul', lat: 37.5665, lon: 126.978, kind: 'city' },
  { name: 'Bangkok', lat: 13.7563, lon: 100.5018, kind: 'city' },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, kind: 'city' },
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456, kind: 'city' },
  { name: 'South China Sea', lat: 14.0, lon: 115.0, kind: 'sea' },
  { name: 'Sea of Okhotsk', lat: 55.0, lon: 150.0, kind: 'sea' },

  // --- Oceania and the southern oceans ------------------------------------
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, kind: 'city' },
  { name: 'Perth', lat: -31.9505, lon: 115.8605, kind: 'city' },
  { name: 'Auckland', lat: -36.8485, lon: 174.7633, kind: 'city' },
  { name: 'Australian Outback', lat: -24.0, lon: 133.0, kind: 'desert', reach: 1000 },
  { name: 'Coral Sea', lat: -18.0, lon: 152.0, kind: 'sea' },
  { name: 'Southern Ocean', lat: -60.0, lon: 90.0, kind: 'sea', reach: 1600 },

  // --- South America -------------------------------------------------------
  { name: 'Sao Paulo', lat: -23.5505, lon: -46.6333, kind: 'city' },
  { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816, kind: 'city' },
  { name: 'Lima', lat: -12.0464, lon: -77.0428, kind: 'city' },
  { name: 'Bogota', lat: 4.711, lon: -74.0721, kind: 'city' },
  { name: 'Amazon', lat: -4.0, lon: -62.0, kind: 'forest', reach: 1000 },
  { name: 'Andes', lat: -20.0, lon: -68.0, kind: 'range', reach: 700 },
  { name: 'Patagonian Steppe', lat: -46.0, lon: -70.0, kind: 'steppe', reach: 700 },

  // --- Open ocean fallbacks -----------------------------------------------
  { name: 'North Atlantic', lat: 45.0, lon: -35.0, kind: 'sea', reach: 1400 },
  { name: 'South Atlantic', lat: -25.0, lon: -15.0, kind: 'sea', reach: 1600 },
  { name: 'North Pacific', lat: 35.0, lon: -170.0, kind: 'sea', reach: 1800 },
  { name: 'South Pacific', lat: -25.0, lon: -130.0, kind: 'sea', reach: 1800 },
  { name: 'Indian Ocean', lat: -20.0, lon: 75.0, kind: 'sea', reach: 1600 },
];

export function reachOf(l: Landmark): number {
  return l.reach ?? DEFAULT_REACH[l.kind];
}

export interface NearestLandmark {
  landmark: Landmark;
  distanceKm: number;
}

/**
 * The most specific named place that can plausibly claim this point.
 *
 * Scored by how deep into a feature's reach the point sits, so a pigeon over
 * Tromso reports Tromso rather than the much larger Norwegian Sea it also
 * technically sits inside.
 */
export function nearestLandmark(p: LatLon): NearestLandmark {
  let best: NearestLandmark | null = null;
  let bestScore = Infinity;
  let fallback: NearestLandmark = { landmark: LANDMARKS[0], distanceKm: Infinity };

  for (const landmark of LANDMARKS) {
    const d = distanceKm(p, landmark);
    if (d < fallback.distanceKm) fallback = { landmark, distanceKm: d };

    const reach = reachOf(landmark);
    if (d > reach) continue;

    // Lower is better. Normalising by reach lets a small, close city beat a
    // large ocean whose centre happens to be nearer in absolute terms.
    const score = d / reach;
    if (score < bestScore) {
      bestScore = score;
      best = { landmark, distanceKm: d };
    }
  }

  return best ?? fallback;
}

/** Landmarks a bird can actually stand on. */
export function isLandable(l: Landmark): boolean {
  return l.kind !== 'sea';
}
