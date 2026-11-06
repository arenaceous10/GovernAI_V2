// Public key that checks GovernAI evidence packs (Ed25519, SPKI, base64). The private half is the server's
// EVIDENCE_SIGNING_KEY. Publishing this is safe: it can only check signatures, not make them.
// VITE_EVIDENCE_PUBLIC_KEY replaces it only in test builds.
export const EVIDENCE_PUBLIC_KEY = import.meta.env?.VITE_EVIDENCE_PUBLIC_KEY || 'MCowBQYDK2VwAyEAHXwiGJlEqujL6UmJHb/oWAv23e7mt6eXeDNpPvDrXEQ=';
