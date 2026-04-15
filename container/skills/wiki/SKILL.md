# Wiki Skill

You maintain a personal knowledge wiki at `/workspace/group/wiki/`. Sources live in `/workspace/group/sources/`.

## Three Operations

### Ingest

When the user provides a source (URL, PDF, pasted text, file path):

1. **Get the full content**
   - URL: use `curl -sL "<url>"` to get full text, not WebFetch (which summarizes). If it's a webpage with JavaScript, use `agent-browser open <url>` then `agent-browser snapshot` to extract full text.
   - PDF: use the pdf-reader skill (`cat /workspace/group/sources/file.pdf | mcp__nanoclaw__read_pdf` or read directly if already accessible)
   - Text/paste: use as-is

2. **Save to sources** if it's a file (not inline paste): save to `/workspace/group/sources/<slug>.<ext>`

3. **Discuss takeaways** — tell the user what you found notable, ask if there's a specific angle they care about

4. **Update the wiki** — for each source, touch all relevant pages:
   - Create or update summary page under the appropriate category subdirectory
   - Update entity pages (people, companies, projects, tools) — create if first mention
   - Update concept pages — create if first mention
   - Add cross-references to related pages
   - Update `wiki/index.md` — add/update rows for every page touched
   - Append to `wiki/log.md`: `## [YYYY-MM-DD] ingest | <Source Title>`

5. **One source at a time** — never batch. Fully finish one source (all page updates, index, log) before moving to the next.

### Query

When the user asks a question:

1. Read `wiki/index.md` first to find relevant pages
2. Read those pages
3. Synthesize an answer with citations (page names, not filenames)
4. If the answer is good, offer to save it as a new wiki page (queries compound knowledge)

### Lint

Periodically (or on request), health-check the wiki:

1. Read `wiki/index.md` and all pages
2. Look for:
   - Contradictions between pages
   - Stale claims superseded by newer sources
   - Orphan pages with no inbound links from other pages
   - Concepts/entities that appear multiple times but lack a dedicated page
   - Missing cross-references between clearly related pages
3. Report findings and offer to fix them

## Page Conventions

- Use subdirectories by category: `wiki/personal/`, `wiki/technical/`, `wiki/business/`, `wiki/concepts/`, `wiki/people/`
- Filename: lowercase, hyphens, e.g. `wiki/technical/transformer-architecture.md`
- Each page starts with: `# Page Title`, then a one-paragraph summary, then sections
- Include a `## Sources` section at the bottom listing what this page was built from
- Cross-link other pages using `[Page Title](../category/page-name.md)` relative paths

## Source Conventions

- Save sources to `sources/<YYYY-MM-DD>-<slug>.<ext>`
- Never modify source files after saving — they are immutable inputs
