# ene

텍스트로 데이터 흐름을 쓰면, 데이터가 경로를 따라 **실제로 움직이는** 다이어그램을 그려 줍니다.

![주문 흐름](demo/01-order.svg)

![서버리스 (아이콘)](demo/11-serverless.svg)

```
title 주문 요청 흐름
user[사용자] -> api[API 서버] : POST /order
api -> cache[Redis] : 재고 조회
cache --> api : miss
api -> db[MySQL] : SELECT stock & api -> pay[결제 서버] : 결제 요청
db --> api : 재고 OK
pay -x api : timeout
api --> user : 502 다시 시도
```
