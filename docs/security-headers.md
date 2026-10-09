# Security headers, rewrites and the sign-in redirect (build-time settings)

`next.config.mjs` bakes the response headers and the rewrites into the build (`routes-manifest.json`), and inlines
`OASIS_PUBLIC_HOSTS` into the middleware. So **the variables below must be in the environment of `pnpm build:live`**;
setting them only for `next start` changes nothing. A malformed value throws when the config loads, so the build fails
instead of shipping a wider policy. Tests: `tests/security/next-config.test.ts`, `tests/security/headers.test.ts`,
`src/middleware.test.ts`.

| Variable               | Format                                              | Unset or empty                                                    |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `API_ORIGIN`           | origin of the API, e.g. `http://127.0.0.1:4091`     | no `/api/:path*` or `/dev-storage/:path*` rewrite at all          |
| `OASIS_PHOTOS_ORIGINS` | comma-separated bare `https://host[:port]` origins  | CSP `img-src 'self' data: blob:` and `connect-src 'self'`         |
| `OASIS_PUBLIC_HOSTS`   | comma-separated `host[:port]`, the first is primary | the redirect echoes any well-formed Host (else the server's host) |

## `API_ORIGIN`: only live stacks, the fake API and `next dev`

A Next rewrite matches case-insensitively, while nginx's `location /api/` does not. With a rewrite in the production build,
`/API/v1/openapi.json` went nginx `location /` -> Next -> API, skipping nginx's openapi deny and its `oasis_login`/`oasis_api`
limits (production review M1). Production leaves `API_ORIGIN` unset: nginx serves `/api` and `/dev-storage` itself, and
Next has no route to the API. `scripts/live-stack.ts` sets it for every stack (build and `start:live`); for the fake API
use `API_ORIGIN=http://localhost:4000 pnpm build:live`. There is no implicit `http://localhost:4000` any more.

## `OASIS_PHOTOS_ORIGINS`: the CSP's photo origins

Photos are uploaded with a presigned POST and shown with presigned GET URLs on the photos bucket. The CSP allows exactly
the listed origins in `img-src` and `connect-src`, instead of the former `https://*.amazonaws.com` (any bucket, any
endpoint; production review L1). Rules: https only, no wildcard, no path, query, fragment or credentials, lower-case host,
no default port (`:443`), no empty entries; a trailing `/` is dropped and duplicates are merged. For the production bucket
list both the global and the regional virtual-hosted forms the SDK may sign:

```
OASIS_PHOTOS_ORIGINS=https://oasis-photos-580446611342.s3.amazonaws.com,https://oasis-photos-580446611342.s3.us-east-1.amazonaws.com
```

With the fs storage simulator (live stacks) photos come from `/dev-storage` on this origin, so no value is needed. The CSP
itself is only sent by the live variant in production (`NODE_ENV=production`); the fixture, parity and `next dev` builds
send the other headers only.

## `OASIS_PUBLIC_HOSTS`: where the sign-in redirect may point

Next requires an absolute URL in a middleware redirect, and behind nginx `req.url` is the internal
`https://localhost:3200/...`, so `src/middleware.ts` (`publicOrigin`) builds the origin from `X-Forwarded-Host` (first
value), else `Host`, else the server's own host, and the scheme from `X-Forwarded-Proto` (`http` or `https` only).
With `OASIS_PUBLIC_HOSTS` set, the host must be one of the listed ones (case-insensitive); anything else, including a
missing header, a spoofed `Host` or a spoofed or multi-valued `X-Forwarded-Host` whose first value is not listed, falls
back to the first listed host. A redirect can then never point anywhere but the public host. Without it (live stacks,
dev) a well-formed `host[:port]` or `[ipv6]:port` is echoed back to the person who sent it, and anything that could add
userinfo, a path or a second authority falls back to the server's own host.

Production:

```
OASIS_PUBLIC_HOSTS=app.oasisautospanj.com
```

## What the deploy kit has to do (backend repo, `deploy/scripts/deploy.sh`)

Pass `OASIS_PHOTOS_ORIGINS` and `OASIS_PUBLIC_HOSTS` to the `pnpm build:live` step and keep `API_ORIGIN` out of it. Check
a build with:

```bash
grep -c localhost:4000 .next-live/routes-manifest.json            # 0
grep -o 'img-src[^;]*' .next-live/routes-manifest.json | head -1  # the bucket origins, no *.amazonaws.com
grep -rl app.oasisautospanj.com .next-live/server/middleware.js   # the allowlist is inlined
```
