import { scan } from "../src/scan";
test("strips comment only at start or after space", () => {
  const [a, b] = scan("a -> b : issue#12\nc -> d # note");
  expect(a.text).toBe("a -> b : issue#12");
  expect(b.text).toBe("c -> d");
});
test("normalizes CRLF and keeps columns with tabs", () => {
  const [l] = scan("\r\n\tapi -> db\r\n");
  expect(l.no).toBe(2); expect(l.text).toBe("api -> db"); expect(l.cols[0]).toBe(2);
});
test("columns count code points", () => {
  const [l] = scan("😀 -> 서버");
  expect(l.cols[2]).toBe(3);
});
test("skips blank and comment-only lines", () => expect(scan("# x\n\n   # y")).toEqual([]));
test("# inside an edge label is text, not a comment", () =>
  expect(scan("a -> b : issue #5")[0].text).toBe("a -> b : issue #5"));
test("# inside a node label bracket is text", () =>
  expect(scan("a[issue #5] -> b # note")[0].text).toBe("a[issue #5] -> b"));
test("# in title text is kept", () => expect(scan("title 이슈 #5")[0].text).toBe("title 이슈 #5"));
test("UTF-8 BOM does not shift columns", () => expect(scan("﻿a -> b")[0].cols[0]).toBe(1));
