// How an RDP tab draws its desktop on the canvas (milestone 34): through WebGL, a
// texture updated by region and drawn as one quad, when the page has a real GPU; else
// through the 2D context's putImageData, as in milestone 30. A software WebGL
// (SwiftShader, llvmpipe) is slower than putImageData, so it is not used.

export type RendererKind = 'webgl' | '2d';

export interface DeskRenderer {
  readonly kind: RendererKind;
  /** The desktop's size changed: the canvas and its texture follow. */
  resize(width: number, height: number): void;
  /** RGBA rows of the region (x, y, w, h), alpha already 255. */
  draw(x: number, y: number, w: number, h: number, rgba: Uint8Array): void;
  /** WebGL lost its context (the GPU process restarted): the view starts again in 2D. */
  lost(): boolean;
  dispose(): void;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

/** Whether a WebGL renderer string names a software rasterizer. */
export function isSoftwareRenderer(name: string): boolean {
  return SOFTWARE.test(name);
}

/** The renderer to use, given what a probe found: WebGL only on a real GPU. A forced
 *  choice (`FLINT_RDP_RENDERER` in tests) wins when it is possible. */
export function chooseRenderer(probe: { webgl: boolean; renderer: string }, forced?: string | null): RendererKind {
  if (forced === '2d') return '2d';
  if (!probe.webgl) return '2d';
  if (forced === 'webgl') return 'webgl';
  return isSoftwareRenderer(probe.renderer) ? '2d' : 'webgl';
}

/** What this page's WebGL is, read on a throwaway canvas: a canvas keeps the first
 *  kind of context it hands out, so the desktop's own canvas is not used to ask. */
export function probeWebgl(): { webgl: boolean; renderer: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    if (!gl) return { webgl: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl: true, renderer };
  } catch {
    return { webgl: false, renderer: '' };
  }
}

let probed: { webgl: boolean; renderer: string } | null = null;

/** The renderer for a desktop canvas. Falls back to 2D when WebGL cannot start. */
export function createRenderer(canvas: HTMLCanvasElement, forced?: string | null): DeskRenderer | null {
  probed ??= probeWebgl();
  if (chooseRenderer(probed, forced) === 'webgl') {
    const r = createWebgl(canvas);
    if (r) return r;
  }
  return create2d(canvas);
}

function create2d(canvas: HTMLCanvasElement): DeskRenderer | null {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  return {
    kind: '2d',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    draw(x, y, w, h, rgba) {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), x, y);
    },
    lost: () => false,
    dispose() {},
  };
}

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D desk;
void main() { gl_FragColor = vec4(texture2D(desk, uv).rgb, 1.0); }`;

function createWebgl(canvas: HTMLCanvasElement): DeskRenderer | null {
  // preserveDrawingBuffer: the canvas keeps the last frame for a read (tests, the
  // greyed last frame of a lost connection) between draws.
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERTEX);
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // The canvas is shown at 1:1 or scaled down by CSS: no mipmaps, edges clamped
  // (a desktop's width need not be a power of two).
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.uniform1i(gl.getUniformLocation(prog, 'desk'), 0);
  let texW = 0;
  let texH = 0;
  return {
    kind: 'webgl',
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      texW = width;
      texH = height;
    },
    draw(x, y, w, h, rgba) {
      if (x + w > texW || y + h > texH) return;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    lost: () => gl.isContextLost(),
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
