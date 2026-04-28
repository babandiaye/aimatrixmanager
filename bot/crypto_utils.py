"""
Décryptage AES-256-GCM compatible avec src/lib/crypto.ts d'aibotmanager.
Format des payloads : 'enc:v1:' + base64(iv[12] + tag[16] + ciphertext)
"""
import base64
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "enc:v1:"
_KEY: Optional[bytes] = None


def _get_key() -> bytes:
    global _KEY
    if _KEY is not None:
        return _KEY
    raw = os.environ.get("WS_TOKEN_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError("WS_TOKEN_ENCRYPTION_KEY manquant")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError(f"Clé invalide : 32 bytes attendus, {len(key)} reçus")
    _KEY = key
    return key


def decrypt(payload: str) -> str:
    """Déchiffre un payload. Si pas de préfixe 'enc:v1:', considère comme legacy clair."""
    if not payload.startswith(PREFIX):
        return payload
    buf = base64.b64decode(payload[len(PREFIX):])
    if len(buf) < 28:
        raise ValueError("Payload chiffré trop court")
    iv = buf[:12]
    tag = buf[12:28]
    ct = buf[28:]
    aesgcm = AESGCM(_get_key())
    pt = aesgcm.decrypt(iv, ct + tag, None)
    return pt.decode("utf-8")
