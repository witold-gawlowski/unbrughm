// Tunable constants shared across the renderer.

export const SIZE = 1;            // cube size + spacing
export const CHUNK_SIZE = 16;     // cubes are merged into 16x16 chunk meshes
export const BUFFER_CHUNKS = 1;   // extra ring of chunks loaded beyond the visible area
export const BUILD_BUDGET = 4;    // max chunks built per frame (time-sliced)
export const FADE_BAKE_BUDGET = 2; // max darkness bake tiles per frame (time-sliced)

export const CHUNK_SPAN = CHUNK_SIZE * SIZE;   // world size of one chunk

// 3/4 (isometric-ish) view: 'd' controls zoom / on-screen cube size; the
// infinite field simply extends past the viewport edges.
export const VIEW_DISTANCE = 8;

export const BACKGROUND = 0x1a1a22;

// One shadow-casting directional "sun". Toggle SHADOWS to A/B the cost
// (shadows add one depth pass over the visible chunks).
export const SHADOWS = true;              // master on/off
export const SUN_OFFSET = [-60, 100, 25]; // light position relative to target (world units)
export const SUN_INTENSITY = 0.9;
export const AMBIENT_INTENSITY = 1.5;     // fill so shadowed faces don't crush to black
export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_RADIUS = 4;           // PCF blur radius — softens hard shadow edges

// The player ball: radius in SIZE units, glide speed in world units/second.
export const BALL_RADIUS = 0.3;
export const BALL_SPEED = 4;

export const DIG_DELAY = 1;   // seconds the ball waits beside a rock before it breaks

// Rock tops fade from full brightness at the tunnel edge down to
// MIN_BRIGHTNESS at FADE_RADIUS cells away from the nearest dug cell.
// The fade is a distance-field texture sampled per fragment, baked at
// FADE_RESOLUTION texels per cell.
export const FADE_RADIUS = 3;
export const MIN_BRIGHTNESS = 0.05;
export const FADE_RESOLUTION = 8;
