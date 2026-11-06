// node tests/run.js — the JavaScript of the overlay (Model.js, Views.js,
// Hotkey.js), loaded the way QML loads it, and checks of the QML that calls it.
const fs = require("fs")
const path = require("path")
const assert = require("assert")

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")

// A QML JavaScript library: its functions and top-level vars; ".import"
// lines are given the libraries already loaded.
function load(file, imports) {
  imports = imports || {}
  const src = read(file).replace(".pragma library", "").replace(/^\.import .*$/gm, "")
  const names = [...src.matchAll(/^(?:function|var) (\w+)/gm)].map(m => m[1])
  return new Function(...Object.keys(imports), src + "\nreturn {" + names.join(",") + "}")(...Object.values(imports))
}

const Model = load("Model.js")
const Hotkey = load("Hotkey.js")
const Views = load("Views.js", { Model })
let passed = 0
function test(name, fn) { fn(); passed++ }

const tabs = [
  { key: "a", id: 1, window: 1, index: 0, title: "GitHub - MaNi4/omarchy-browser-tab-search", url: "https://github.com/MaNi4/omarchy-browser-tab-search", lastAccessed: 10, active: false, focusedWindow: true },
  { key: "a", id: 2, window: 1, index: 1, title: "Café Menu | Example", url: "https://www.example.com/", lastAccessed: 30, active: true, focusedWindow: true },
  { key: "a", id: 3, window: 2, index: 0, title: "Settings", url: "brave://settings/", lastAccessed: 20, active: true, focusedWindow: false },
  { key: "a", id: 4, window: 2, index: 1, title: "Pull requests", url: "https://github.com/pulls", lastAccessed: 5, active: false, focusedWindow: false },
]
const ids = rows => rows.map(r => r.id)

test("no query lists the most recent first", () => assert.deepStrictEqual(ids(Model.rows(tabs, "")), [2, 3, 1, 4]))
test("the tab in front comes first even when the browser has not noted it yet", () => {
  const stale = tabs.map(t => Object.assign({}, t, { active: t.id === 1 }))
  const rows = Model.rows(stale, "")
  assert.deepStrictEqual(ids(rows), [1, 2, 3, 4])
  assert.strictEqual(rows[Model.firstIndex(rows, "")].id, 2)
})
test("no query starts on the tab before the current one", () => assert.strictEqual(Model.firstIndex(Model.rows(tabs, ""), ""), 1))
test("a query starts at the top", () => assert.strictEqual(Model.firstIndex(Model.rows(tabs, "git"), "git"), 0))
test("diacritics do not matter", () => assert.deepStrictEqual(ids(Model.rows(tabs, "cafe")), [2]))
test("every word must match", () => assert.deepStrictEqual(ids(Model.rows(tabs, "github pulls")), [4]))
test("title matches beat address matches", () => assert.deepStrictEqual(ids(Model.rows(tabs, "github")), [1, 4]))
test("the site matches", () => assert.deepStrictEqual(ids(Model.rows(tabs, "example.com")), [2]))
test("letters in order find a typo", () => assert.deepStrictEqual(ids(Model.rows(tabs, "sttngs")), [3]))
test("nothing matches", () => assert.deepStrictEqual(ids(Model.rows(tabs, "zzzz")), []))
test("place shows the site without www", () => assert.strictEqual(Model.place("https://www.example.com/x?y"), "example.com"))
test("place shows other addresses whole", () => assert.strictEqual(Model.place("brave://settings/"), "brave://settings/"))
test("badges name the window when there are several", () => assert.deepStrictEqual(Model.badges(tabs[2], 1, 2), ["Window 2"]))
test("no badges for one window of one browser", () => assert.deepStrictEqual(Model.badges(tabs[2], 1, 1), []))

const closed = [
  { key: "a", sessionId: "s1", title: "Old news", url: "https://news.example/", tabs: 1, closedAt: 50 },
  { key: "a", sessionId: "s2", title: "Settings again", url: "brave://settings/", tabs: 1, closedAt: 40 },
]
const kinds = rows => rows.map(r => (r.type || "tab") + ":" + (r.title || ""))
test("recently closed come after the tabs, under a heading", () => {
  const rows = Model.sections(tabs, closed, null, "")
  assert.deepStrictEqual(kinds(rows).slice(-2), ["header:Recently closed", "closed:Old news"])
})
test("a closed tab that is open again is left out", () => {
  assert.ok(!kinds(Model.sections(tabs, closed, null, "")).includes("closed:Settings again"))
})
test("bookmarks and history show only for the query they were found for", () => {
  const found = { query: "news", bookmarks: [{ key: "a", token: 1, title: "News site", url: "https://n.example/" }], history: [] }
  assert.ok(kinds(Model.sections(tabs, closed, found, "news")).includes("bookmark:News site"))
  assert.ok(!kinds(Model.sections(tabs, closed, found, "new")).includes("bookmark:News site"))
})
test("a query ends with a web search in the browser in front", () => {
  const rows = Model.sections(tabs, closed, null, "  rust book ")
  const last = rows[rows.length - 1]
  assert.strictEqual(last.type, "web")
  assert.strictEqual(last.query, "rust book")
  assert.strictEqual(last.key, "a")
  assert.ok(!Model.sections(tabs, closed, null, "").some(r => r.type === "web"))
  assert.ok(!Model.sections(tabs, closed, null, "!audio").some(r => r.type === "web"))
  assert.ok(!Model.sections([], closed, null, "rust").some(r => r.type === "web"))
})
test("? first searches the web and lists nothing else", () => {
  const rows = Model.sections(tabs, closed, null, "?github pulls")
  assert.deepStrictEqual(rows.map(r => r.type + ":" + r.site + ":" + r.query), ["web:null:github pulls"])
  assert.deepStrictEqual(Model.sections(tabs, closed, null, "? "), [])
  assert.strictEqual(Model.searchText("?github"), "")
})
const sites = Model.searches(null)
const site = rows => rows.map(r => (r.site ? r.site.key : "web") + ":" + r.query)
test("?y searches YouTube, ?gh GitHub", () => {
  assert.deepStrictEqual(site(Model.sections(tabs, closed, null, "?y hyprland setup", {}, sites)), ["y:hyprland setup"])
  assert.deepStrictEqual(site(Model.sections(tabs, closed, null, "?GH rails", {}, sites)), ["gh:rails"])
  assert.deepStrictEqual(site(Model.sections(tabs, closed, null, "?yoga", {}, sites)), ["web:yoga"])
  assert.deepStrictEqual(Model.sections(tabs, closed, null, "?y", {}, sites), [])
})
test("the defaults are used until the config has its own list", () => {
  assert.strictEqual(Model.searches({}).length, 7)
  assert.deepStrictEqual(Model.searches({ searches: [] }), [])
  assert.deepStrictEqual(Model.searches({ searches: [{ key: "X", name: " X ", url: "https://x.com/search?q=%s" }, { key: "x", name: "Twice", url: "https://x.com/%s" }] }),
    [{ key: "x", name: "X", url: "https://x.com/search?q=%s" }])
})
test("a search must have a free shortcut, a name and an https address with %s", () => {
  const ok = { key: "so", name: "Stack Overflow", url: "https://stackoverflow.com/search?q=%s" }
  assert.strictEqual(Model.searchProblem(ok, sites, -1), "")
  assert.ok(Model.searchProblem(Object.assign({}, ok, { key: "y" }), sites, -1).includes("YouTube"))
  assert.strictEqual(Model.searchProblem(Object.assign({}, ok, { key: "y" }), sites, 0), "")
  assert.ok(Model.searchProblem(Object.assign({}, ok, { url: "javascript:alert(%s)" }), sites, -1))
  assert.ok(Model.searchProblem(Object.assign({}, ok, { url: "https://x.com/" }), sites, -1).includes("%s"))
  assert.ok(Model.searchProblem(Object.assign({}, ok, { key: "a b" }), sites, -1))
  assert.ok(Model.searchProblem(Object.assign({}, ok, { name: "" }), sites, -1))
})
test("the settings hide recently closed, bookmarks or history", () => {
  const found = { query: "news", bookmarks: [{ key: "a", token: 1, title: "News site", url: "https://n.example/" }],
                  history: [{ key: "a", token: 2, title: "News archive", url: "https://h.example/" }] }
  const show = Model.shown({ show: { closed: false, bookmarks: false } })
  assert.deepStrictEqual(show, { closed: false, bookmarks: false, history: true })
  const k = kinds(Model.sections(tabs, closed, found, "news", {}, [], show))
  assert.ok(!k.includes("closed:Old news") && !k.includes("bookmark:News site") && k.includes("history:News archive"))
  assert.deepStrictEqual(Model.shown({}), { closed: true, bookmarks: true, history: true })
})
test("an address is opened from the first row", () => {
  assert.strictEqual(Model.address("example.org"), "https://example.org")
  assert.strictEqual(Model.address("www.example.org/contact"), "https://www.example.org/contact")
  assert.strictEqual(Model.address("localhost:3000/admin"), "http://localhost:3000/admin")
  assert.strictEqual(Model.address("192.168.1.1"), "http://192.168.1.1")
  assert.strictEqual(Model.address("https://x.org/a?b=c"), "https://x.org/a?b=c")
  for (const q of ["github", "sme sk", "file.txt2", "v1.2", "!dup", "?y hyprland", "javascript:alert(1)"]) assert.strictEqual(Model.address(q), "", q)
  const rows = Model.sections(tabs, closed, null, "example.com")
  assert.deepStrictEqual(rows.slice(0, 2).map(r => r.type || r.id), ["open", 2])
  assert.strictEqual(Model.firstIndex(rows, "example.com"), 0)
})
test("headings are never selected", () => {
  const rows = Model.sections([], closed, null, "")
  assert.strictEqual(rows[Model.firstIndex(rows, "")].type, "closed")
  assert.strictEqual(Model.nextSelectable(rows, 0, 1), 1)
})
test("copies of a page are counted, anchors aside", () => {
  const two = [{ key: "a", id: 1, url: "https://x.org/#top" }, { key: "a", id: 2, url: "https://x.org/" }, { key: "a", id: 3, url: "https://y.org/" }]
  const d = Model.duplicates(two)
  assert.strictEqual(Model.copies(two[0], d), 2)
  assert.strictEqual(Model.copies(two[2], d), 0)
  assert.deepStrictEqual(Model.badges(two[1], 1, 1, d), ["2 copies"])
})
test("a private tab is no copy of a normal one", () => {
  const two = [{ key: "a", id: 1, url: "https://x.org/" }, { key: "a", id: 2, url: "https://x.org/", incognito: true }]
  assert.deepStrictEqual(Model.duplicates(two), {})
})
test("ago reads in minutes and hours", () => {
  assert.strictEqual(Model.ago(0, 5 * 60000), "5 min ago")
  assert.strictEqual(Model.ago(0, 3 * 3600000), "3 h ago")
})

const kinds2 = [
  { key: "a", id: 1, windowId: 10, window: 1, title: "Song", url: "https://music.example/", audible: true, active: true, lastAccessed: 3 },
  { key: "a", id: 2, windowId: 10, window: 1, title: "Docs", url: "https://docs.example/", pinned: true, lastAccessed: 2 },
  { key: "a", id: 3, windowId: 20, window: 2, title: "Video", url: "https://video.example/", audible: true, muted: true, active: true, lastAccessed: 1 },
]
test("!audio keeps the tabs playing sound", () => assert.deepStrictEqual(ids(Model.rows(kinds2, "!audio")), [1, 3]))
test("the start of a filter name is enough", () => assert.deepStrictEqual(ids(Model.rows(kinds2, "!pi")), [2]))
test("filters and words go together", () => assert.deepStrictEqual(ids(Model.rows(kinds2, "!au video")), [3]))
test("a half-typed unknown filter is left out", () => assert.deepStrictEqual(ids(Model.rows(kinds2, "!x")), [2, 1, 3]))
test("!dup uses the copies", () => {
  const two = kinds2.concat([{ key: "a", id: 4, windowId: 20, title: "Docs", url: "https://docs.example/", lastAccessed: 0 }])
  assert.deepStrictEqual(ids(Model.rows(two, "!dup", Model.duplicates(two))), [2, 4])
})
test("a filter shows only tabs, no other sections", () => {
  const found = { query: "", bookmarks: [{ title: "x", url: "https://x/" }], history: [] }
  assert.ok(Model.sections(kinds2, closed, found, "!audio").every(r => !r.type))
})
test("bookmarks are searched for the words alone", () => {
  assert.strictEqual(Model.searchText("  music  "), "music")
  assert.strictEqual(Model.searchText("!audio music"), "")
})
test("!muted keeps the muted tabs", () => assert.deepStrictEqual(ids(Model.rows(kinds2, "!mu")), [3]))

const strip = [
  { key: "a", id: 1, window: 1, index: 3, title: "Current", url: "https://c/", active: true, focusedWindow: true, lastAccessed: 50 },
  { key: "a", id: 2, window: 1, index: 1, title: "Mail", url: "https://m/", pinned: true, lastAccessed: 10 },
  { key: "a", id: 3, window: 1, index: 0, title: "Calendar", url: "https://cal/", pinned: true, lastAccessed: 40 },
  { key: "a", id: 4, window: 1, index: 2, title: "Old", url: "https://o/", lastAccessed: 5 },
]
test("pinned tabs come first, in the browser's order", () => assert.deepStrictEqual(ids(Model.rows(strip, "")), [3, 2, 1, 4]))
test("pinned tabs get a heading, the rest another", () => {
  assert.deepStrictEqual(kinds(Model.sections(strip, [], null, "")),
    ["header:Pinned", "tab:Calendar", "tab:Mail", "header:Tabs", "tab:Current", "tab:Old"])
})
test("no pinned heading while searching", () => assert.ok(Model.sections(strip, [], null, "mail").every(r => r.type !== "header")))
test("the previous tab is preselected even when it is pinned", () => {
  const rows = Model.sections(strip, [], null, "")
  assert.strictEqual(rows[Model.firstIndex(rows, "")].id, 3)
})
test("a pinned tab moves only next to another pinned tab", () => {
  assert.strictEqual(Model.pinnedNeighbour(strip, strip[2], 1).id, 2)
  assert.strictEqual(Model.pinnedNeighbour(strip, strip[2], -1), null)
  assert.strictEqual(Model.pinnedNeighbour(strip, strip[1], 1), null)
  assert.strictEqual(Model.pinnedNeighbour(strip, strip[0], -1), null)
})

// ---------------------------------------------------------------- the QML

const qml = read("BrowserTabSearch.qml")
const ui = Object.fromEntries(fs.readdirSync(path.join(__dirname, "..", "ui")).map(f => [f, read("ui/" + f)]))
const defined = (src, name) => new RegExp("function " + name + "\\(").test(src)

test("every function the overlay calls is defined in it", () => {
  const called = new Set([...qml.matchAll(/\broot\.(\w+)\(/g)].map(m => m[1]))
  for (const src of Object.values(ui)) for (const m of src.matchAll(/\bview\.(\w+)\(/g)) called.add(m[1])
  assert.deepStrictEqual([...called].filter(name => !defined(qml, name)), [])
})
test("every function the service calls is defined in it", () => {
  const src = read("Service.qml")
  const called = new Set([...src.matchAll(/\bservice\.(\w+)\(/g)].map(m => m[1]))
  assert.deepStrictEqual([...called].filter(name => !defined(src, name)), [])
})
test("the library functions the QML calls exist", () => {
  const libs = { Model, Views, Hotkey }
  const missing = []
  for (const src of [qml, read("Service.qml"), ...Object.values(ui)])
    for (const m of src.matchAll(/\b(Model|Views|Hotkey)\.(\w+)/g)) if (m[2] !== "js" && !(m[2] in libs[m[1]])) missing.push(m[0])
  assert.deepStrictEqual(missing, [])
})
test("the form's functions the overlay calls exist", () => {
  const called = [...qml.matchAll(/\bform\.(\w+)\(/g)].map(m => m[1])
  assert.deepStrictEqual(called.filter(name => !defined(ui["SearchForm.qml"], name)), [])
})
test("every Text shows plain text, never markup", () => {
  for (const [file, src] of [["BrowserTabSearch.qml", qml], ...Object.entries(ui)]) {
    const blocks = src.split(/\n\s*(?=(?:Text|TextEdit|Caption)\s*\{)/).slice(1)
    for (const block of blocks) {
      const head = block.slice(0, 400)
      assert.ok(/textFormat:\s*Text(Edit)?\.PlainText/.test(head) || /^Caption/.test(block), file + ": " + block.split("\n")[0])
    }
  }
})
test("every QML file parses (qmllint, when Qt's tools are installed)", () => {
  const { spawnSync } = require("child_process")
  const lint = ["/usr/lib/qt6/bin/qmllint", "/usr/bin/qmllint6", "/usr/bin/qmllint"].find(p => fs.existsSync(p))
  if (!lint) return
  const files = fs.readdirSync(path.join(__dirname, "..")).filter(f => f.endsWith(".qml"))
    .concat(Object.keys(ui).map(f => "ui/" + f))
  for (const f of files) {
    const out = spawnSync(lint, [path.join(__dirname, "..", f)], { encoding: "utf8" })
    const syntax = (out.stdout + out.stderr).split("\n").filter(l => /\[syntax\]/.test(l))
    assert.deepStrictEqual(syntax, [], f)
  }
})
test("no QML method is named like a JavaScript global, which QML refuses to load", () => {
  const globals = ["escape", "unescape", "eval", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI",
    "encodeURIComponent", "decodeURIComponent", "print", "gc", "qsTr", "qsTranslate", "Number", "String", "Object", "Array", "Date", "Math", "JSON"]
  for (const [file, src] of [["BrowserTabSearch.qml", qml], ["Service.qml", read("Service.qml")], ...Object.entries(ui)])
    for (const m of src.matchAll(/^\s*function (\w+)\(/gm)) assert.ok(!globals.includes(m[1]), file + ": " + m[1])
})
test("no TextField or TextInput, which read the clipboard on every change", () => {
  for (const [file, src] of [["BrowserTabSearch.qml", qml], ...Object.entries(ui)])
    assert.ok(!/\b(TextField|TextInput|SearchableDropdown|NumberField)\s*\{/.test(src), file)
})

// ---------------------------------------------------------------- Views.js

test("the settings list the key, what is shown and the searches", () => {
  const rows = Views.settingsRows({ query: "", hotkey: "SUPER + E", show: Model.shown(null), sites: Model.searches(null) })
  assert.deepStrictEqual(rows.filter(r => r.type === "header").map(r => r.title.split(",")[0]), ["Key", "Show", "Searches"])
  assert.deepStrictEqual(rows.find(r => r.type === "keyset").keys, ["SUPER + E"])
  assert.strictEqual(rows.filter(r => r.type === "toggle").length, 3)
  assert.strictEqual(rows.filter(r => r.type === "site").length, 7)
  assert.ok(rows.some(r => r.type === "add") && !rows.some(r => r.type === "reset"))
})
test("the settings filter as you type and offer the defaults back once changed", () => {
  const sites = Model.searches(null).slice(1)
  const rows = Views.settingsRows({ query: "wiki", hotkey: "", show: Model.shown(null), sites })
  assert.deepStrictEqual(rows.filter(r => r.type === "site").map(r => r.key), ["w"])
  assert.ok(!rows.some(r => r.type === "toggle" || r.type === "keyset"))
  assert.ok(rows.some(r => r.type === "reset"))
  assert.deepStrictEqual(Views.settingsRows({ query: "", hotkey: "", show: Model.shown(null), sites: [] }).find(r => r.type === "keyset").keys, ["no key"])
})
test("the key picker says which key is the current one and what holds the others", () => {
  const rows = Views.hotkeyRows([{ hotkey: "SUPER + E", holder: "" }, { hotkey: "SUPER + D", holder: "" }, { hotkey: "SUPER + W", holder: "Close window" }], "SUPER + E")
  assert.deepStrictEqual(rows.slice(1).map(r => [r.title, r.off, r.about]),
    [["SUPER + E", false, "Current"], ["SUPER + D", false, "Free"], ["SUPER + W", true, "Used by “Close window”"]])
})
test("the key list filters by what a key does or by the key", () => {
  assert.ok(Views.keyRows("").length > 15)
  assert.deepStrictEqual(Views.keyRows("copies").map(r => r.keys), [["ctrl d"]])
  assert.ok(Views.keyRows("mute").every(r => /mute/i.test(r.title)))
})
test("the footer shows what Enter and the keys do for the selected row", () => {
  const tab = { key: "a", id: 1, url: "https://x/" }
  const keys = s => Views.hints(Object.assign({ mode: "tabs", row: null, marks: 0, editing: -1, copies: 0 }, s)).map(h => h.key + " " + h.text)
  assert.deepStrictEqual(keys({ row: tab }), ["↵ Switch to tab", "ctrl w Close tab"])
  assert.deepStrictEqual(keys({ row: tab, copies: 2 }), ["↵ Switch to tab", "ctrl w Close tab", "ctrl d Close copies"])
  assert.deepStrictEqual(keys({ row: tab, marks: 3 }), ["ctrl w Close", "ctrl m Mute"])
  assert.deepStrictEqual(keys({ row: { type: "closed" } }), ["↵ Reopen", "ctrl w Hide"])
  assert.deepStrictEqual(keys({ mode: "settings", row: { type: "site" } }), ["↵ Edit", "ctrl w Remove"])
  assert.deepStrictEqual(keys({ mode: "settings", row: { type: "toggle", on: true } }), ["↵ Hide"])
  assert.deepStrictEqual(keys({ mode: "edit", editing: 2 }), ["↵ Save", "tab Next field", "ctrl w Remove"])
  assert.deepStrictEqual(keys({ mode: "edit", editing: -1 }), ["↵ Save", "tab Next field"])
  assert.deepStrictEqual(keys({ mode: "hotkey", row: { type: "hotkey", off: true } }), ["↵ Taken"])
  assert.deepStrictEqual(keys({ mode: "keys", row: { type: "key" } }), [])
  assert.strictEqual(Views.escLabel("tabs", 0, true), "Clear")
  assert.strictEqual(Views.escLabel("edit", 0, false), "Cancel")
})
test("each kind of row has its second line", () => {
  assert.strictEqual(Views.subtitle({ url: "https://www.example.com/x" }), "example.com")
  assert.strictEqual(Views.subtitle({ type: "open", url: "https://example.org" }), "https://example.org")
  assert.strictEqual(Views.subtitle({ type: "web", site: { url: "https://github.com/search?q=%s" } }), "github.com")
  assert.strictEqual(Views.subtitle({ type: "reset" }), "YouTube, Wikipedia, GitHub, Google Maps, Reddit, X, Amazon")
  assert.strictEqual(Views.glyph({ type: "toggle", on: false }), "󰄱")
})
test("rows stay selected across lists by what they are", () => {
  assert.ok(Views.sameRow({ key: "a", id: 1 }, { key: "a", id: 1, title: "changed" }))
  assert.ok(!Views.sameRow({ key: "a", id: 1 }, { key: "b", id: 1 }))
  assert.ok(Views.sameRow({ type: "closed", key: "a", sessionId: "s" }, { type: "closed", key: "a", sessionId: "s" }))
  assert.ok(!Views.sameRow({ type: "hotkey", key: "SUPER + E", url: "" }, { type: "hotkey", key: "SUPER + D", url: "" }))
  assert.notStrictEqual(Views.markId({ key: "a", id: 7 }), Views.markId({ type: "closed", key: "a", sessionId: "7" }))
})
test("an empty list says why", () => {
  const base = { rows: 0, status: "ok", mode: "tabs", query: "", sites: Model.searches(null), setup: null }
  const say = s => Views.emptyMessage(Object.assign({}, base, s))
  assert.strictEqual(say({ rows: 2 }), "")
  assert.strictEqual(say({ query: "?y" }), "Type what to search for on YouTube.")
  assert.strictEqual(say({ query: "?" }), "Type what to search for on the web.")
  assert.strictEqual(say({ query: "!a" }), "No tab is playing sound.")
  assert.strictEqual(say({ query: "zzz" }), "Nothing matches “zzz”.")
  assert.strictEqual(say({ status: "loading" }), "Reading your tabs…")
  assert.strictEqual(say({ status: "none", setup: { stale: ["brave-origin"] } }),
    "Brave Origin is still running with its old settings. Quit it completely, including its web apps, then start it again.")
  assert.strictEqual(Views.className("brave-origin-beta"), "Brave Origin")
  assert.ok(say({ status: "none", setup: { stale: ["brave-origin", "chromium"] } }).startsWith("Brave Origin and Chromium are still running"))
  assert.strictEqual(Views.listNames(["Brave", "Chromium", "Vivaldi"]), "Brave, Chromium and Vivaldi")
  assert.ok(say({ status: "none", setup: { stale: [], loaded: ["brave-origin"] } }).startsWith("Brave Origin has the extension but it does not answer."))
})

const cmd = "omarchy-shell shell toggle mani4.browser-tab-search '{}'"
test("binds a free key", () => {
  const plan = Hotkey.plan("[]", "SUPER + ALT + T", cmd)
  assert.ok(plan.bound)
  assert.ok(plan.lua[0].includes('hl.bind("SUPER + ALT + T"'))
  assert.ok(plan.lua[0].includes('"Search browser tabs"'))
})
test("does not take a key that is used", () => {
  const binds = JSON.stringify([{ modmask: 72, key: "T", description: "Something", dispatcher: "exec" }])
  const plan = Hotkey.plan(binds, "SUPER + ALT + T", cmd)
  assert.ok(!plan.bound)
  assert.strictEqual(plan.conflict, "Something")
})

console.log(passed + " passed")
