from pathlib import Path

def replace(name, before, after):
    p = Path(name)
    text = p.read_text()
    assert before in text, name
    p.write_text(text.replace(before, after))

replace('tests/browser/remembered.mjs',
    'res.writeHead(200, { "Content-Type": type }); res.end(await readFile(file));',
    'const data = await readFile(file);\n    res.writeHead(200, { "Content-Type": type }); res.end(data);')
replace('tests/browser/remembered.mjs',
    'await page.waitForFunction(email => !document.querySelector("#mailbox").hidden && document.querySelector("#mailbox-address").textContent === email && !document.querySelector("#new-mailbox").disabled, email);',
    '''try {
    await page.waitForFunction(email => !document.querySelector("#mailbox").hidden && document.querySelector("#mailbox-address").textContent === email && !document.querySelector("#new-mailbox").disabled, email);
  } catch (error) {
    console.error("Fixture login did not complete", await page.evaluate(() => ({ status: document.querySelector("#status").textContent, warning: document.querySelector("#storage-warning").textContent, loginVisible: !document.querySelector("#login").hidden, busy: document.querySelector("#new-mailbox").disabled })), { requestCount: calls.length });
    throw error;
  }''')
replace('public/app/app.js',
    '    remembered = records;\n    renderRemembered();',
    '''    // Focusing a window must not replace buttons between pointerdown and click.
    const changed = records.length !== remembered.length || records.some((record, index) =>
      record.email !== remembered[index]?.email || record.lastUsedAt !== remembered[index]?.lastUsedAt);
    remembered = records;
    if (changed) renderRemembered();''')
replace('public/app/app.js',
    'Closed. The mailbox is still remembered on this device; its claim and messages were not deleted.',
    'Closed. Any saved device entry was kept; the mailbox claim and messages were not deleted.')
replace('documentation/03_apispec.md',
    'The original key is never stored.',
    'The original key is never stored by the Worker. The webmail client remembers access keys only in device-local IndexedDB.')
p = Path('CLAUDE.md')
p.write_text(p.read_text() + '\nRemembered mailbox credentials belong only in browser IndexedDB, never a server sync store.\nDo not validate or auto-login remembered entries on page load. Preserve new mailbox creation,\nlocal-only Forget, strict write durability, persistence permission requests, and visible save errors.\nRun the browser profile persistence tests alongside the HTML/deletion regression tests.\n')
replace('scripts/webmail-smoke.ts',
    'check(html.includes(\'href="/api-docs"\'), "docs link");',
    'check(html.includes(\'href="/api-docs"\'), "docs link");\n\tcheck(html.includes(\'id="remembered-list"\'), "remembered mailbox selector");\n\tcheck(html.includes(\'id="new-mailbox"\'), "new mailbox action");')
replace('scripts/webmail-smoke.ts',
    '"/app/api.js",', '"/app/api.js",\n\t\t"/app/mailbox-store.js",')
Path(__file__).unlink()
