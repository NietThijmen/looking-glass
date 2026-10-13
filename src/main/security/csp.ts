const shared = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
]

// ghostty-web compiles its terminal emulator from WebAssembly ('wasm-unsafe-eval'; plain eval stays
// blocked) and fetches the .wasm from an inlined data: URL.
const wasm = "'wasm-unsafe-eval'"

export const productionCsp = [...shared, `script-src 'self' ${wasm}`, "connect-src 'self' data:"].join('; ')

// Vite's dev server needs an inline React Refresh preamble and an HMR websocket.
export const developmentCsp = [
  ...shared,
  `script-src 'self' 'unsafe-inline' ${wasm}`,
  "connect-src 'self' data: ws://localhost:* http://localhost:*",
].join('; ')
