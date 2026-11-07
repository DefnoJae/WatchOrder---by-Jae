# Watch Order by Jae

Watch Order brings the franchise graph from [ApexAnimehub](https://github.com/DefnoJae/ApexAnimehub) into a Seanime-compatible plugin.

Install the [raw manifest](https://raw.githubusercontent.com/DefnoJae/WatchOrder---by-Jae/main/Manifest.json) from the app's Extensions page. Grant AniList access to display the progress and personal scores in your connected collection, and allow network access to AniList and GitHub for relationship and dub data.

Open an anime's details page, then click the numbered-list **Watch Order** button in its toolbar. The graph opens inline above the episode list. Drag to pan, use **−**, **+**, or **Fit** to change the view, or hold Ctrl or Cmd while scrolling to zoom at the pointer. Select any poster card to open that title's details. Close the graph with **×**, Escape, or the toolbar button.

The highlighted card is the current title. Arrows show AniList's reported relationships, and cards are arranged left to right by release chronology along connected branches. English dub badges use [MyDubList](https://github.com/Joelis57/MyDubList) and distinguish full from partial dubs. Progress and scores come from the app's AniList collection with personal scores shown out of 10. Selecting a card opens the app's own page, where you can update your list.

Traversal is limited to 40 titles and eight batched requests per opening. Larger or partially loaded franchises show a notice. If either the dub index or the collection is unavailable, the relationship graph still opens.

The implementation uses the [Seanime plugin contract](https://seanime.gitbook.io/seanime-extensions/plugins/introduction) with a minimum version of 3.10.2. It needs a C Anime build that exposes the same anime-page button, inline webview, channel, navigation, and AniList APIs. Compatibility with a separate C Anime runtime has not been verified.

Run `node --test` to check the plugin workflow with simulated host APIs.
