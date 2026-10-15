# Phase 2 sample: every supported syntax

This document exercises everything the rendered view supports (O2). Open it in MDNote and compare the preview with each section's description.

## 1. Text

Plain text, **bold**, *italic*, ***both***, ~~strikethrough~~, `inline code`, <u>underline (HTML)</u>, and a hard line break after this backslash:\
this text starts a new line.

한글 문단입니다. 줄 바꿈과 **굵게**, *기울임*, `코드`가 모두 올바르게 보여야 합니다.

## 2. Lists

- Bulleted item
- Another item
  - Nested item
    - Deeper item
1. Numbered item
2. Second item
   1. Nested numbered item

Task list:

- [x] Done item
- [ ] Open item

A loose list, with blank lines between items:

- First

- Second

## 3. Quotes and rules

> A quote with **formatting**.
>
> > A nested quote.

---

## 4. Code

```ts
// TypeScript is highlighted.
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

```python
def area(r: float) -> float:
    return 3.14159 * r ** 2  # Python too
```

```rust
fn main() {
    println!("한글도 코드 안에서 보입니다");
}
```

```nosuchlanguage
Unknown languages stay plain.
```

## 5. Tables

| Left | Center | Right |
|:-----|:------:|------:|
| 제목 | 가운데 | 123 |
| A longer cell | ✓ | 4.5 |

## 6. Links and images

- Web link: [Tauri](https://tauri.app) (opens in the browser)
- Autolink: https://github.com/OilyHand/MDNote
- Heading link: [jump to Math](#7-math)
- Note link: [the Phase 1 checklist](phase-1.md) (opens in MDNote)
- Reference link: [MDNote on GitHub][repo]

![A sample image, loaded from the assets folder](assets/sample%20image.png)

[repo]: https://github.com/OilyHand/MDNote

## 7. Math

Inline math: $E = mc^2$ and $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}
$$

## 8. Footnotes

Footnotes are numbered across the whole document.[^first] Here is another one.[^second]

[^first]: The first footnote.
[^second]: The second footnote, with `code`.

## 9. Page break

Below is a page break (a dashed line on screen, a new page when printed):

<!-- pagebreak -->

## 10. HTML safety

This script must not run, and the image's `onerror` must be removed:

<script>alert("this must never appear")</script>

<img src="assets/sample%20image.png" onerror="alert('removed')" width="120">

<details>
<summary>Click to expand</summary>

Hidden content, shown when expanded.

</details>
