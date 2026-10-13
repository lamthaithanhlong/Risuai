// A phone that opens http://<mac-lan-ip>:6001 has no crypto.subtle (HTTP, not localhost), so Risu dies at login.
// When the HTTPS front (lan-tls.cjs) is set up, send such requests to it instead of serving them.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function hostnameOf(hostHeader) {
    if (typeof hostHeader !== 'string' || !hostHeader) {
        return '';
    }
    const h = hostHeader.trim().toLowerCase();
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return end === -1 ? h : h.slice(0, end + 1);
    }
    return h.split(':')[0];
}

function isLoopbackAddress(addr) {
    return typeof addr === 'string' && (addr === '::1' || addr === '127.0.0.1' || addr.startsWith('::ffff:127.'));
}

/**
 * The https:// URL to send this request to, or null to serve it normally.
 * Redirect only a request that came from another device or the LAN address itself (a real, non-loopback client),
 * for a Host that is not localhost. The HTTPS front connects from loopback, so it is never redirected (no loop),
 * and the Mac's own http://localhost:6001 keeps working.
 */
function lanRedirectTarget(hostHeader, remoteAddress, originalUrl, tlsPort) {
    const hostname = hostnameOf(hostHeader);
    if (!hostname || LOOPBACK_HOSTS.has(hostname) || isLoopbackAddress(remoteAddress)) {
        return null;
    }
    return `https://${hostname}:${tlsPort}${originalUrl || '/'}`;
}

module.exports = { lanRedirectTarget, hostnameOf, isLoopbackAddress };
