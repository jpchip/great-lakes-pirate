import captain from '../../../art/portraits/captain.png';
import greybeard from '../../../art/portraits/greybeard.png';
import lumber from '../../../art/portraits/lumber.png';
import mustache from '../../../art/portraits/mustache.png';
import weathered from '../../../art/portraits/weathered.png';
import woman from '../../../art/portraits/woman.png';
import womanHat from '../../../art/portraits/woman_hat.png';
import young from '../../../art/portraits/young.png';

/** Raster busts in `art/portraits/` keyed by `data/portraits.json` id. */
const PORTRAIT_IMAGES: Record<string, string> = {
  'portrait.weathered': weathered,
  'portrait.young': young,
  'portrait.greybeard': greybeard,
  'portrait.mustache': mustache,
  'portrait.lumber': lumber,
  'portrait.captain': captain,
  'portrait.woman': woman,
  'portrait.woman_hat': womanHat,
};

export function portraitImageUrl(id: string): string | undefined {
  return PORTRAIT_IMAGES[id];
}
