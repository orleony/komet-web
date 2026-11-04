// Web Push без библиотек: шифрование aes128gcm (RFC 8291) и подпись VAPID (RFC 8292) на WebCrypto.
// Работает и в Cloudflare Workers, и в Node 20 (для тестов).

const enc = new TextEncoder()

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** Пара ключей P-256 из «сырых» байтов: закрытый 32 байта + открытый 65 байт. */
function jwk(privateKey: Uint8Array, publicKey: Uint8Array): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', d: b64url(privateKey), x: b64url(publicKey.slice(1, 33)), y: b64url(publicKey.slice(33, 65)), ext: true }
}

export interface Subscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Шифрует сообщение для конкретной подписки (RFC 8291). salt и ключи сервера можно задать — для теста. */
export async function encrypt(
  payload: Uint8Array,
  sub: Subscription,
  fixed?: { salt: Uint8Array; serverPrivate: Uint8Array; serverPublic: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.keys.p256dh)
  const authSecret = fromB64url(sub.keys.auth)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))

  let serverPrivateKey: CryptoKey
  let serverPublic: Uint8Array
  if (fixed) {
    serverPrivateKey = await crypto.subtle.importKey('jwk', jwk(fixed.serverPrivate, fixed.serverPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    serverPublic = fixed.serverPublic
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    serverPrivateKey = pair.privateKey
    serverPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverPrivateKey, 256))

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, serverPublic)
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // Одна запись: текст + разделитель 0x02 (последняя запись), без дополнительного выравнивания
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))))

  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return concat(salt, rs, new Uint8Array([serverPublic.length]), serverPublic, ciphertext)
}

/** Подпись VAPID: сервис push знает, что сообщение от нашего сервера. */
export async function vapidHeader(endpoint: string, vapid: { publicKey: string; privateKey: string; subject: string }): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })))
  const signingKey = await crypto.subtle.importKey('jwk', jwk(fromB64url(vapid.privateKey), fromB64url(vapid.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`
}

export interface PushResult {
  status: number
  /** Подписка больше не действует — удалить */
  gone: boolean
}

export async function sendPush(sub: Subscription, message: object, vapid: { publicKey: string; privateKey: string; subject: string }, ttl = 3600): Promise<PushResult> {
  const body = await encrypt(enc.encode(JSON.stringify(message)), sub)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
    },
    body,
  })
  return { status: res.status, gone: res.status === 404 || res.status === 410 }
}

/** Новая пара ключей VAPID (один раз при настройке сервера). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return { publicKey: b64url(pub), privateKey: priv.d! }
}
