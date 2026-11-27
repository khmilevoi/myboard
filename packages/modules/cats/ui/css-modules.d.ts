// The module's `ui/` is bundled by each widget's Vite build, which turns a CSS module into its
// class map; this states that shape for `tsc`, which has no Vite types here.
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
