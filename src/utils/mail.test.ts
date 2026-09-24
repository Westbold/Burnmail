import { expect, test } from "bun:test";
import { processEmailContent } from "./mail";

test("plain-text mail is escaped in its generated HTML alternative", () => {
	const text = '<img src="https://example.test/pixel"> & <b>not markup</b>';
	const result = processEmailContent(null, text);
	expect(result.textContent).toBe(text);
	expect(result.htmlContent).toContain("&lt;img");
	expect(result.htmlContent).toContain("&amp;");
	expect(result.htmlContent).not.toContain("<img");
});

test("HTML layouts and text alternatives remain available", () => {
	const html = '<table><tr><td style="color: red">Hello</td></tr></table>';
	const result = processEmailContent(html, "Hello");
	expect(result.htmlContent).toBe(html);
	expect(result.textContent).toBe("Hello");
});
