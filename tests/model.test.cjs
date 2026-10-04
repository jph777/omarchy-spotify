// Node test runner (`node --test tests/model.test.cjs`) for the trusted
// executable and closed environment layer in Model.js, plus a static check
// that the QML never starts a program any other way.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const ROOT = path.join(__dirname, "..")

// Model.js is a QML `.pragma library` script rather than a CommonJS module:
// drop the pragma and evaluate it in a fresh context whose globals are its API.
function loadModel() {
  const source = fs.readFileSync(path.join(ROOT, "Model.js"), "utf8").replace(/^\.pragma library\s*$/m, "")
  const context = vm.createContext({})
  vm.runInContext(source, context, { filename: "Model.js" })
  return context
}

const Model = loadModel()
// Values from the vm context carry that realm's prototypes; compare as JSON.
const plain = (value) => JSON.parse(JSON.stringify(value))

const TOOLS = {
  "uwsm-app": "/usr/bin/uwsm-app",
  "omarchy-launch-or-focus": "/usr/share/omarchy/bin/omarchy-launch-or-focus",
  "omarchy-launch-floating-terminal-with-presentation": "/usr/share/omarchy/bin/omarchy-launch-floating-terminal-with-presentation"
}

test("trustedExecutable accepts only clean paths inside trusted directories", () => {
  assert.equal(Model.trustedExecutable("/usr/bin/python3"), "/usr/bin/python3")
  assert.equal(Model.trustedExecutable("/run/current-system/sw/bin/python3"), "/run/current-system/sw/bin/python3")
  for (const bad of ["python3", "./python3", "/usr/local/bin/python3", "/home/tim/.local/bin/python3",
    "/usr/bin/../../tmp/python3", "/usr/bin/.python3", "/usr/bin/py thon", "/usr/bin/", "/usr/bin/sub/python3",
    "/usr/bin/python3\n", "", null, undefined, 42, ["/usr/bin/python3"]]) {
    assert.equal(Model.trustedExecutable(bad), "", String(bad))
  }
  assert.equal(Model.trustedExecutable("/usr/share/omarchy/bin/omarchy"), "")
  assert.equal(Model.trustedExecutable("/usr/share/omarchy/bin/omarchy", Model.trustedOmarchyDirectories), "/usr/share/omarchy/bin/omarchy")
})

test("the bridge runs under an isolated absolute interpreter or not at all", () => {
  assert.deepEqual(plain(Model.bridgeCommand("/usr/bin/python3", "/p/bin/spotify-bridge", ["search", "a b; $(id)"])),
    ["/usr/bin/python3", "-I", "-B", "/p/bin/spotify-bridge", "search", "a b; $(id)"])
  assert.deepEqual(plain(Model.bridgeCommand("python3", "/p/bin/spotify-bridge", ["status"])), [])
  assert.deepEqual(plain(Model.bridgeCommand("/home/x/bin/python3", "/p/bin/spotify-bridge", ["status"])), [])
  assert.deepEqual(plain(Model.bridgeCommand("/usr/bin/python3", "bin/spotify-bridge", ["status"])), [])
  assert.deepEqual(plain(Model.bridgeCommand("", "/p/bin/spotify-bridge", ["status"])), [])
})

test("every python candidate is probed as an absolute isolated command", () => {
  for (const candidate of Model.pythonCandidates) {
    const command = plain(Model.pythonProbeCommand(candidate))
    assert.equal(command[0], candidate)
    assert.equal(command[1], "-I")
  }
  assert.deepEqual(plain(Model.pythonProbeCommand("python3")), [])
})

test("closedEnvironment keeps only listed single-line values and pins PATH", () => {
  const env = plain(Model.closedEnvironment({
    HOME: "/home/x",
    PATH: "/tmp/evil:/usr/bin",
    LD_PRELOAD: "/tmp/evil.so",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus\nBASH_ENV=/tmp/x",
    USER: ""
  }, ["HOME", "PATH", "DBUS_SESSION_BUS_ADDRESS", "USER"], Model.trustedPathEnvironment, { PATH: "/tmp/nope", OMARCHY_PATH: "/usr/share/omarchy" }))
  assert.deepEqual(env, { HOME: "/home/x", OMARCHY_PATH: "/usr/share/omarchy", PATH: Model.trustedPathEnvironment })
})

test("no environment allow-list carries a code-loading or command variable", () => {
  const forbidden = ["PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "BASH_ENV", "ENV", "PYTHONPATH",
    "PYTHONHOME", "PYTHONSTARTUP", "QT_PLUGIN_PATH", "QML2_IMPORT_PATH", "GTK_MODULES", "TERMINAL", "EDITOR",
    "BROWSER", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS", "http_proxy", "https_proxy", "HTTPS_PROXY", "SSL_CERT_FILE",
    "OMARCHY_PATH", "SHELL"]
  for (const list of [Model.bridgeEnvironmentNames, Model.launchEnvironmentNames]) {
    for (const name of plain(list)) {
      assert.ok(!forbidden.includes(name), name)
      assert.ok(!/^BASH_FUNC_|^LD_|^PYTHON/.test(name), name)
    }
  }
  for (const dir of plain(Model.trustedPathEnvironment.split(":")).concat(plain(Model.trustedSessionPathEnvironment.split(":")))) {
    assert.ok(!dir.startsWith("/home") && !dir.startsWith("/usr/local") && dir.startsWith("/"), dir)
  }
})

test("detached launches use trusted absolute tools under their own names", () => {
  assert.deepEqual(plain(Model.appLaunchCommand(TOOLS, "/usr/bin/spotify")), ["/usr/bin/uwsm-app", "--", "/usr/bin/spotify"])
  assert.deepEqual(plain(Model.focusAppCommand(TOOLS)), ["/usr/share/omarchy/bin/omarchy-launch-or-focus", "spotify"])
  assert.deepEqual(plain(Model.installLaunchCommand(TOOLS)),
    ["/usr/share/omarchy/bin/omarchy-launch-floating-terminal-with-presentation", Model.installCommand])

  assert.deepEqual(plain(Model.appLaunchCommand(TOOLS, "/usr/local/bin/spotify")), [])
  assert.deepEqual(plain(Model.appLaunchCommand(TOOLS, "/usr/bin/sh")), [])
  assert.deepEqual(plain(Model.appLaunchCommand({ "uwsm-app": "/home/x/.local/bin/uwsm-app" }, "/usr/bin/spotify")), [])
  assert.deepEqual(plain(Model.appLaunchCommand({ "uwsm-app": "/usr/bin/sh" }, "/usr/bin/spotify")), [])
  assert.deepEqual(plain(Model.appLaunchCommand({ "uwsm-app": "/usr/share/omarchy/bin/uwsm-app" }, "/usr/bin/spotify")), [])
  assert.deepEqual(plain(Model.focusAppCommand({ "omarchy-launch-or-focus": "/tmp/omarchy-launch-or-focus" })), [])
  assert.deepEqual(plain(Model.installLaunchCommand({})), [])
  assert.deepEqual(plain(Model.installLaunchCommand(null)), [])
})

test("the QML starts programs only through closed-environment Process objects", () => {
  const service = fs.readFileSync(path.join(ROOT, "Service.qml"), "utf8")
  const qml = ["Service.qml", "Panel.qml", "BarWidget.qml"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n")
  // No shell strings, no bar.run, no execDetached, no bare bridge invocation.
  for (const pattern of [/\bbash\b/, /-lc\b/, /execDetached/, /\.run\(/, /command:\s*\[\s*bridge\b/]) {
    assert.ok(!pattern.test(qml), String(pattern))
  }
  const processes = (service.match(/\bProcess\s*\{/g) || []).length
  const closed = (service.match(/clearEnvironment:\s*true/g) || []).length
  assert.ok(processes >= 3)
  assert.equal(closed, processes)
})

test("filterByName matches every word, ignores case, and keeps the list for an empty query", () => {
  const items = [{ name: "Liked Songs" }, { name: "Road Trip 2024" }, { name: "Focus: Deep Work" }, { name: "" }, {}]
  const names = (query) => Model.filterByName(items, query).map((item) => item.name)
  assert.deepEqual(names(""), ["Liked Songs", "Road Trip 2024", "Focus: Deep Work", "", undefined])
  assert.deepEqual(names("   "), names(""))
  assert.deepEqual(names("road"), ["Road Trip 2024"])
  assert.deepEqual(names("TRIP road"), ["Road Trip 2024"])
  assert.deepEqual(names("deep  work"), ["Focus: Deep Work"])
  assert.deepEqual(names("o"), ["Liked Songs", "Road Trip 2024", "Focus: Deep Work"])
  assert.deepEqual(names("zzz"), [])
  assert.deepEqual(plain(Model.filterByName([], "x")), [])
})

test("artPending is true only while a cover URL has no entry in the files map", () => {
  const url = "https://i.scdn.co/image/x"
  assert.equal(Model.artPending(null, {}), false)
  assert.equal(Model.artPending({ name: "no cover" }, {}), false)
  assert.equal(Model.artPending({ artUrl: url }, {}), true)
  assert.equal(Model.artPending({ artUrl: url }), true)
  assert.equal(Model.artPending({ artUrl: url }, { [url]: "/c/x.jpg" }), false)
  // A failed fetch is recorded as an empty path and is settled, not pending.
  assert.equal(Model.artPending({ artUrl: url }, { [url]: "" }), false)
  // A pending cover has no remote source to load directly.
  assert.equal(Model.artSource({ art: "", artUrl: url }), "")
  assert.equal(Model.artSource({ artPath: "/c/x.jpg" }), "file:///c/x.jpg")
  assert.equal(Model.artSource({ artPath: "" }), "")
})

test("revealSchedule staggers pending covers, caps the stagger, and keeps starts it already has", () => {
  const pending = (n) => ({ artUrl: "https://i.scdn.co/image/" + n })
  const items = [pending("a"), { name: "Liked", artUrl: "" }, pending("b"), pending("done"), pending("c"), pending("d")]
  const files = { "https://i.scdn.co/image/done": "/c/done.jpg" }
  assert.deepEqual(plain(Model.revealSchedule(items, {}, 1000, 25, 2, files)), {
    "https://i.scdn.co/image/a": 1000,
    "https://i.scdn.co/image/b": 1025,
    "https://i.scdn.co/image/c": 1050,
    "https://i.scdn.co/image/d": 1050
  })
  // An existing start is never moved, even for a later reload.
  const again = plain(Model.revealSchedule(items, { "https://i.scdn.co/image/a": 500 }, 9000, 25, 2, files))
  assert.equal(again["https://i.scdn.co/image/a"], 500)
  assert.equal(again["https://i.scdn.co/image/b"], 9025)
})

test("revealSchedule drops a resolved start only after the grace period", () => {
  const resolved = [{ artUrl: "https://i.scdn.co/image/x" }]
  const files = { "https://i.scdn.co/image/x": "/c/x.jpg" }
  const existing = { "https://i.scdn.co/image/x": 10000 }
  assert.deepEqual(plain(Model.revealSchedule(resolved, existing, 11000, 25, 8, files)), existing)
  assert.deepEqual(plain(Model.revealSchedule(resolved, existing, 14000, 25, 8, files)), {})
  assert.deepEqual(plain(Model.revealSchedule([], null, 1, 25, 8)), {})
})

test("revealProgress is 0 before the start, 1 after, and 1 when there is no reveal", () => {
  assert.equal(Model.revealProgress(1000, 0, 450), 1)
  assert.equal(Model.revealProgress(1000, undefined, 450), 1)
  assert.equal(Model.revealProgress(900, 1000, 450), 0)
  assert.equal(Model.revealProgress(1225, 1000, 450), 0.5)
  assert.equal(Model.revealProgress(1450, 1000, 450), 1)
  assert.equal(Model.revealProgress(5000, 1000, 450), 1)
})

test("playlistRows filters by name and explains an empty result", () => {
  const items = [{ type: "playlist", name: "Liked Songs", liked: true }, { type: "playlist", name: "Road Trip" }, { type: "playlist", name: "Focus" }]
  const names = (rows) => plain(rows).filter((row) => row.kind === "item").map((row) => row.item.name)
  assert.deepEqual(names(Model.playlistRows(items, "", false, "")), ["Liked Songs", "Road Trip", "Focus"])
  assert.deepEqual(names(Model.playlistRows(items, "  ", false, "")), ["Liked Songs", "Road Trip", "Focus"])
  assert.deepEqual(names(Model.playlistRows(items, "trip", false, "")), ["Road Trip"])
  assert.deepEqual(names(Model.playlistRows(items, "SONGS liked", false, "")), ["Liked Songs"])
  const none = plain(Model.playlistRows(items, "zzz", false, ""))
  assert.equal(none.length, 1)
  assert.equal(none[0].kind, "note")
  assert.match(none[0].text, /No playlist matches/)
  // While the list is still loading with nothing in it, say so, whatever the filter is.
  const loading = plain(Model.playlistRows([], "road", true, ""))
  assert.equal(loading[0].text, "Loading…")
  // Nothing to filter and nothing loading: the usual empty message, not "no match".
  assert.match(plain(Model.playlistRows([], "road", false, ""))[0].text, /No playlists yet/)
  // A reload with the list already present keeps showing (and filtering) it.
  assert.deepEqual(names(Model.playlistRows(items, "focus", true, "")), ["Focus"])
  // An error row stays on top of the list.
  assert.equal(plain(Model.playlistRows(items, "", false, "boom"))[0].text, "boom")
})
