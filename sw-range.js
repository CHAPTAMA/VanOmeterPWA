/*
 * sw-range.js — answers HTTP Range requests for the wake-lock video from the precache.
 *
 * Safari only plays <video> from a service worker if a "Range: bytes=..." request gets a
 * 206 Partial Content answer; Workbox's precache route replies with a plain 200 and
 * iOS then refuses to play the file. This classic script is loaded via importScripts
 * (see vite.config.ts), so its fetch listener runs before Workbox's and handles only
 * nosleep.mp4 range requests; everything else falls through untouched.
 *
 * Plain JS on purpose (it is loaded as-is by the worker). parseRange is also exported
 * for the unit tests when loaded as a CommonJS module.
 */

/**
 * Parse a single "bytes=start-end" range for a resource of `size` bytes.
 * Returns {start, end} (inclusive) or null when invalid/unsatisfiable. Multi-range is not supported.
 */
function parseRange(header, size) {
  if (typeof header !== 'string' || !Number.isInteger(size) || size <= 0) return null;
  var m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null || (m[1] === '' && m[2] === '')) return null;
  var start;
  var end;
  if (m[1] === '') {
    // suffix range: last N bytes
    var n = Number(m[2]);
    if (!(n > 0)) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start <= end) || start >= size) return null;
  return { start: start, end: end };
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof caches !== 'undefined') {
  self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET' || !req.headers.has('range')) return;
    var url = new URL(req.url);
    if (url.origin !== self.location.origin || !/\/nosleep\.mp4$/.test(url.pathname)) return;

    // Keep Workbox's own fetch listener from calling respondWith a second time (it would throw).
    event.stopImmediatePropagation();
    event.respondWith(
      caches.match(req.url, { ignoreSearch: true }).then(function (hit) {
        if (!hit) return fetch(req);
        return hit.arrayBuffer().then(function (buf) {
          var range = parseRange(req.headers.get('range'), buf.byteLength);
          if (range === null) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': 'bytes */' + buf.byteLength },
            });
          }
          var body = buf.slice(range.start, range.end + 1);
          return new Response(body, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Length': String(body.byteLength),
              'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + buf.byteLength,
            },
          });
        });
      }),
    );
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseRange: parseRange };
}
