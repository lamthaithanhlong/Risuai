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

/** A private IPv4 address (10/8, 172.16/12, 192.168/16, 169.254/16), a .local name or a bare single-label name. */
function isPrivateLanHost(hostname) {
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (ipv4) {
        const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
        if ([ipv4[1], ipv4[2], ipv4[3], ipv4[4]].some((o) => Number(o) > 255)) {
            return false;
        }
        return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    if (hostname.startsWith('[')) {
        return false;
    }
    return /^[a-z0-9-]+(\.local)?$/.test(hostname);
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
    // The Host header is the client's own word. Redirecting to any name it gives is an open redirect, so only a
    // private-network address or a local name is sent on (what a phone typing the Mac's LAN address sends).
    if (!isPrivateLanHost(hostname)) {
        return null;
    }
    return `https://${hostname}:${tlsPort}${originalUrl || '/'}`;
}

module.exports = { lanRedirectTarget, hostnameOf, isLoopbackAddress, isPrivateLanHost };
