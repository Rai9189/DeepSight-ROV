// Where to go after signing in. Same-origin paths only — blocks open redirects like //evil.com or /\evil.com
export function safeCallbackUrl(): string {
  const url = new URLSearchParams(window.location.search).get('callbackUrl')
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : '/dashboard'
}
