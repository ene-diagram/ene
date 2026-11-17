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
- [시작하기](#시작하기)
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

## 시작하기

**필요한 것:** Node.js 22 이상.

```bash
npm install -g @ene-diagram/cli

printf 'user -> api : GET /\napi --> user : 200\n' > flow.ene
ene flow.ene -o flow.svg
```

설치 없이 한 번만 돌리려면 `npx @ene-diagram/cli flow.ene -o flow.svg` 를 써요.

### 소스에서

pnpm 10 도 필요해요(`corepack enable` 을 켜면 `package.json` 에 고정된 버전을 써요).

```bash
git clone https://github.com/ene-diagram/ene.git
cd ene
pnpm install
pnpm build          # 모든 패키지와 브라우저 번들을 빌드해요

printf 'user -> api : GET /\napi --> user : 200\n' > flow.ene
node packages/cli/bin/ene.mjs flow.ene -o flow.svg
```

`ene` 명령으로 쓰려면 별칭을 만들어 두세요: `alias ene="node $PWD/packages/cli/bin/ene.mjs"`.

`pnpm test`·`pnpm typecheck` 로 검사하고, `pnpm demo` 는 `demo/`·`site/` 를 다시 만들어요.

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
cat flow.ene | ene - > flow.svg   # "-" 는 stdin 에서 읽고, 결과는 stdout 으로
ene flow.ene -o flow.svg --no-notes   # `note` 자막 빼기
ene flow.ene -o -                # SVG 를 stdout 으로
```

움직이는 SVG 를 재생하지 못하는 곳(Slack, Notion, 발표 자료, SNS)에는 GIF 나 MP4 로 내보내요. 형식은 확장자로 정해요:

```bash
ene flow.ene -o flow.gif                       # 20 fps
ene flow.ene -o flow.mp4 --choice 1            # 30 fps, 2배 해상도
ene flow.ene -o flow.gif --fps 12 --scale 2    # 더 작은 파일 / 더 선명한 프레임
```

헤드리스 Chrome 에서 SVG 를 한 바퀴 재생하며 프레임을 찍고 ffmpeg 로 인코딩해요. 그래서 둘 다 설치돼 있어야 해요(Chrome·Chromium·Edge 중 하나, `brew install ffmpeg`). `ENE_CHROME`, `ENE_FFMPEG` 로 실행 파일을 직접 지정할 수 있어요. Node.js 22 이상과 `@ene-diagram/video` 패키지가 필요하고, 이 패키지는 SVG 만 쓰는 설치를 가볍게 유지하려고 선택 사항으로 뒀어요.

렌더링 없이 검사만 하려면 `check` 를 써요(오류가 있으면 종료 코드 1). `--json` 은 도구·AI 에이전트용으로 진단을 JSON 으로 출력해요:

```bash
ene check flow.ene --json
# [{"code":"E401","severity":"error","line":3,"col":5,"length":5,"message":"unknown node \"cahce\"","hint":"did you mean \"cache\"?","suggestion":"cache"}]
```

소스를 표준 형식으로 정리해요(주석은 그대로 두고, 의미가 바뀔 수 있는 줄은 건드리지 않아요):

```bash
ene fmt flow.ene            # 출력
ene fmt --write *.ene       # 파일에 덮어쓰기
ene fmt --check *.ene       # 정리 안 된 파일이 있으면 종료 코드 1 (CI 용)
```

만들어진 SVG 는 스크립트 없이 스스로 반복 재생되고, 다크 모드와 모션 줄이기 설정을 따릅니다.

### 블로그에서

**스크립트를 넣을 수 있는 곳** (직접 만든 사이트, 티스토리 스킨, 설치형 워드프레스): CDN 에서 플레이어를 불러옵니다. 메이저 버전을 고정해 두었으니 호환이 깨지지 않는 수정만 받습니다.

```html
<script src="https://cdn.jsdelivr.net/npm/@ene-diagram/player@0.1/dist/ene.js"></script>
<pre class="ene">
user -> api : POST /order
api --> user : 201
</pre>
```

`https://unpkg.com/@ene-diagram/player@0.1/dist/ene.js` 도 똑같이 씁니다. `ene.js`(약 64 KB)는 흐름 다이어그램을 처음 그릴 때 같은 폴더의 `ene-elk.js`(약 1.6 MB)를 불러옵니다. `diagram sequence` 다이어그램만 있는 페이지는 이 파일을 받지 않습니다.

**마크다운만 되는 곳** (스크립트 불가): 이미지를 올립니다. SVG 애니메이션이 살아 있는 곳이면 SVG(`ene flow.ene -o flow.svg`), 아니면 GIF(`-o flow.gif`)를 씁니다.

| 플랫폼 | 방법 | 상태 |
|---|---|---|
| 직접 만든 사이트 (Astro, Next, Hugo, Jekyll) | 레이아웃에 CDN 스크립트 | 스크립트는 어느 HTML 페이지에서나 동작, 프레임워크 플러그인은 #52 |
| 티스토리(스킨 HTML), 설치형 워드프레스 | CDN 스크립트 | 확인 전 |
| velog, Medium, dev.to, 브런치 | GIF 업로드, SVG 업로드 가능 여부 모름 | 확인 전 |
| iframe 을 받는 곳 | 플레이그라운드 임베드 화면 (#47) | 아직 없음 |

"확인 전"은 그 플랫폼에서 아직 직접 확인하지 않은 항목입니다. 확인해 주시면 반영합니다.

### Mermaid 에서

이미 Mermaid `sequenceDiagram`·`flowchart`·`graph` 가 있다면 변환하거나 바로 그릴 수 있어요:

```bash
ene from-mermaid diagram.mmd > diagram.ene   # 고칠 수 있는 .ene 소스
ene from-mermaid README.md -o flow.ene       # 마크다운 파일에서 변환할 수 있는 첫 ```mermaid 블록을 읽어요
ene diagram.mmd -o diagram.svg               # 변환과 렌더링을 한 번에
```

메시지, 참여자, `alt`/`else`, `opt`(`break` 도 `opt` 로), `loop`, `par`, 비동기 화살표 `-)`(`~>` 로) 를 변환해요. `Note` 는 바로 위 메시지의 `note` 가 되고(위에 메시지가 없으면 주석), 대응하는 문법이 없는 것(활성화 막대, `rect`, `box`, 링크)은 빠져요. 그때마다 줄 번호와 함께 경고를 보여줘요. Mermaid 의 `loop` 에는 횟수가 없어서, 라벨에 숫자가 없으면 `loop 2` 가 돼요.

`flowchart`·`graph` 는 흐름 다이어그램이 돼요. 노드는 라벨과 ene 에 있는 모양을 그대로 써요(`(( ))` 원, `( )`·`([ ])` 둥근 상자, `[( )]` db, 나머지는 경고와 함께 상자). 연결선은 소스 순서대로 하나씩 단계가 되고(`|라벨|`·`-- 라벨 -->` 는 라벨로, 점선은 `-->` 로, `--x` 는 `-x` 로), `subgraph` 는 `group` 이 돼요(안쪽 subgraph 는 `in`). 스타일·클래스·클릭 핸들러·subgraph 로 가는 연결선은 경고와 함께 빠져요. 플로차트에는 시간 축이 없어서, 결과 맨 위에 단계 순서를 확인하라는 주석을 달아요.

### Claude 와 함께

저장소에 Claude 스킬(`skills/ene`)이 들어 있어요. 설명이나 코드를 보고 `.ene` 파일을 쓰고, `ene check --json` 이 깨끗해질 때까지 고친 뒤, 정리하고 SVG 로 그려요.

```bash
pnpm build
pnpm skill:install                      # ~/.claude/skills/ene 에 연결해요
pnpm skill:install path/to/project/.claude/skills   # 또는 프로젝트 하나에만
```

그다음 Claude Code 에 "결제 흐름을 ene 다이어그램으로 그려줘" 처럼 요청하세요.

### 브라우저용 파일

`pnpm build` 는 `packages/player/dist/` 에 파일 두 개를 만들어요. 둘 다 같은 폴더에 배포하세요:

| 파일 | 내용 |
|---|---|
| `ene.js` | 플레이어(약 50 KB) |
| `ene-elk.js` | ELK 레이아웃 엔진. 흐름 다이어그램을 처음 그릴 때 불러와요 |

`ene.js` 는 자기와 같은 폴더에서 `ene-elk.js` 를 찾아요. 다른 곳에 두려면 스크립트보다 먼저 주소를 지정하세요:

```html
<script>window.eneConfig = { elkUrl: "/assets/ene-elk.js", lang: "ko" }</script>
<script src="/assets/ene.js"></script>
```

`eneConfig` 에 `startOnLoad: false` 를 주면 `pre.ene` 자동 변환을 끄고 직접 그릴 수 있어요:

```js
const player = await ene.render(element, source, {
  autoplay: false, loop: true,
  choices: [1],                                  // 첫 번째 branch 의 1번 갈래로 시작
  onChoicesChange: (c) => console.log(c),        // 보는 사람이 다른 갈래를 골랐을 때
});
player.setChoices([0]);   // 첫 번째 branch 의 0번 갈래 선택
player.choices;           // [0]
player.toSvg();           // 지금 고른 갈래로 혼자 재생되는 SVG (`ene -o x.svg` 결과와 같아요)
player.toSvg({ paths: "all" });   // 모든 경로를 차례로 (`--choice all` 과 같아요)
player.destroy();         // 재생을 멈추고 요소를 비워요
```

소스에 오류가 있으면 `render()` 는 `undefined` 를 돌려주고 오류 상자를 보여줘요.

**포커스.** 큰 다이어그램에서는 움직이는 점을 놓치기 쉬워서, 플레이어가 지금 재생 중인 단계에 속하지 않은 노드와 엣지를 흐리게 보여줘요(위치나 크기는 그대로예요). 마지막 단계가 끝나면 전체가 다시 또렷해져요. `focus: "auto"`(기본)는 노드가 12개 이상일 때 켜지고, `focus: true` / `false` 로 강제할 수 있어요. 페이지 전체는 `eneConfig.focus`, 다이어그램 하나는 `<pre class="ene" data-focus="on">`(`on`, `off`, `auto`)으로 정해요. `prefers-reduced-motion` 이면 서서히 바뀌는 효과 없이 바로 바뀌어요. 내보낸 SVG 에는 적용되지 않아요.

### 브라우저에서 GIF 와 MP4 만들기

`pnpm build` 는 `packages/export/dist/ene-export.js`(약 12 KB, 의존성 없음)도 만들어요. 서버나 Chrome, ffmpeg 없이 SVG 를 GIF, MP4, WebM 으로 바꿔요:

```html
<script src="ene-export.js"></script>
<script>
  const { blob } = await eneExport.exportVideo(player.toSvg(), { format: "gif", fps: 15, scale: 1, theme: "light" });
</script>
```

- `format`: `gif`(내장 인코더), `mp4`(브라우저에 WebCodecs H.264 가 있을 때), `webm`(MediaRecorder. 실시간으로 녹화하므로 애니메이션 길이만큼 걸려요). 어떤 영상 형식이 되는지는 `eneExport.videoSupport()` 로 확인해요.
- `theme`: `light`(기본), `dark`, `auto`(보는 사람 설정을 따름). 내려받을 SVG 에는 `eneExport.themedSvg(svg, theme)` 로 같은 처리를 해요.
- 프레임은 재생 중인 화면을 녹화하지 않고 SVG 의 애니메이션 값으로 계산해서, GIF 와 MP4 가 SVG 와 똑같이 움직여요. 한도: 1800 프레임, 60 fps(GIF 는 50), scale 4.

### 아이콘 팩

렌더링 전에 [Iconify](https://iconify.design) JSON 팩을 등록하세요. `loader` 는 팩의 아이콘이 처음 필요할 때 한 번만 실행돼요:

```js
ene.registerIconPacks([
  { name: "logos", loader: () => fetch("/icons/logos.json").then((r) => r.json()) },
]);
```

CLI 에서는 `--icons pack.json`(여러 번 가능)을 써요. `ene icons <svg-폴더> --prefix aws -o aws.json` 은 SVG 폴더로 팩을 만들어요.

### 플레이어와 SVG 의 갈림길

플레이어는 `branch` 마다 메뉴를 보여줘서 다른 경로를 다시 재생할 수 있어요. 내보낸 SVG 에는 컨트롤이 없어서 한 경로만 재생해요. 경로는 `--choice` 로 골라요(`branch`·`opt` 순서대로 0부터 센 갈래 번호, `opt` 는 `0` = 실행·`1` = 건너뜀, 기본값은 모두 `0`):

```bash
ene flow.ene -o miss.svg --choice 1
```

`--choice all` 은 모든 경로를 한 파일에 담아요. 경로가 차례로 재생되고, 다이어그램 아래 한 줄이 지금 어느 경로인지 알려 줘요(`2/3 · cache miss`). SVG, GIF, MP4 모두 돼요. 선택되지 않은 갈래 안의 `branch` 는 경로 수를 늘리지 않고, 경로가 16개를 넘으면 오류예요. `prefers-reduced-motion` 에서는 첫 번째 경로만 보여요.

```bash
ene flow.ene -o flow.svg --choice all
```

내보낸 SVG 는 스크립트 없이 SMIL 애니메이션으로 움직여요. 반복 재생하고, 다크 모드를 따르고, `prefers-reduced-motion` 에서는 움직이는 점 없이 모든 단계를 한 번에 보여줘요. SVG 를 정화(sanitize)하는 일부 호스트에서는 애니메이션이 빠질 수 있어요.

### 다이어그램끼리 선언 나눠 쓰기

시스템의 노드를 한 파일에 적어 두고, 흐름마다 `include` 로 가져와요:

```
# system.ene — 선언만
user[User]{shape: circle}
api[Order API]{icon: logos:nodejs}
db[Orders DB]{shape: db}
group vpc[VPC] : api db
```

```
# checkout.ene
include ./system.ene
user -> api : POST /checkout
api -> db : INSERT
```

다이어그램이 실제로 쓴 노드만 그려지고, 그룹도 그 노드만 남겨요. 경로는 `include` 줄이 있는 파일 기준이고 다이어그램 폴더 밖으로 나갈 수 없어요. 포함되는 파일에는 선언만 쓸 수 있어요(노드, `group`, `pin`, `rank`, `theme`, `speed`, 또 다른 `include`). CLI 와 VS Code 확장은 파일을 직접 읽고, `@ene-diagram/remark` 와 `ene.render` 는 `include` 함수를 받아요(Node 에서는 `@ene-diagram/core` 의 `createIncluder`). 브라우저의 `<pre class="ene">` 만으로는 파일을 포함할 수 없어요.

### 테마

소스에서는 `theme <이름>`, CLI 에서는 `--theme <이름>`(소스보다 우선), 브라우저에서는 `ene.render(el, src, { theme })` / `eneConfig.theme` / `<pre class="ene" data-theme="mono">` 로 정해요. 테마마다 밝은 변형과 어두운 변형이 있고 `prefers-color-scheme` 을 따라가요.

| 테마 | 용도 |
|---|---|
| `default` | 기본 모양 |
| `mono` | 회색만 써요. 인쇄와 문서용(실패는 ✕ 로 구분돼요) |
| `high-contrast` | 흑백 바탕에 대비 7:1 이상인 색 |

모든 색은 루트 `<svg class="ene ene-theme-<이름>">` 의 CSS 변수예요:

| 변수 | 쓰이는 곳 |
|---|---|
| `--bg` | 배경 |
| `--node` | 노드 채우기 |
| `--line` | 노드 테두리, 생명선 |
| `--faint` | 대기 중인 엣지 |
| `--fg` / `--fg2` | 노드 라벨과 제목 / 엣지 라벨 |
| `--ok` / `--fail` / `--reply` / `--async` | 요청, 실패, 응답, 비동기 강조선과 점 |

플레이어를 넣은 페이지에서는 어떤 선택자로든 덮어쓸 수 있어요(플레이어 규칙의 우선순위가 0 이에요). 내보낸 SVG 를 인라인으로 붙였다면 SVG 안의 규칙이 그냥 `svg` 라서 그보다 구체적인 선택자를 쓰세요. 아래는 두 경우 모두 돼요:

```css
:root svg.ene { --ok: #e11d48; --bg: transparent; }
```

`<img>` 로 불러온 SVG 는 페이지에서 꾸밀 수 없으니, 렌더할 때 테마를 고르세요.

### 아이콘 로딩과 네트워크 접근

아이콘은 팩 이름(등록한 팩의 `logos:redis`) 또는 SVG 주소(`http(s)://…`, `./`, `../`, `/`, `data:image/svg+xml,…`)예요.

- 원격 아이콘은 5초 타임아웃과 512 KiB 크기 제한(스트리밍 중 확인)으로 받아요. 응답은 SVG 문서여야 해요.
- CLI는 상대 경로를 `.ene` 파일 폴더 기준으로 읽어요(같은 크기 제한). `--no-network`는 원격 요청을 모두 막고, `--allow-host <host>`(여러 번 가능)는 목록에 있는 호스트에서만 받고 리다이렉트를 거부해요. 서버에서 신뢰할 수 없는 입력을 렌더링할 때는 둘 다 쓰세요.
- 브라우저에서는 `ene.setIconLoading({ timeoutMs, maxBytes, allowHosts })`로 같은 제한을 걸어요.
- 아이콘 팩은 쓰기 전에 구조(`prefix`, `icons.*.body`, 숫자 크기)를 검사하고, 팩 본문은 격리된 이미지로 그려요.
- 아이콘을 못 불러와도 렌더링은 실패하지 않아요. 아이콘 없이 노드를 그리고 이유를 담은 경고를 남겨요(CLI stderr / 브라우저 콘솔).

## 문법

| 문법 | 뜻 |
|---|---|
| `a -> b : 라벨` | 요청 |
| `a --> b : 라벨` | 응답 (점선) |
| `a -x b : 라벨` | 실패 |
| `a ~> b : 라벨` | 비동기 (보내고 기다리지 않음) |
| `a -> b & a -> c` | 동시에 |
| `a -> b : 라벨 @2s` | 이 엣지는 2초 동안 |
| `note 설명` | 바로 위 단계의 설명 자막 |
| `wait 0.5` | 다음 단계 전에 쉬기 |
| `branch …` / `else …` / `end` | 갈림길 (플레이어에서 선택) |
| `opt …` / `end` | 선택 단계 (플레이어에서 켜고 끄기) |
| `loop 3` … `end` | 반복 |
| `group vpc[VPC] : a b` | 묶음 상자 |
| `id[라벨]{icon: …, shape: db, color: #f59e0b}` | 노드 라벨과 모양 |
| `id[라벨]{…}` 만 있는 줄 | 엣지 없이 노드 선언 |
| `diagram sequence` | 시퀀스 다이어그램으로 그리기 |
| `theme mono` | 색 테마: `default`, `mono`, `high-contrast` |
| `include ./system.ene` | 다른 파일의 노드 선언·그룹·배치 힌트를 가져오기 |

한 줄이 한 단계이고, 위에서 아래로 재생됩니다. 흔한 실수까지 담은 전체 문법은 [SYNTAX.md](SYNTAX.md) 에 있어요(AI 도구용 `llms.txt` 와 같은 내용이에요).

## 릴리스

0.1.1 이 npm 의 [`@ene-diagram`](https://www.npmjs.com/org/ene-diagram) 스코프에 있어요: `@ene-diagram/cli`, `core`, `layout`, `svg`, `player`, 선택 사항인 `video`.

배포는 손으로 해요. CI 는 배포하지 않아요. `@ene-diagram/*` 패키지는 모두 같은 버전을 써요.

```sh
pnpm changeset version   # 쌓인 changeset 반영: 버전 올리고 CHANGELOG 작성
git commit -am "chore: release x.y.z"
pnpm release             # 빌드한 뒤 npm 에 아직 없는 버전을 모두 배포
```

`pnpm release` 는 패키지마다 브라우저에서 npm 2단계 인증을 요청해요.

## 관련 프로젝트

- [Mermaid](https://github.com/mermaid-js/mermaid) — 여러 종류의 다이어그램을 텍스트로
- [D2](https://github.com/terrastruct/d2) — 현대적인 다이어그램 스크립트 언어
- [Iconify](https://iconify.design) — ene 에서 쓸 수 있는 아이콘 팩

## 기여

공개 후에 기여를 받을 예정입니다.

## 보안

SVG 파일이나 URL 에서 불러온 아이콘은 이미지로 넣기 때문에 그 안의 스크립트는 실행되지 않습니다. 라벨은 항상 이스케이프됩니다.

## 라이선스

MIT © HelloWook. [LICENSE](LICENSE)를 보세요. ELK 레이아웃 번들(`ene-elk.js`)은 EPL-2.0이며 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 적혀 있어요.
