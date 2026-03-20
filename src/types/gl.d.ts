declare module 'gl' {
  interface WebGLContextOptions {
    preserveDrawingBuffer?: boolean;
    antialias?: boolean;
    depth?: boolean;
    stencil?: boolean;
  }
  function createContext(
    width: number,
    height: number,
    options?: WebGLContextOptions,
  ): WebGLRenderingContext;
  export = createContext;
}
