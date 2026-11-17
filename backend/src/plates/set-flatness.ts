// A painted set must cover the whole frame with picture: the image model sometimes reads "plain ground" literally and paints the bottom third as one smooth band
// of colour (the blank beige band under the rope scene). That band then shows in every frame under the cast and the subtitles. This looks at the picture itself (no
// model call): from the bottom edge upwards, how much of the height has no texture at all? A real ground (grass, earth, cobbles, boards) always has some.
import sharp from "sharp";

/** A row is blank when the mean brightness step between neighbouring pixels (0..255, on a 96 px wide copy) is below this: the staging blank band measured 0.4-0.5, the plainest real ground 2.2. */
export const BLANK_ROW_TEXTURE = 1.2;
/** The share of the picture height a blank band may take before the picture is repainted. */
export const FLAT_BAND_MAX = 0.05;

/** The share (0..1) of the picture height, from the bottom edge up, that is a blank band. */
export async function flatBandShare(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image).resize({ width: 96, height: 171, fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rowTexture = (y: number) => { let s = 0; for (let x = 1; x < info.width; x++) s += Math.abs(data[y * info.width + x]! - data[y * info.width + x - 1]!); return s / (info.width - 1); };
  let rows = 0;
  for (let y = info.height - 1; y >= 0 && rowTexture(y) < BLANK_ROW_TEXTURE; y--) rows++;
  return rows / info.height;
}
