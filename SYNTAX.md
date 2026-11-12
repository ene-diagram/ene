# ene syntax reference

ene turns text into an animated data-flow diagram. One line is one step, played top to bottom.
This file is the complete syntax in one page (also served as `llms.txt`). Every ```` ```ene ```` block below parses
without errors, and every "mistake" block produces the code shown — both are checked by `packages/core/test/syntax-doc.test.ts`.

## Lines

| Construct | Meaning |
|---|---|
| `# comment` | comment at line start or after a space. `#` inside `[...]`, `{...}`, after the first `:`, or in `title` is literal |
| indentation | ignored (use it for readability inside blocks) |
| empty line | ignored |

## Nodes

| Construct | Meaning |
|---|---|
| `api` | node id: letters, digits, `_`, `-` (any script, e.g. `주문`) |
| `api[Order API]` | label shown on the node (declare once, then use the id) |
| `db{shape: db}` | shape: `box` (default), `round`, `db`, `queue`, `circle` |
| `api{color: #f59e0b}` | color: `#rgb`, `#rrggbb`, `#rrggbbaa` or a CSS color name |
| `api{icon: logos:redis}` | icon from a registered pack (`prefix:name`) or an SVG address (`https://…`, `./x.svg`, `data:image/svg+xml,…`) |
| `api[API]{icon: logos:nodejs, shape: round}` | label and attributes together; attributes are comma-separated |

```ene
user[User]{shape: circle} -> api[Order API]{icon: logos:nodejs, color: #3e63dd} : POST /order
api -> db[Orders DB]{shape: db} : INSERT
```

## Edges (one step)

| Construct | Meaning |
|---|---|
| `a -> b` | request |
| `a --> b` | response (dashed) |
| `a -x b` | failure (ends with ✕) |
| `a -> b : label` | label after the first `:` (may contain `#`, `:`, spaces) |
| `a -> b : label @2s` | this edge takes 2 seconds (`@0.5s` …), written last |
| `a -> b & a -> c` | edges on one line play at the same time; `&` needs spaces around it |
| `& a -> d` | a line starting with `& ` adds to the previous step |

```ene
user -> api : GET /items #1
api -> cache : lookup & api -> db : SELECT @2s
& api -> log : audit
cache --> api : hit
db -x api : timeout
```

## Document settings

| Construct | Meaning |
|---|---|
| `title Order flow` | title shown above the diagram |
| `speed 1.2` | default seconds per step (default `1.2`, must be > 0) |
| `diagram flow` | layout: `flow` (default) or `sequence` |

```ene
title Checkout
diagram sequence
speed 0.8
user -> api : POST /checkout
api --> user : 201
```

## Timing and blocks

| Construct | Meaning |
|---|---|
| `wait 0.5` | pause (seconds, ≥ 0) before the next step |
| `loop 3` … `end` | repeat the enclosed steps (whole number ≥ 1) |
| `branch label` … `else label` … `end` | alternative paths; the player shows a menu, SVG export uses `--choice` |

Blocks nest (up to 32 levels). Every arm needs at least one step.

```ene
api -> cache : get
branch hit
  cache --> api : value
else miss
  cache --> api : miss
  loop 2
    api -> db : retry
    wait 0.3
  end
  db --> api : rows
end
api --> user : 200
```

## Layout hints and groups

| Construct | Meaning |
|---|---|
| `pin db 3,1` | place a node at column,row (from 0) in flow layout |
| `rank api worker` | align nodes in the same column |
| `group vpc[VPC]{color: #8b5cf6} : alb api` | box around nodes; members are ids separated by spaces |
| `group pub[Public] in vpc : alb` | nested group: members must belong to the parent |

```ene
user -> alb
alb -> api & api -> db
group vpc[VPC] : alb api db
group priv[Private] in vpc : api db
pin db 3,1
rank api db
```

## Common mistakes

Each block is a wrong input and the diagnostic code it produces.

Arrow with nothing after it:

```ene E103
a ->
```

`-x` glued to the id (ids may contain `-`, so `a-x` is one id):

```ene E102
a-x b
```

Chained arrows — one edge per `->`; write `a -> b & b -> c` or two lines:

```ene E102
a -> b -> c
```

Spaces or punctuation in an id — put text in a label instead (`order_api[Order API]`):

```ene E107
order.api -> db
```

Unclosed label bracket:

```ene E105
api[Order API -> db
```

`&` without an edge on one side:

```ene E106
a -> b &
```

Unknown attribute (only `icon`, `shape`, `color`):

```ene E108
a{size: 3} -> b
```

Unknown shape:

```ene E110
a{shape: hexagon} -> b
```

Duration without `s`:

```ene E303
a -> b : slow @2
```

Loop count that is not a whole number:

```ene E302
loop 1.5
  a -> b
end
```

Block left open:

```ene E203
branch ok
  a -> b
```

`end` with nothing to close:

```ene E204
a -> b
end
```

Branch arm with no steps:

```ene E201
branch hit
else miss
  a -> b
end
```

Node used in `pin`/`group` but never in an edge (typo):

```ene E401
api -> cache
pin cahce 1,0
```

A file with no edges:

```ene E101
title Empty
```
