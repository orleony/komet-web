// Шифрование Web Push сверяется с эталонным примером из RFC 8291 (приложение A)
import { describe, expect, it } from 'vitest'
import { b64url, encrypt, fromB64url, generateVapidKeys, vapidHeader } from '../worker/src/webpush'

describe('Web Push', () => {
  it('шифрует как в RFC 8291', async () => {
    const body = await encrypt(new TextEncoder().encode('When I grow up, I want to be a watermelon'), {
      endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
      keys: {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
    }, {
      salt: fromB64url('DGv6ra1nlYgDCS1FRnbzlw'),
      serverPrivate: fromB64url('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      serverPublic: fromB64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
    })
    expect(b64url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('подпись VAPID проверяется открытым ключом', async () => {
    const keys = await generateVapidKeys()
    const header = await vapidHeader('https://web.push.apple.com/abc', { ...keys, subject: 'https://example.github.io/komet-web/' })
    const [, token] = /t=([^,]+)/.exec(header)!
    const [h, c, s] = token.split('.')
    const pub = await crypto.subtle.importKey('raw', fromB64url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(s), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c))).aud).toBe('https://web.push.apple.com')
  })
})
