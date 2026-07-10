// Tunable constants shared across the renderer.

export const SIZE = 1;            // cube size + spacing
export const CHUNK_SIZE = 16;     // cubes are merged into 16x16 chunk meshes
export const BUFFER_CHUNKS = 1;   // extra ring of chunks loaded beyond the visible area
export const BUILD_BUDGET = 4;    // max chunks built per frame (time-sliced)

export const CHUNK_SPAN = CHUNK_SIZE * SIZE;   // world size of one chunk

// 3/4 (isometric-ish) view: 'd' controls zoom / on-screen cube size; the
// infinite field simply extends past the viewport edges.
export const VIEW_DISTANCE = 8;

export const BACKGROUND = 0x1a1a22;

// Rock tops fade from full brightness at the tunnel edge down to
// MIN_BRIGHTNESS at FADE_RADIUS cells away from the nearest dug cell.
// The fade is a distance-field texture sampled per fragment, baked at
// FADE_RESOLUTION texels per cell.
export const FADE_RADIUS = 3;
export const MIN_BRIGHTNESS = 0.05;
export const FADE_RESOLUTION = 8;
