const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const code = readFileSync(require.resolve("./plugin.js"), "utf8");

function setup({ failDubs = false, deferGraph } = {}) {
    const events = {};
    const channels = {};
    const requests = [];
    const first = { id: 1, type: "ANIME", title: { english: "First </script>" }, episodes: 12, seasonYear: 2000 };
    const second = { id: 2, type: "ANIME", title: { english: "Second" }, seasonYear: 2001 };
    const anime = {
        1: { ...first, relations: { edges: [
            { relationType: "SEQUEL", node: second },
            { relationType: "ADAPTATION", node: { id: 3, type: "MANGA" } }
        ] } },
        2: { ...second, relations: { edges: [{ relationType: "PREQUEL", node: first }] } }
    };
    const state = { visible: false };
    const tray = { close() {}, update() {}, onOpen() {}, render(fn) { state.render = fn; }, stack: value => value, text: value => value, button: value => value };
    const viewer = {
        setContent(fn) { state.content = fn; },
        show() { state.visible = true; },
        hide() { state.visible = false; },
        update() {},
        channel: { on(name, callback) { channels[name] = callback; } }
    };
    const ctx = {
        newTray: () => tray,
        newWebview: () => viewer,
        state(initial) { return { get: () => initial, set: value => { initial = value; } }; },
        effect() {},
        registerEventHandler(name, fn) { events[name] = fn; },
        screen: {
            onNavigate(fn) { state.navigate = fn; },
            navigateTo(path, params) { state.destination = path + "?id=" + params.id; },
            loadCurrent() {}
        },
        async fetch(url, options) {
            if (url.includes("githubusercontent")) {
                if (failDubs) throw new Error("offline");
                return { json: () => ({ dubbed: [1], partial: [2] }) };
            }
            const ids = JSON.parse(options.body).variables.ids;
            requests.push(ids);
            if (deferGraph) await deferGraph;
            return { json: () => ({ data: { Page: { media: ids.map(id => anime[id]).filter(Boolean) } } }) };
        }
    };
    let callback;
    vm.runInNewContext(code + "\ninit();", {
        $ui: { register: fn => { callback = fn.toString(); } }
    });
    const handler = vm.runInNewContext("(" + callback + ")", {
        $anilist: { getAnimeCollection: () => ({ MediaListCollection: { lists: [{ entries: [
            { media: { id: 1 }, progress: 6, score: 8 },
            { mediaId: 2, status: "COMPLETED" }
        ] }] } }) }
    });
    handler(ctx);
    const navigate = (pathname, id) => state.navigate({ pathname, searchParams: { id } });
    return { state, events, channels, requests, navigate };
}

test("opens an anime graph, enriches cards, reuses cache and navigates", async () => {
    const { state, events, channels, requests, navigate } = setup();
    assert.match(state.render().join(" "), /details page first/);
    navigate("/entry", "1");
    await events["open-watch-order"]();
    assert.equal(state.visible, true);
    assert.deepEqual(requests, [[1], [2]]);
    const html = state.content();
    assert.match(html, /First &lt;\/script&gt;/);
    assert.match(html, /6\/12 watched/);
    assert.match(html, /★ 8/);
    assert.match(html, /✓ Watched/);
    assert.match(html, /Partial EN Dub/);
    assert.equal((html.match(/marker-end=/g) || []).length, 1);
    new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    channels["open-anime"](3);
    assert.equal(state.visible, true);
    channels["open-anime"](2);
    assert.equal(state.visible, false);
    assert.equal(state.destination, "/entry?id=2");
    await events["open-watch-order"]();
    assert.equal(requests.length, 2);
});

test("keeps the graph when dub lookup fails", async () => {
    const { state, events, navigate } = setup({ failDubs: true });
    navigate("/entry", "1");
    await events["open-watch-order"]();
    assert.match(state.content(), /dub availability could not load/);
    assert.match(state.content(), /data-id="2"/);
});

test("ignores a response after leaving the title page", async () => {
    let release;
    const deferGraph = new Promise(resolve => { release = resolve; });
    const { state, events, requests, navigate } = setup({ deferGraph });
    navigate("/entry", "1");
    const opening = events["open-watch-order"]();
    navigate("/discover");
    release();
    await opening;
    assert.equal(state.visible, false);
    assert.deepEqual(requests, [[1]]);
});
