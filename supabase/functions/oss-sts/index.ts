// SuQCanvas OSS STS 凭证签发服务
// 部署到 Supabase Edge Functions，前端通过 VITE_OSS_STS_URL 调用
//
// 需要配置的环境变量（Secrets）：
//   ALIYUN_AK_ID       - RAM 用户 AccessKey ID（该用户需有 sts:AssumeRole 权限）
//   ALIYUN_AK_SECRET    - 对应 AccessKey Secret
//   ALIYUN_ROLE_ARN     - RAM 角色 ARN，如 acs:ram::1234567890:role/suqcanvas-oss-role
//
// 部署（supabase CLI）：
//   supabase secrets set ALIYUN_AK_ID=... ALIYUN_AK_SECRET=... ALIYUN_ROLE_ARN=...
//   supabase functions deploy oss-sts --project-ref <ref> --no-verify-jwt

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'

const AK_ID = Deno.env.get('ALIYUN_AK_ID') ?? ''
const AK_SECRET = Deno.env.get('ALIYUN_AK_SECRET') ?? ''
const ROLE_ARN = Deno.env.get('ALIYUN_ROLE_ARN') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, '%20')
    .replace(/%21/g, '!')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%7E/g, '~')
}

function toQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')
}

async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const keyBuf = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', keyBuf, new TextEncoder().encode(data))
  const bytes = new Uint8Array(sig)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function assumeRole(): Promise<{ AccessKeyId: string; AccessKeySecret: string; SecurityToken: string; Expiration: string }> {
  const params: Record<string, string> = {
    Action: 'AssumeRole',
    Version: '2015-04-01',
    Format: 'JSON',
    AccessKeyId: AK_ID,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    RoleArn: ROLE_ARN,
    RoleSessionName: 'suqcanvas-web',
    DurationSeconds: '3600',
  }
  const canonical = toQueryString(params)
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`
  const signature = await hmacSha1Base64(`${AK_SECRET}&`, stringToSign)
  const url = `https://sts.aliyuncs.com/?${canonical}&Signature=${percentEncode(signature)}`

  const res = await fetch(url)
  const body = await res.json()
  if (!res.ok || body.Code) {
    throw new Error(`STS AssumeRole 失败: ${body.Code ?? res.status} ${body.Message ?? ''}`)
  }
  return body.Credentials
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    if (!AK_ID || !AK_SECRET || !ROLE_ARN) {
      return new Response(
        JSON.stringify({ error: '服务端未配置 ALIYUN_* 环境变量' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }
    const creds = await assumeRole()
    const payload = {
      accessKeyId: creds.AccessKeyId,
      accessKeySecret: creds.AccessKeySecret,
      securityToken: creds.SecurityToken,
      expiration: creds.Expiration,
    }
    return new Response(JSON.stringify(payload), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'unknown error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }
})
