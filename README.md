<h1 align="center">ene</h1>

<p align="center">
Write data flows as text. Watch the data move.
</p>

<p align="center">
<a href="./README.ko.md">한국어</a>
</p>

---

## Table of content

- [About](#about)
- [Examples](#examples)
- [Usage](#usage)
- [Syntax](#syntax)
- [Release](#release)
- [Related projects](#related-projects)
- [Contributors](#contributors)
- [Security](#security)

## About

Architecture diagrams show **what is connected**. They rarely show **what happens** — which request goes first, where it waits, where it fails, which path a cache miss takes.

ene turns a few lines of text into a diagram where the data actually travels along the arrows. Diagrams come with a player — play, pause, step, change speed, and pick a branch to replay a different path. They can also be exported as self-playing SVGs that work anywhere an image works, including GitHub READMEs.

## Examples

**The following are some examples of the diagrams and features ene supports.**

### Flow

```
title Order request
user[User] -> api[API Server] : POST /order
api -> cache[Redis] : check stock
cache --> api : miss
api -> db[MySQL] : SELECT stock & api -> pay[Payment] : charge
db --> api : in stock
pay -x api : timeout
api --> user : 502 retry later
```

![Order request](demo/01-order.svg)

### Branches

```
title Cache hit / miss
client[Client] -> api[API] : GET /product/42
api -> redis[Redis] : GET product:42
branch cache hit
  redis --> api : product
else cache miss
  redis --> api : nil
  api -> db[MySQL] : SELECT
  db --> api : product
  api -> redis : SET product:42
end
api --> client : 200
```

![Cache hit / miss](demo/03-cache.svg)

### Waits and retries

```
title Payment retry
order[Order Service] -> pg[Payment Gateway] : authorize
pg -x order : timeout
wait 1
order -> pg : authorize (retry 1)
pg -x order : 503
wait 2
order -> pg : authorize (retry 2)
pg --> order : approved
order -> ledger[Ledger] : record payment
```

![Payment retry](demo/07-payment-retry.svg)

### Groups, shapes and icons

```
title Order service in a VPC
user[User]{icon: logos:chrome, shape: circle} -> alb[ALB]{icon: logos:aws-elb} : HTTPS
alb -> api[Order API]{icon: logos:aws-ec2} : /orders
api -> cache[Redis]{icon: logos:redis, shape: db} : check stock
cache --> api : hit
api -> db[Orders DB]{icon: logos:aws-rds, shape: db, color: #f59e0b} : INSERT
db --> api : OK
api -> q[SQS]{icon: logos:aws-sqs, shape: queue} : order.created
q -> worker[Worker]{icon: logos:aws-lambda} : consume
worker -> mail[SES]{icon: logos:aws-ses} : confirmation email
api --> user : 201
group vpc[VPC 10.0.0.0/16]{color: #8b5cf6} : alb api cache db worker
group pub[Public subnet]{color: #22c55e} in vpc : alb
group priv[Private subnet]{color: #3b82f6} in vpc : api cache db worker
```

![Order service in a VPC](demo/13-vpc.svg)

### Sequence diagram

```
diagram sequence
title Checkout sequence
user[User] -> api[Order API] : POST /checkout
api -> redis[Redis]{shape: db} : check stock
branch in stock
  redis --> api : OK
  api -> pg[Payment Provider] : authorize
  pg --> api : approved
  api --> user : 201
else sold out
  redis -x api : sold out
  api --> user : 409
end
```

![Checkout sequence](demo/14-sequence-checkout.svg)

More examples in [`packages/core/examples`](packages/core/examples).

## Usage

### In a web page

```html
<pre class="ene">
user -> api : GET /
api --> user : 200
</pre>

<script src="ene.js"></script>
```

Every `<pre class="ene">` on the page becomes a player. Click it and use <kbd>Space</kbd> to play or pause, <kbd>←</kbd> <kbd>→</kbd> to step.

### As an image

```bash
ene flow.ene -o flow.svg
```

The SVG loops on its own — no script needed — and respects dark mode and reduced motion.

### Icon loading and network access

An icon is either a pack name (`logos:redis`, from packs you register) or an SVG address: `http(s)://…`, `./`, `../`, `/` or `data:image/svg+xml,…`.

- Remote icons are fetched with a 5 s timeout and a 512 KiB size limit (checked while streaming); the response must be an SVG document.
- The CLI reads relative paths from the `.ene` file's folder (same size limit). `--no-network` disables all remote fetches; `--allow-host <host>` (repeatable) fetches only from listed hosts and refuses redirects. Use both when rendering untrusted input on a server.
- In the browser, `ene.setIconLoading({ timeoutMs, maxBytes, allowHosts })` sets the same limits.
- Icon packs are validated (`prefix`, `icons.*.body`, numeric sizes) before use, and pack bodies are rendered as isolated images.
- A failed icon never fails the render: the node is drawn without an icon and a warning with the reason is printed (CLI stderr / browser console).

## Syntax

| Syntax | Meaning |
|---|---|
| `a -> b : label` | request |
| `a --> b : label` | response (dashed) |
| `a -x b : label` | failure |
| `a -> b & a -> c` | at the same time |
| `a -> b : label @2s` | this edge takes 2 seconds |
| `wait 0.5` | pause before the next step |
| `branch …` / `else …` / `end` | alternative paths, chosen in the player |
| `loop 3` … `end` | repeat |
| `group vpc[VPC] : a b` | container box |
| `id[Label]{icon: …, shape: db, color: #f59e0b}` | node label and style |
| `diagram sequence` | draw as a sequence diagram |

One line is one step, played top to bottom.

## Release

ene has not been released yet.

## Related projects

- [Mermaid](https://github.com/mermaid-js/mermaid) — text-to-diagram for many diagram types
- [D2](https://github.com/terrastruct/d2) — a modern diagram scripting language
- [Iconify](https://iconify.design) — icon packs that ene can use

## Contributors

Contributions will be welcome once the project is public.

## Security

Icons loaded from SVG files or URLs are embedded as images, so scripts inside them never run. Labels are always escaped.
