export default {
  root: '.',
  build: {
    outDir: 'dist',
    minify: 'terser',
    target: 'es2020'
  },
  server: {
    port: 5173
  }
}
