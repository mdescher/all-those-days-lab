# All Those Days Lab

The web test lab of the puzzle game *All Those Days*: it times how long testers need for the
first solve of candidate rooms. A static page, served by GitHub Pages:
https://mdescher.github.io/all-those-days-lab/

It lives here rather than as a claude.ai artifact because an embedded frame's `localStorage`
does not survive closing the browser on iOS. Progress stays in the tester's browser, under
`all-those-days-lab.v1`; the text on the results screen can be sent and also restored.
