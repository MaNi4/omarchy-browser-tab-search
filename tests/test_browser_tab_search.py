"""python3 -m unittest discover -s tests — bin/browser-tab-search without a real browser."""

import importlib.machinery
import importlib.util
import json
import stat
import hashlib
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest

# Loading bin/browser-tab-search as a module would leave a __pycache__ next to it.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "..", "bin", "browser-tab-search")


def load():
    loader = importlib.machinery.SourceFileLoader("browser_tab_search", TOOL)
    spec = importlib.util.spec_from_loader("browser_tab_search", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


ts = load()


def load_tool():
    from importlib.machinery import SourceFileLoader
    return SourceFileLoader("browser_tab_search_tool", TOOL).load_module()


class Flags(unittest.TestCase):
    def test_adds_to_the_existing_line(self):
        lines = ["--ozone-platform=wayland", "--load-extension=/a,/b"]
        self.assertEqual(ts.with_extension(lines, True)[1], "--load-extension=/a,/b," + ts.EXTENSION_DIR)

    def test_adds_a_line_when_there_is_none(self):
        self.assertEqual(ts.with_extension(["--x"], True), ["--x", "--load-extension=" + ts.EXTENSION_DIR])

    def test_adding_twice_changes_nothing(self):
        once = ts.with_extension(["--load-extension=/a"], True)
        self.assertEqual(ts.with_extension(once, True), once)

    def test_removing_leaves_the_others(self):
        lines = ["--load-extension=/a," + ts.EXTENSION_DIR]
        self.assertEqual(ts.with_extension(lines, False), ["--load-extension=/a"])

    def test_removing_the_only_one_drops_the_line(self):
        self.assertEqual(ts.with_extension(["--x", "--load-extension=" + ts.EXTENSION_DIR], False), ["--x"])

    def test_a_path_from_before_a_move_is_replaced(self):
        old = os.path.join(ts.PLUGIN_DIR, "extension")
        self.assertEqual(ts.with_extension(["--load-extension=/a," + old], True), ["--load-extension=/a," + ts.EXTENSION_DIR])
        self.assertEqual(ts.with_extension(["--load-extension=/a," + old], False), ["--load-extension=/a"])
        self.assertEqual(ts.with_extension(["--load-extension=" + ts.PLUGIN_DIR + "-other/x"], True),
                         ["--load-extension=" + ts.PLUGIN_DIR + "-other/x," + ts.EXTENSION_DIR])


class Connect(unittest.TestCase):
    def test_connect_and_disconnect(self):
        with tempfile.TemporaryDirectory() as config:
            os.makedirs(os.path.join(config, "BraveSoftware", "Brave-Origin"))
            flags = os.path.join(config, "brave-origin-flags.conf")
            with open(flags, "w") as handle:
                handle.write("--load-extension=/usr/share/x\n")
            env = dict(os.environ, XDG_CONFIG_HOME=config)
            out = json.loads(subprocess.run([TOOL, "connect"], env=env, capture_output=True, check=True).stdout)
            self.assertEqual(out["hosts"], ["BraveSoftware/Brave-Origin"])
            self.assertEqual(out["flags"], ["brave-origin-flags.conf"])
            manifest = os.path.join(config, "BraveSoftware/Brave-Origin/NativeMessagingHosts/com.mani4.tab_search.json")
            data = json.load(open(manifest))
            self.assertEqual(data["allowed_origins"], [ts.ORIGIN])
            self.assertTrue(os.path.isabs(data["path"]))
            self.assertIn(ts.EXTENSION_DIR, open(flags).read())
            subprocess.run([TOOL, "disconnect"], env=env, capture_output=True, check=True)
            self.assertFalse(os.path.exists(manifest))
            self.assertEqual(open(flags).read(), "--load-extension=/usr/share/x\n")


class Commands(unittest.TestCase):
    def test_tabs_wants_key_and_tab_pairs(self):
        done = subprocess.run([TOOL, "tabs", "close", "1-2.sock"], capture_output=True)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(b"KEY:TAB", done.stderr)

    def test_tabs_refuses_unknown_actions(self):
        done = subprocess.run([TOOL, "tabs", "explode", "1-2.sock:3"], capture_output=True)
        self.assertNotEqual(done.returncode, 0)

    def test_tabs_refuses_a_path_as_key(self):
        done = subprocess.run([TOOL, "tabs", "close", "../x.sock:3"], capture_output=True)
        self.assertNotEqual(done.returncode, 0)


class Windows(unittest.TestCase):
    clients = [
        {"pid": 7, "class": "brave-teams.cloud.microsoft__-Default", "title": "Teams", "address": "0x1", "focusHistoryID": 0},
        {"pid": 7, "class": "brave-origin", "title": "News - Brave Origin", "address": "0x2", "focusHistoryID": 3},
        {"pid": 7, "class": "brave-origin", "title": "Mail - Brave Origin", "address": "0x3", "focusHistoryID": 1},
    ]

    def test_finds_the_window_by_title(self):
        client, sure = ts.pick_window(self.clients, 7, "News")
        self.assertEqual((client["address"], sure), ("0x2", True))

    def test_falls_back_to_the_last_focused_browser_window(self):
        client, sure = ts.pick_window(self.clients, 7, "Other")
        self.assertEqual((client["address"], sure), ("0x3", False))

    def test_never_picks_a_web_app_window(self):
        client, _ = ts.pick_window(self.clients, 7, "Teams")
        self.assertNotEqual(client["address"], "0x1")


class Host(unittest.TestCase):
    """The host, with this test playing the browser on its stdin and stdout."""

    def test_relays_a_list(self):
        with tempfile.TemporaryDirectory() as runtime:
            os.chmod(runtime, 0o700)
            env = dict(os.environ, XDG_RUNTIME_DIR=runtime)
            host = subprocess.Popen([TOOL, ts.ORIGIN], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            try:
                folder = os.path.join(runtime, "browser-tab-search")
                for _ in range(100):
                    if os.path.isdir(folder) and os.listdir(folder):
                        break
                    time.sleep(0.02)
                key = os.listdir(folder)[0]
                self.assertEqual(oct(os.stat(folder).st_mode & 0o777), "0o700")
                self.assertEqual(oct(os.stat(os.path.join(folder, key)).st_mode & 0o777), "0o600")
                lister = subprocess.Popen([TOOL, "list"], env=env, stdout=subprocess.PIPE)
                size = struct.unpack("<I", host.stdout.read(4))[0]
                request = json.loads(host.stdout.read(size))
                self.assertEqual(request["cmd"], "list")
                reply = json.dumps({"id": request["id"], "windows": 1, "icons": {}, "tabs": [
                    {"id": 5, "window": 1, "index": 0, "title": "Hi\nthere", "url": "https://x.org/", "origin": "https://x.org"}]}).encode()
                host.stdin.write(struct.pack("<I", len(reply)) + reply)
                host.stdin.flush()
                out = json.loads(lister.communicate(timeout=5)[0])
                self.assertEqual(out["status"], "ok")
                self.assertEqual(out["tabs"][0]["title"], "Hi there")
                self.assertEqual(out["tabs"][0]["key"], key)
                # The reply came through a host of this version.
                self.assertFalse(out["browsers"][0]["outdated"])
            finally:
                host.stdin.close()
                host.wait(timeout=5)
            self.assertEqual(os.listdir(folder), [])

    def test_instances_of_one_browser_get_names_apart(self):
        tool = load_tool()
        tool.user_data_dir = lambda pid: {1: "work", 2: "home", 3: "default", 4: "default"}[pid]
        names = tool.instance_names([
            {"key": "1-10.sock", "name": "Chromium"}, {"key": "2-20.sock", "name": "Chromium"},
            {"key": "3-30.sock", "name": "Brave"}, {"key": "4-40.sock", "name": "Brave"},
            {"key": "5-50.sock", "name": "Vivaldi"}])
        self.assertEqual(names, {"1-10.sock": "Chromium (work)", "2-20.sock": "Chromium (home)",
                                 "3-30.sock": "Brave 1", "4-40.sock": "Brave 2"})

    def test_the_browser_focused_last_is_in_front(self):
        tool = load_tool()
        tool.hypr_clients = lambda: [{"pid": 1, "focusHistoryID": 4}, {"pid": 2, "focusHistoryID": 1},
                                     {"pid": 1, "focusHistoryID": 7}, {"pid": 9, "focusHistoryID": 0}]
        self.assertEqual(tool.last_focused([{"key": "1-10.sock"}, {"key": "2-20.sock"}]), "2-20.sock")
        tool.hypr_clients = lambda: []
        self.assertEqual(tool.last_focused([{"key": "1-10.sock"}, {"key": "2-20.sock"}]), "1-10.sock")

    def test_a_site_search_fills_in_the_words(self):
        tool = load_tool()
        self.assertEqual(tool.web_request('{"query": "rust book", "url": "https://x.com/search?q=%s"}'),
                         {"cmd": "web", "query": "rust book", "url": "https://x.com/search?q=rust%20book"})
        self.assertEqual(tool.web_request('{"query": "a&b=c", "url": ""}'), {"cmd": "web", "query": "a&b=c"})
        self.assertEqual(tool.web_request('{"query": "x", "url": "https://example.org/?q=%s"}')["url"], "https://example.org/?q=x")
        self.assertIn("a%26b%3Dc", tool.web_request('{"query": "a&b=c", "url": "https://x.com/?q=%s"}')["url"])
        self.assertIsNone(tool.web_request('{"query": "x", "url": "javascript:alert(%s)"}'))
        self.assertIsNone(tool.web_request('{"query": "x", "url": "https://x.com/"}'))
        self.assertIsNone(tool.web_request('{"query": "", "url": ""}'))
        self.assertIsNone(tool.web_request("not json"))
        self.assertEqual(tool.web_request('{"address": "https://example.org/a?b=c"}')["url"], "https://example.org/a?b=c")
        self.assertIsNone(tool.web_request('{"address": "javascript:alert(1)"}'))
        self.assertIsNone(tool.web_request('{"address": "file:///etc/passwd"}'))

    def test_a_changed_worker_gets_a_new_name(self):
        extension = os.path.join(os.path.dirname(TOOL), "..", "extension", "chromium")
        with open(os.path.join(extension, "manifest.json")) as f:
            worker = json.load(f)["background"]["service_worker"]
        with open(os.path.join(os.path.dirname(__file__), "workers.json")) as f:
            known = json.load(f)
        with open(os.path.join(extension, worker), "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        self.assertEqual(sorted(n for n in os.listdir(extension) if n.startswith("worker-")), [worker])
        self.assertIn(worker, known, "add %s: %s to tests/workers.json" % (worker, digest))
        self.assertEqual(known[worker], digest,
                         "%s changed: rename it to the next number, as browsers keep running the old one" % worker)

    def test_save_config_writes_0600_to_a_fresh_file(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, XDG_CONFIG_HOME=home)
            target = os.path.join(home, "omarchy", "extensions", "browser-tab-search.json")
            os.makedirs(os.path.dirname(target))
            with open(target, "w") as f:
                f.write("{}")
            os.chmod(target, 0o644)
            before = os.stat(target).st_ino
            done = subprocess.run([TOOL, "save-config"], input=b'{"hotkey": "SUPER + E", "show": {"history": false}}', env=env)
            self.assertEqual(done.returncode, 0)
            self.assertEqual(stat.S_IMODE(os.stat(target).st_mode), 0o600)
            self.assertNotEqual(os.stat(target).st_ino, before)
            with open(target) as f:
                self.assertEqual(json.load(f), {"hotkey": "SUPER + E", "show": {"history": False}})
            for bad in (b"[1, 2]", b"not json", b"{" + b" " * 70000 + b"}"):
                self.assertNotEqual(subprocess.run([TOOL, "save-config"], input=bad, env=env).returncode, 0)
            with open(target) as f:
                self.assertEqual(json.load(f)["hotkey"], "SUPER + E")

    def test_the_extension_is_found_in_either_kind_of_command_line(self):
        tool = load_tool()
        flag = "--load-extension=/usr/share/x/copy-url," + tool.EXTENSION_DIR
        self.assertTrue(tool.extension_in_cmdline("/opt/brave/brave\0--ozone-platform=wayland\0" + flag + "\0"))
        self.assertTrue(tool.extension_in_cmdline("/opt/brave/brave --ozone-platform=wayland " + flag + " --type=browser"))
        self.assertFalse(tool.extension_in_cmdline("/opt/brave/brave --load-extension=/usr/share/x/copy-url"))
        self.assertFalse(tool.extension_in_cmdline("/opt/brave/brave\0--load-extension=" + tool.EXTENSION_DIR + "-old\0"))

    def test_bookmarklets_are_not_offered(self):
        tool = load_tool()
        found = tool.found_items([{"token": 1, "title": "Share", "url": "javascript:alert(1)"},
                                  {"token": 2, "title": "Page", "url": " DATA:text/html,<b>x</b>"},
                                  {"token": 3, "title": "Docs", "url": "https://docs.example/"}], "k", "bookmark")
        self.assertEqual([f["token"] for f in found], [3])

    def test_only_small_raster_icons_are_shown(self):
        tool = load_tool()
        icons = {}
        tool.take_icons({"icons": {
            "https://a.org": "data:image/png;base64,iVBORw0KGgo=",
            "https://b.org": "data:image/svg+xml;base64,PHN2Zz4=",
            "https://c.org": "data:image/png;base64,not base64!",
            "https://d.org": "https://d.org/favicon.png",
            "https://e.org": "data:image/png;base64," + "A" * 13000,
        }}, icons)
        self.assertEqual(list(icons), ["https://a.org"])

    def test_list_tightens_a_readable_config(self):
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as runtime:
            env = dict(os.environ, XDG_CONFIG_HOME=home, XDG_RUNTIME_DIR=runtime)
            target = os.path.join(home, "omarchy", "extensions", "browser-tab-search.json")
            os.makedirs(os.path.dirname(target))
            with open(target, "w") as f:
                f.write("{}")
            os.chmod(target, 0o644)
            subprocess.run([TOOL, "list"], env=env, capture_output=True, timeout=10)
            self.assertEqual(stat.S_IMODE(os.stat(target).st_mode), 0o600)

    def test_a_symlinked_config_stays_a_symlink(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, XDG_CONFIG_HOME=home)
            real = os.path.join(home, "dotfiles.json")
            with open(real, "w") as f:
                f.write("{}")
            link = os.path.join(home, "omarchy", "extensions", "browser-tab-search.json")
            os.makedirs(os.path.dirname(link))
            os.symlink(real, link)
            self.assertEqual(subprocess.run([TOOL, "save-config"], input=b'{"hotkey": ""}', env=env).returncode, 0)
            self.assertTrue(os.path.islink(link))
            with open(real) as f:
                self.assertEqual(json.load(f), {"hotkey": ""})

    def test_version_matches_the_extension(self):
        with open(os.path.join(os.path.dirname(TOOL), "..", "extension", "chromium", "manifest.json")) as f:
            version = json.load(f)["version"]
        with open(TOOL) as f:
            self.assertIn('VERSION = "%s"' % version, f.read())

    def test_refuses_another_extension(self):
        done = subprocess.run([TOOL, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"], input=b"", capture_output=True)
        self.assertEqual(done.returncode, 1)


if __name__ == "__main__":
    unittest.main()
