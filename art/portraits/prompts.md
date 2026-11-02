# Captain portrait prompts (Nano Banana)

Storybook 1900 Great Lakes busts for the eight likeness presets in [`data/portraits.json`](../data/portraits.json). Style B ([plan 14 §3](../plans/14-art-direction-asset-pipeline.md)): toon shapes, two–three soft shade bands, dark ink outlines, Detroit Publishing photochrom palette. Target feel: painted RPG bust (modeled face, period tailoring), not flat SVG and not a photograph.

**Do not generate or wire assets from this file until prompts are approved.** The brass oval stays in [`src/ui/menu/Portrait.tsx`](../src/ui/menu/Portrait.tsx); backgrounds should match parchment `#d9c393` for a clean clip.

---

## Shared style block

Paste this at the start of every `/generate` prompt (same lighting and crop on all eight):

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.
```

---

## Negative tail (every prompt)

Append to each full prompt:

```
No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

---

## Full prompts by preset id

### `portrait.weathered` — Weathered

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Middle-aged white man, tan weathered skin, short brown hair, full brown beard. Dark mate's peaked cap with a small brass plate on the front. Navy sack coat #2f3b4a over a cream shirt with a simple collar. Calm, experienced dock or deck expression.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.young` — Young hand

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Young white man, fair skin, short auburn hair, clean-shaven, no hat. Brown work coat #5b4636, plain shirt collar visible. Open, youthful sailor or deckhand look.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.greybeard` — Greybeard

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Older white man, fair skin, short grey hair, full grey beard. Yellow oilskin sou'wester rain hat with a wide brim, fully visible. Olive drab coat #6d6a2f, fisherman or veteran mariner.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.mustache` — Mustache

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Black man, medium tan skin, short black hair, neat mustache only, no full beard. Black bowler hat. Dark brown coat #3a2c22, city or waterfront gentleman of 1900.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.lumber` — Woodsman

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Black man, medium-brown skin, short black hair, full black beard. Red wool tuque lumber-camp cap, no logo or lettering. Red work coat #8a2f28, north woods laborer.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.captain` — Officer

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Black man, deep brown skin, short black hair, trimmed mustache. Dark navy peaked officer or mate's cap with a small brass plate. Darker navy coat #1f2a3a, authoritative but not military dress uniform.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.woman` — Braided

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Young white woman, light-medium skin, auburn hair in one thick braid draped over her right shoulder, no hat. Teal coat #2f5a5c with a high 1900 shirt collar and modest neckline. Steady, capable expression.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

### `portrait.woman_hat` — Bonneted

```
Front-facing character bust portrait, head in the upper half of the frame, shoulders at the bottom. Hat fully inside the frame with comfortable margin above and beside it so an oval crop will not cut wide brims or bonnet ribbons. Flat warm parchment background color exactly #d9c393, solid edge to edge, no gradient, no sky, no room interior, no painted oval frame, no brass ring, no text. Storybook cartoon illustration for a 1900 Lake Superior game: clean dark brown ink outlines, two or three soft cel-shade bands, limited muted photochrom colors, gentle face modeling with readable eyes and brows. Working-class and waterfront clothing of circa 1900, not modern cuts, not formal court dress. Single person only, soft even daylight from upper left, no dramatic cast shadows, no props except what the outfit requires.

Black woman, medium-brown skin, dark hair mostly under a purple sunbonnet with brim framing the face and ribbon ties under the chin, bonnet and ribbons fully inside frame. Purple coat #4a3550, settler or townswoman of the Upper Midwest circa 1900.

No text, no watermark, no logo, no extra people, no modern clothing, no photographic realistic skin, no 3D render look, no anime.
```

---

## Run notes (Nano Banana / Gemini CLI)

Prerequisites: [nano-banana skill](https://github.com/gemini-cli-extensions/nanobanana), `GEMINI_API_KEY` set. From repo root:

```bash
cd /home/jpchip/workspace/great-lakes-pirate
export GEMINI_CLI_TRUST_WORKSPACE=true
```

**Style pass first** — generate three variants for Weathered only; pick the best before running the other seven:

```bash
GEMINI_CLI_TRUST_WORKSPACE=true gemini --yolo -p "/generate '<paste portrait.weathered prompt here>' --aspect=3:4 --count=3"
```

**Remaining presets** — one image each (adjust id and prompt):

```bash
GEMINI_CLI_TRUST_WORKSPACE=true gemini --yolo -p "/generate '<paste prompt>' --aspect=3:4"
```

Outputs land in `./nanobanana-output/`. For higher detail (optional):

```bash
export NANOBANANA_MODEL=gemini-3-pro-image-preview
```

**After generation (integration, not done yet):** resize/crop to match the 100:120 bust framing, verify `#d9c393` background or key and composite into the existing oval UI. Do not change `Portrait.tsx` until art is approved.

**Reference:** painted storybook bust with ink outlines and soft bands (user reference); current flat presets are programmatic SVG in `Portrait.tsx`.
