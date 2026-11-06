function init() {
    $ui.register(ctx => {
        const RELATIONS = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY"]);
        const FIELDS = "id type title { english romaji } coverImage { extraLarge } format episodes seasonYear startDate { year month day }";
        const QUERY = `query WatchOrder($ids: [Int]) {
          Page(perPage: 12) { media(id_in: $ids, type: ANIME) {
            ${FIELDS} relations { edges { relationType node { ${FIELDS} } } }
          } }
        }`;
        const DUB_URL = "https://raw.githubusercontent.com/Joelis57/MyDubList/refs/heads/main/dubs/confidence/normal/dubbed_english.json";

        function releaseDate(anime) {
            const date = anime.startDate || {};
            return (date.year || anime.seasonYear || 9999) * 10000 + (date.month || 1) * 100 + (date.day || 1);
        }

        function orderEdges(nodes) {
            const ids = new Set(nodes.map(node => node.id));
            const edges = new Map();
            for (const node of nodes) {
                for (const edge of node.relations?.edges || []) {
                    let from = node.id;
                    let to = edge.node?.id;
                    let relation = edge.relationType;
                    if (!RELATIONS.has(relation) || !ids.has(to) || from === to) continue;
                    if (relation === "PREQUEL" || relation === "PARENT") {
                        [from, to] = [to, from];
                        relation = relation === "PREQUEL" ? "SEQUEL" : "SIDE_STORY";
                    }
                    if (relation === "ALTERNATIVE" && from > to) [from, to] = [to, from];
                    edges.set(`${Math.min(from, to)}:${Math.max(from, to)}:${relation}`, { from, to, relation });
                }
            }
            return Array.from(edges.values());
        }

        async function fetchGraph(root, query, isCurrent) {
            const nodes = new Map([[root, { id: root }]]);
            const fetched = new Set();
            let warning = "";
            for (let round = 0; round < 8 && isCurrent(); round++) {
                const ids = Array.from(nodes.keys()).filter(id => !fetched.has(id)).slice(0, 12);
                if (!ids.length) break;
                let media;
                try {
                    media = await query(ids);
                    if (!isCurrent()) return;
                    if (!Array.isArray(media) || (!round && !media.some(node => node.id === root))) {
                        throw new Error("AniList did not return this title.");
                    }
                } catch (error) {
                    if (!round) throw error;
                    warning = "Some relationships could not load. Reopen Watch Order to retry.";
                    break;
                }
                ids.forEach(id => fetched.add(id));
                for (const node of media) {
                    if (!ids.includes(node.id)) continue;
                    nodes.set(node.id, node);
                    for (const edge of node.relations?.edges || []) {
                        const related = edge.node;
                        if (!RELATIONS.has(edge.relationType) || related?.type !== "ANIME" || nodes.has(related.id)) continue;
                        if (nodes.size >= 40) {
                            warning = "Showing up to 40 connected titles. Open a title to explore further.";
                            continue;
                        }
                        nodes.set(related.id, related);
                    }
                }
            }
            if (!isCurrent()) return;
            if (!warning && Array.from(nodes.keys()).some(id => !fetched.has(id))) {
                warning = "Some further relationships have not loaded. Open a title to explore further.";
            }
            const ordered = Array.from(nodes.values()).sort((a, b) => releaseDate(a) - releaseDate(b) || a.id - b.id);
            return { nodes: ordered, edges: orderEdges(ordered), warning };
        }

        function layoutGraph(nodes, edges) {
            const columns = new Map();
            const rows = new Map();
            const byId = new Map();
            const order = new Map(nodes.map((node, index) => [node.id, index]));
            for (const node of nodes) {
                let column = 0;
                for (const edge of edges) {
                    if (edge.from !== node.id && edge.to !== node.id) continue;
                    const neighbor = edge.from === node.id ? edge.to : edge.from;
                    if (order.get(neighbor) < order.get(node.id)) {
                        column = Math.max(column, columns.get(neighbor) + 1);
                    }
                }
                const row = rows.get(column) || 0;
                columns.set(node.id, column);
                rows.set(column, row + 1);
                byId.set(node.id, { x: 30 + 360 * column, y: 35 + 155 * row });
            }
            return { byId, width: 310 + 360 * Math.max(...columns.values()), height: 45 + 155 * Math.max(...rows.values()) };
        }

        function collectionEntries(collection) {
            const result = new Map();
            for (const list of collection?.MediaListCollection?.lists || []) {
                for (const entry of list.entries || []) {
                    const id = entry.media?.id || entry.mediaId;
                    if (id) result.set(id, entry);
                }
            }
            return result;
        }

        function escapeHtml(value) {
            return String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
            })[char]);
        }

        function titleOf(node) {
            return node.title?.english || node.title?.romaji || `AniList #${node.id}`;
        }

        function graphMarkup(graph, root, entries, dubs) {
            const { byId, width, height } = layoutGraph(graph.nodes, graph.edges);
            const arrows = graph.edges.map(({ from, to, relation }, index) => {
                const source = byId.get(from);
                const target = byId.get(to);
                const forward = source.x < target.x;
                const startX = source.x + (forward ? 250 : 0);
                const endX = target.x + (forward ? 0 : 250);
                const offset = (index % 3 - 1) * 13;
                const startY = source.y + 56 + offset;
                const endY = target.y + 56 + offset;
                const middle = (startX + endX) / 2;
                const label = relation.toLowerCase().replace("_", " ");
                return `<path d="M${startX},${startY} C${middle},${startY} ${middle},${endY} ${endX},${endY}" marker-end="url(#arrow)"/><text x="${middle}" y="${(startY + endY) / 2 - 7}">${label}</text>`;
            }).join("");
            const cards = graph.nodes.map(node => {
                const { x, y } = byId.get(node.id);
                const entry = entries.get(node.id);
                const poster = node.coverImage?.extraLarge || "";
                const image = /^https:\/\/s4\.anilist\.co\//.test(poster) ? `<img alt="" src="${escapeHtml(poster)}" draggable="false">` : '<span class="placeholder"></span>';
                const dub = dubs.dubbed.has(node.id) ? "EN Dub" : dubs.partial.has(node.id) ? "Partial EN Dub" : "";
                const progress = entry?.status === "COMPLETED" ? "✓ Watched" : entry?.progress > 0 ? `${entry.progress}/${node.episodes || "?"} watched` : "";
                const score = entry?.score > 0 ? `★ ${entry.score}` : "";
                const badges = [dub, progress, score].filter(Boolean).map(badge => `<span class="badge">${escapeHtml(badge)}</span>`).join("");
                const detail = [node.format?.replace("_", " "), node.startDate?.year || node.seasonYear, node.episodes && `${node.episodes} ep`].filter(Boolean).join(" · ");
                return `<button class="card${node.id === root ? " current" : ""}" data-id="${node.id}" style="left:${x}px;top:${y}px">${image}<span class="copy"><strong>${escapeHtml(titleOf(node))}</strong><small>${escapeHtml(detail)}</small><span class="badges">${badges}</span></span></button>`;
            }).join("");
            return `<div id="board" style="width:${width}px;height:${height}px"><svg width="${width}" height="${height}" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z"/></marker></defs>${arrows}</svg>${cards}</div>`;
        }

        function bindGraph() {
            const viewport = document.getElementById("viewport");
            const board = document.getElementById("board");
            const send = (event, data) => window.webview?.send(event, data);
            document.getElementById("close").onclick = () => send("close", {});
            document.addEventListener("keydown", event => {
                if (event.key === "Escape") send("close", {});
            });
            if (!board) return;
            const size = document.getElementById("size");
            let scale = 1;
            let drag;
            let moved = false;
            function zoom(next, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
                next = Math.min(2, Math.max(0.2, next));
                const left = (viewport.scrollLeft + x) / scale;
                const top = (viewport.scrollTop + y) / scale;
                scale = next;
                size.style.width = board.offsetWidth * scale + "px";
                size.style.height = board.offsetHeight * scale + "px";
                board.style.transform = "scale(" + scale + ")";
                viewport.scrollLeft = left * scale - x;
                viewport.scrollTop = top * scale - y;
            }
            document.getElementById("plus").onclick = () => zoom(scale * 1.2);
            document.getElementById("minus").onclick = () => zoom(scale / 1.2);
            function fit() {
                zoom(Math.min(1, viewport.clientWidth / board.offsetWidth, viewport.clientHeight / board.offsetHeight), 0, 0);
                viewport.scrollTo(0, 0);
            }
            document.getElementById("fit").onclick = fit;
            viewport.addEventListener("wheel", event => {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                const bounds = viewport.getBoundingClientRect();
                zoom(scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - bounds.left, event.clientY - bounds.top);
            }, { passive: false });
            viewport.addEventListener("pointerdown", event => {
                if (event.button !== 0) return;
                moved = false;
                drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
            });
            viewport.addEventListener("pointermove", event => {
                if (drag?.id !== event.pointerId) return;
                const dx = event.clientX - drag.x;
                const dy = event.clientY - drag.y;
                if (!moved && Math.hypot(dx, dy) < 6) return;
                moved = true;
                viewport.setPointerCapture(event.pointerId);
                viewport.scrollTo(drag.left - dx, drag.top - dy);
            });
            function finish(event) {
                if (drag?.id === event.pointerId) drag = undefined;
            }
            viewport.addEventListener("pointerup", finish);
            viewport.addEventListener("pointercancel", finish);
            viewport.addEventListener("pointerleave", finish);
            viewport.addEventListener("click", event => {
                const card = event.target.closest("[data-id]");
                if (card && (!moved || event.detail === 0)) send("open-anime", Number(card.dataset.id));
            });
            fit();
        }

        function documentFor(title, status, markup = "") {
            return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Watch Order by Jae</title><style>
        *{box-sizing:border-box}body{margin:0;background:transparent;color:#f3efff;font:15px system-ui,sans-serif;height:100vh;height:100dvh;display:flex;flex-direction:column}
        header{padding:8px 2px 12px;background:transparent;display:flex;gap:14px;align-items:center;flex-wrap:wrap}header div:first-child{flex:1}h1,p{margin:0}h1{font-size:19px}p{color:#c9bfe1;margin-top:4px}button{font:inherit;color:inherit;background:#2b2440;border:1px solid #5e507d;border-radius:8px;padding:7px 11px;cursor:pointer}button:hover,button:focus-visible{border-color:#d4bdff;outline:2px solid #a88ee2}#viewport{flex:1;overflow:auto;cursor:grab;touch-action:none;user-select:none;background:#141316;border:1px solid #28252e;border-radius:14px;display:grid;align-items:safe center}#viewport:active{cursor:grabbing}#size{position:relative;overflow:hidden;margin-inline:auto}#board{position:absolute;transform-origin:0 0}svg{position:absolute;inset:0;pointer-events:none}svg path{fill:none;stroke:#ab91e3;stroke-width:2;stroke-dasharray:5 4}marker path{fill:#ab91e3;stroke:none}svg text{fill:#e9dfff;font-size:13px;text-anchor:middle;paint-order:stroke;stroke:#100e1a;stroke-width:5px;stroke-linejoin:round}.card{position:absolute;width:250px;height:112px;display:flex;gap:9px;align-items:center;padding:7px;text-align:left}.card.current{border:2px solid #c2a1ff;background:#332651}.card img,.placeholder{width:62px;height:94px;object-fit:cover;border-radius:5px;background:#45365f;flex:none}.copy{display:grid;gap:3px;min-width:0}.copy strong{font-size:14px;line-height:1.15;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}small{color:#d0c3e6}.badges{display:flex;gap:3px;flex-wrap:wrap}.badge{background:#4a3869;border-radius:4px;font-size:10px;padding:2px 4px}.status{padding:8px 18px;background:#27203a;color:#ede2ff}
        </style><header><div><h1>Watch Order</h1><p>${escapeHtml(title)}</p></div><div>${markup ? '<button id="minus" aria-label="Zoom out">−</button> <button id="plus" aria-label="Zoom in">+</button> <button id="fit">Fit</button> ' : ""}<button id="close" aria-label="Close watch order">×</button></div></header>
        ${status ? `<div class="status" role="status">${escapeHtml(status)}</div>` : ""}
        <main id="viewport" tabindex="0" aria-label="Anime relationship graph"><div id="size">${markup}</div></main>
        ${markup ? '<footer style="padding:8px 2px;color:#bcb4c9;font-size:12px">Select a card to open its anime page.</footer>' : ""}
        <script>(${bindGraph.toString()})();</script></html>`;
        }

        const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ddd" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5h11M10 12h11M10 19h11M3 4l2-1v5m-2 0h4M3 11c0-2 4-2 4 0 0 1-4 2-4 4h4M3 17h4l-2 2c3-1 3 4-2 3"/></svg>';
        const button = ctx.action.newAnimePageButton({
            label: "Watch Order",
            tooltipText: "Watch Order",
            intent: "gray-subtle",
            style: {
                width: "40px", padding: "0", fontSize: "0",
                backgroundImage: "url(data:image/svg+xml," + encodeURIComponent(icon) + ")",
                backgroundRepeat: "no-repeat", backgroundPosition: "center", backgroundSize: "20px"
            }
        });
        button.mount();
        const viewer = ctx.newWebview({
            slot: "before-anime-entry-episode-list",
            hidden: true, width: "100%", height: "490px", maxHeight: "70vh",
            style: "border:0;background:transparent"
        });
        const current = ctx.state(0);
        const cache = new Map();
        let generation = 0;
        let allowed = new Set();
        let html = documentFor("", "Open an anime page to view its watch order.");
        let dubCache;
        viewer.setContent(() => html);
        function show(content) {
            html = content;
            viewer.show();
            viewer.update();
        }
        function close() {
            generation++;
            allowed = new Set();
            viewer.hide();
        }
        async function getDubs() {
            if (dubCache && Date.now() - dubCache.time < 3600000) return dubCache.data;
            const response = await ctx.fetch(DUB_URL);
            const raw = await response.json();
            const dubbed = Array.isArray(raw) ? raw : raw.dubbed;
            if (!Array.isArray(dubbed)) throw new Error("Invalid dub index");
            const data = { dubbed: new Set(dubbed), partial: new Set(raw.partial || []) };
            dubCache = { time: Date.now(), data };
            return data;
        }
        async function query(ids) {
            const response = await ctx.fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ query: QUERY, variables: { ids } })
            });
            const result = await response.json();
            if (result.errors?.length || !result.data?.Page) throw new Error("AniList request failed");
            return result.data.Page.media;
        }
        button.onClick(async () => {
            const root = current.get();
            if (!root) return;
            if (!viewer.isHidden()) return close();
            const request = ++generation;
            const isCurrent = () => request === generation;
            allowed = new Set();

            show(documentFor("", "Loading AniList relationships…"));
            try {
                const saved = cache.get(root);
                const graphRequest = saved && Date.now() - saved.time < 1800000
                    ? Promise.resolve(saved.graph) : fetchGraph(root, query, isCurrent);
                const [graph, dubs] = await Promise.all([graphRequest, getDubs().catch(() => null)]);
                if (!isCurrent()) return;
                if (!graph.warning) {
                    cache.delete(root);
                    if (cache.size >= 12) cache.delete(cache.keys().next().value);
                    cache.set(root, { time: Date.now(), graph });
                }
                let entries = new Map();
                const notices = [graph.warning];
                if (!dubs) notices.push("English dub availability could not load.");
                try {
                    entries = collectionEntries($anilist.getAnimeCollection(false));
                } catch (_) {
                    notices.push("AniList progress and scores are unavailable.");
                }
                allowed = new Set(graph.nodes.map(node => node.id));
                const markup = graphMarkup(graph, root, entries, dubs || { dubbed: new Set(), partial: new Set() });
                show(documentFor(titleOf(graph.nodes.find(node => node.id === root)), notices.filter(Boolean).join(" "), markup));
            } catch (_) {
                if (isCurrent()) show(documentFor("", "Unable to load this franchise from AniList. Close and reopen Watch Order to retry."));
            }
        });
        viewer.channel.on("close", close);
        viewer.channel.on("open-anime", id => {
            if (!allowed.has(id)) return;
            close();
            ctx.screen.navigateTo("/entry", { id: String(id) });
        });
        ctx.screen.onNavigate(({ pathname, searchParams }) => {
            const id = Number(searchParams?.id);
            const next = pathname === "/entry" && Number.isSafeInteger(id) && id > 0 ? id : 0;
            if (next !== current.get()) close();
            current.set(next);
        });
        ctx.screen.loadCurrent();
    });
}
