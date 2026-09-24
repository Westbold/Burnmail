from pathlib import Path
path = Path('tests/browser/webmail.mjs')
text = path.read_text()
old = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X0AAAAASUVORK5CYII='
new = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQiNoCAAHkATfgdGTkAAAAAElFTkSuQmCC'
assert old in text
text = text.replace(old, new)
old = '      assert.equal(await frame.locator("#data-image").evaluate(e => e.complete && e.naturalWidth > 0), true);'
assert old in text
text = text.replace(old, '      await frame.locator("#data-image").evaluate(e => e.decode());\n' + old)
old = '      assert.equal(state.putCount, 0, "URL login must never create a claim");'
assert old in text
text = text.replace(old, old + '''
      await page.locator("#close").click();
      assert.equal(state.exists, true, "closing must not release the claim");
      assert.equal(state.deleteCount, 0);
      await page.goto(link.href);
      await page.locator("#mailbox").waitFor({ state: "visible" });''')
path.write_text(text)
Path('.github/fix-image-fixture.py').unlink()
