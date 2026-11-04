// Новая пара ключей VAPID для сервера напоминаний: node scripts/vapid-keys.mjs
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
console.log('VAPID_PUBLIC=' + b64url(raw))
console.log('VAPID_PRIVATE=' + jwk.d)
