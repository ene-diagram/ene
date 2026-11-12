<h1 align="center">ene</h1>

<p align="center">
글로 쓰면, 데이터가 움직입니다.
</p>

<p align="center">
<a href="./README.md">English</a>
</p>

---

## 목차

- [소개](#소개)
- [예제](#예제)
- [사용법](#사용법)
- [문법](#문법)
- [릴리스](#릴리스)
- [관련 프로젝트](#관련-프로젝트)
- [기여](#기여)
- [보안](#보안)

## 소개

아키텍처 다이어그램은 **무엇이 연결돼 있는지**는 보여 주지만, **무슨 일이 일어나는지**는 잘 보여 주지 못합니다. 어떤 요청이 먼저 가는지, 어디서 기다리고 어디서 실패하는지, 캐시를 놓치면 어느 길로 가는지 같은 것들입니다.

ene 는 몇 줄의 텍스트를, 데이터가 화살표를 따라 실제로 이동하는 다이어그램으로 바꿉니다. 다이어그램에는 플레이어가 함께 나옵니다. 재생, 정지, 한 단계씩 넘기기, 속도 조절이 되고, 갈림길을 골라 다른 경로를 다시 재생할 수 있습니다. 스스로 재생되는 SVG 로 내보내면 GitHub README 처럼 이미지가 들어가는 곳 어디에나 붙일 수 있습니다.

## 예제

**ene 가 지원하는 다이어그램과 기능의 예입니다.**

### 흐름

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

### 갈림길

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

### 대기와 재시도

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

### 그룹, 모양, 아이콘

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

### 시퀀스 다이어그램

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

더 많은 예제는 [`packages/core/examples`](packages/core/examples) 에 있습니다.

## 사용법

### 웹 페이지에서

```html
<pre class="ene">
user -> api : GET /
api --> user : 200
</pre>

<script src="ene.js"></script>
```

페이지의 모든 `<pre class="ene">` 가 플레이어로 바뀝니다. 클릭한 뒤 <kbd>Space</kbd> 로 재생·정지, <kbd>←</kbd> <kbd>→</kbd> 로 한 단계씩 움직입니다.

### 이미지로

```bash
ene flow.ene -o flow.svg
```

만들어진 SVG 는 스크립트 없이 스스로 반복 재생되고, 다크 모드와 모션 줄이기 설정을 따릅니다.

## 문법

| 문법 | 뜻 |
|---|---|
| `a -> b : 라벨` | 요청 |
| `a --> b : 라벨` | 응답 (점선) |
| `a -x b : 라벨` | 실패 |
| `a -> b & a -> c` | 동시에 |
| `a -> b : 라벨 @2s` | 이 엣지는 2초 동안 |
| `wait 0.5` | 다음 단계 전에 쉬기 |
| `branch …` / `else …` / `end` | 갈림길 (플레이어에서 선택) |
| `loop 3` … `end` | 반복 |
| `group vpc[VPC] : a b` | 묶음 상자 |
| `id[라벨]{icon: …, shape: db, color: #f59e0b}` | 노드 라벨과 모양 |
| `diagram sequence` | 시퀀스 다이어그램으로 그리기 |

한 줄이 한 단계이고, 위에서 아래로 재생됩니다. 흔한 실수까지 담은 전체 문법은 [SYNTAX.md](SYNTAX.md) 에 있어요(AI 도구용 `llms.txt` 와 같은 내용이에요).

## 릴리스

아직 공개되지 않았습니다.

## 관련 프로젝트

- [Mermaid](https://github.com/mermaid-js/mermaid) — 여러 종류의 다이어그램을 텍스트로
- [D2](https://github.com/terrastruct/d2) — 현대적인 다이어그램 스크립트 언어
- [Iconify](https://iconify.design) — ene 에서 쓸 수 있는 아이콘 팩

## 기여

공개 후에 기여를 받을 예정입니다.

## 보안

SVG 파일이나 URL 에서 불러온 아이콘은 이미지로 넣기 때문에 그 안의 스크립트는 실행되지 않습니다. 라벨은 항상 이스케이프됩니다.
