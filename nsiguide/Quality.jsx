import { useState, useEffect, useMemo, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFilter,
  faSort,
  faSortUp,
  faSortDown,
  faExternalLinkAlt,
} from "@fortawesome/free-solid-svg-icons";

import { TREES } from "./constants";

const DIST = "https://cdn.jsdelivr.net/npm/name-suggestion-index@latest/dist";
const INDEX_URL = `${DIST}/json/nsi.min.json`;
const WIKIDATA_URL = `${DIST}/wikidata/wikidata.min.json`;
const DISSOLVED_URL = `${DIST}/wikidata/dissolved.min.json`;

// Quality checks. Each check is run against a single item with its resolved
// wikidata entry. `applies` filters out checks that don't make sense for a
// given tree (e.g. social-media checks don't apply to flags).
// `dissolution: true` flags a check as inherently about dissolved items —
// those bypass the "hide dissolved" filter so their counts are meaningful.
const CHECKS = {
  // --- Tag coverage on the NSI item itself ---
  "missing-wikidata": {
    label: "Missing Wikidata tag",
    description: "The item has no *:wikidata tag for its tree.",
    test: ({ qid }) => !qid,
  },

  // --- Wikidata metadata ---
  "missing-description": {
    label: "Missing English description",
    description: "Wikidata entry has no English description.",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.description,
  },
  "missing-commons-logo": {
    label: "Missing Commons logo / image",
    description: "Wikidata entry has no Commons image (P18, P154, P158, P94, P8972).",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.logos?.wikidata,
  },
  "missing-website": {
    label: "Missing official website",
    description: "Wikidata entry has no P856 (official website).",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) =>
      !!qid && !!wd && !(wd.officialWebsites && wd.officialWebsites.length),
  },
  "insecure-website": {
    label: "Insecure website (http://)",
    description: "Official website (P856) uses http:// instead of https://.",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) =>
      !!qid && !!wd && (wd.officialWebsites || []).some((u) => typeof u === "string" && /^http:\/\//i.test(u)),
  },

  // --- Social presence (Wikidata identities) ---
  "missing-any-social": {
    label: "No social identities at all",
    description: "Wikidata entry has no social-media identities (FB / IG / X / etc.).",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) =>
      !!qid && !!wd && Object.keys(wd.identities || {}).length === 0,
  },
  "missing-facebook-logo": {
    label: "Missing Facebook logo",
    description: "Has a Facebook ID but no usable profile image was fetched.",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) =>
      !!qid && !!wd && !!wd.identities?.facebook && !wd.logos?.facebook,
  },
  "missing-facebook": {
    label: "Missing Facebook",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.identities?.facebook,
  },
  "missing-instagram": {
    label: "Missing Instagram",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.identities?.instagram,
  },
  "missing-twitter": {
    label: "Missing X (Twitter)",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.identities?.twitter,
  },
  "missing-tiktok": {
    label: "Missing TikTok",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.identities?.tiktok,
  },
  "missing-youtube": {
    label: "Missing YouTube",
    applies: (tree) => tree !== "flags",
    test: ({ qid, wd }) =>
      !!qid && !!wd && !wd.identities?.youtube && !wd.identities?.youtubeHandle,
  },
  "missing-linkedin": {
    label: "Missing LinkedIn",
    applies: (tree) => tree === "brands" || tree === "operators",
    test: ({ qid, wd }) => !!qid && !!wd && !wd.identities?.linkedin,
  },

  // --- Dissolution lifecycle ---
  "dissolved": {
    label: "Marked dissolved",
    description: "Wikidata reports the entity has dissolved.",
    dissolution: true,
    test: ({ item, dissolvedMap }) => !!dissolvedMap[item.id],
  },
  "has-replacement-suggestion": {
    label: "Has replacement suggestion",
    description: "Dissolved entity with a successor QID (followed by / replaced by / merged into) — evaluate and update NSI.",
    dissolution: true,
    test: ({ item, dissolvedMap }) =>
      (dissolvedMap[item.id] || []).some((d) => !!d.upgrade),
  },
  "dissolved-without-successor": {
    label: "Dissolved, no successor",
    description: "Marked dissolved but no replacement entity is recorded — research opportunity.",
    dissolution: true,
    test: ({ item, dissolvedMap }) => {
      const ds = dissolvedMap[item.id];
      return !!ds && ds.length > 0 && ds.every((d) => !d.upgrade);
    },
  },
};

const PAGE_SIZE = 100;

const useFetchJson = (url) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e) {
        setError(e.message || String(e));
      }
    })();
  }, [url]);
  return [data, error];
}

const metaDate = (data) =>
  data?._meta?.generated && new Date(Date.parse(data._meta.generated));

// Build a flat item list with tree/k/v/qid resolved once.
const buildItems = (nsiJson) => {
  if (!nsiJson?.nsi) return [];
  const all = [];
  for (const [tkv, category] of Object.entries(nsiJson.nsi)) {
    const items = category.items;
    if (!Array.isArray(items)) continue;
    const [tree, k, v] = tkv.split("/", 3);
    const tprops = TREES[tree];
    if (!tprops) continue;
    const wdTag = tprops.wikidataTag;
    for (const item of items) {
      const qid = item.tags?.[wdTag];
      all.push({ item, tree, k, v, tkv, qid });
    }
  }
  return all;
}


export const Quality = () => {
  const [nsiData, nsiErr] = useFetchJson(INDEX_URL);
  const [wdData, wdErr] = useFetchJson(WIKIDATA_URL);
  const [disData, disErr] = useFetchJson(DISSOLVED_URL);

  const [tree, setTree] = useState("all");
  const [selectedChecks, setSelectedChecks] = useState(new Set());
  const [textFilter, setTextFilter] = useState("");
  const [ccFilter, setCcFilter] = useState("");
  const [showDissolved, setShowDissolved] = useState(false);
  const [sortKey, setSortKey] = useState("issues");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);

  const isLoading = !nsiData || !wdData || !disData;
  const loadError = nsiErr || wdErr || disErr;

  const wikidata = wdData?.wikidata || {};
  const dissolvedMap = useMemo(() => disData?.dissolved || {}, [disData]);

  const nsiGenerated = metaDate(nsiData);
  const wdGenerated = metaDate(wdData);
  const disGenerated = metaDate(disData);
  const nsiVersion = nsiData?._meta?.version;

  const flatItems = useMemo(() => buildItems(nsiData), [nsiData]);

  const scored = useMemo(() => {
    if (isLoading) return [];
    return flatItems.map((row) => {
      const wd = row.qid ? wikidata[row.qid] : undefined;
      const treeProps = TREES[row.tree];
      const ctx = { item: row.item, qid: row.qid, wd, treeProps, dissolvedMap };
      const issues = [];
      for (const [key, def] of Object.entries(CHECKS)) {
        if (def.applies && !def.applies(row.tree)) continue;
        if (def.test(ctx)) issues.push(key);
      }
      return { ...row, wd, issues };
    });
  }, [flatItems, wikidata, dissolvedMap, isLoading]);

  const bypassDissolved = useMemo(() => {
    for (const key of selectedChecks) {
      if (CHECKS[key]?.dissolution) return true;
    }
    return false;
  }, [selectedChecks]);

  const treeScoped = useMemo(() => {
    return scored.filter((r) => {
      if (tree !== "all" && r.tree !== tree) return false;
      if (!showDissolved && !bypassDissolved && dissolvedMap[r.item.id]) return false;
      return true;
    });
  }, [scored, tree, showDissolved, bypassDissolved, dissolvedMap]);

  const preCheckFiltered = useMemo(() => {
    const text = textFilter.trim().toLowerCase();
    const cc = ccFilter.trim().toLowerCase();
    return treeScoped.filter((r) => {
      if (text) {
        const name = (r.item.displayName || r.item.id || "").toLowerCase();
        if (!name.includes(text)) return false;
      }
      if (cc) {
        const inc = r.item.locationSet?.include || [];
        let hit = false;
        for (const code of inc) {
          if (typeof code === "string" && code.toLowerCase().includes(cc)) {
            hit = true; break;
          }
        }
        if (!hit) return false;
      }
      return true;
    });
  }, [treeScoped, textFilter, ccFilter]);

  const counts = useMemo(() => {
    const c = {};
    for (const key of Object.keys(CHECKS)) c[key] = 0;
    for (const r of preCheckFiltered) {
      for (const k of r.issues) c[k]++;
    }
    return c;
  }, [preCheckFiltered]);

  const filtered = useMemo(() => {
    const wantChecks = selectedChecks;

    let rows = preCheckFiltered.filter((r) => {
      if (wantChecks.size) {
        let hit = false;
        for (const k of wantChecks) {
          if (r.issues.includes(k)) { hit = true; break; }
        }
        if (!hit) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === "issues") {
        return (a.issues.length - b.issues.length) * dir
          || a.item.displayName.localeCompare(b.item.displayName);
      }
      if (sortKey === "tkv") {
        return a.tkv.localeCompare(b.tkv) * dir
          || a.item.displayName.localeCompare(b.item.displayName);
      }
      return a.item.displayName.localeCompare(b.item.displayName) * dir;
    });
    return rows;
  }, [preCheckFiltered, selectedChecks, sortKey, sortDir]);

  // Reset to page 1 whenever the filter set changes
  useEffect(() => { setPage(1); }, [tree, selectedChecks, textFilter, ccFilter, showDissolved, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const toggleCheck = useCallback((key) => {
    setSelectedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "issues" ? "desc" : "asc"); }
  };

  const sortIcon = (key) => {
    if (sortKey !== key) return <FontAwesomeIcon icon={faSort} className="sorticon dim" />;
    return <FontAwesomeIcon icon={sortDir === "asc" ? faSortUp : faSortDown} className="sorticon" />;
  };

  const clearAll = () => {
    setTree("all");
    setSelectedChecks(new Set());
    setTextFilter("");
    setCcFilter("");
    setShowDissolved(false);
  };

  const filtersActive = tree !== "all" || selectedChecks.size || textFilter || ccFilter || showDissolved;

  return (
    <>
      <div className={"filters" + (filtersActive ? " active" : "")}>
        <span className="icon"><FontAwesomeIcon icon={faFilter} /></span>
        <span className="filterby">Filter by</span>

        <span className="field">
          <label htmlFor="qtree">Tree:</label>
          <select id="qtree" value={tree} onChange={(e) => setTree(e.target.value)}>
            <option value="all">all</option>
            {Object.keys(TREES).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </span>

        <span className="field">
          <label htmlFor="qtext">Name:</label>
          <input type="text" id="qtext" size="14" autoCorrect="off"
            value={textFilter} onChange={(e) => setTextFilter(e.target.value)} />
        </span>

        <span className="field">
          <label htmlFor="qcc">Country code:</label>
          <input type="text" id="qcc" size="3" maxLength="6" autoCorrect="off"
            value={ccFilter} onChange={(e) => setCcFilter(e.target.value)} />
        </span>

        <span className="field">
          <label htmlFor="qdis">Show dissolved:</label>
          <input type="checkbox" id="qdis"
            checked={showDissolved} onChange={(e) => setShowDissolved(e.target.checked)} />
        </span>

        <span className="field">
          <button className="clearFilters" onClick={clearAll}>Clear</button>
        </span>
      </div>

      <div id="content">
        <div className="instructions">
          <p>
            Pick one or more <strong>quality checks</strong> below to find NSI
            items missing data on Wikidata or in the index itself. Use the row
            links to jump to Wikidata or the item's entry on{" "}
            <a href="index.html">nsi.guide</a> and start improving things.
          </p>
          <p>
            Fixes won't disappear from this dashboard until{" "}
            <code>bun run wikidata</code> and <code>bun run dist</code> are run
            again to refresh the data.
          </p>
          {(nsiGenerated || wdGenerated || disGenerated) && (
            <p className="data-freshness">
              Data freshness:{" "}
              {nsiGenerated && (
                <>NSI{nsiVersion && ` v${nsiVersion}`} <time dateTime={nsiGenerated.toISOString()}>{nsiGenerated.toLocaleDateString()}</time></>
              )}
              {nsiGenerated && wdGenerated && " · "}
              {wdGenerated && <>Wikidata <time dateTime={wdGenerated.toISOString()}>{wdGenerated.toLocaleDateString()}</time></>}
              {(nsiGenerated || wdGenerated) && disGenerated && " · "}
              {disGenerated && <>Dissolved <time dateTime={disGenerated.toISOString()}>{disGenerated.toLocaleDateString()}</time></>}
            </p>
          )}
        </div>

        {loadError && <div className="warnings-status error">Failed to load data: {loadError}</div>}
        {isLoading && !loadError && <div className="warnings-status">Loading data, please wait…</div>}

        {!isLoading && (
          <>
            <div className="quality-checks">
              {Object.entries(CHECKS).map(([key, def]) => {
                const active = selectedChecks.has(key);
                const c = counts[key] || 0;
                return (
                  <button
                    key={key}
                    type="button"
                    className={"check" + (active ? " active" : "") + (c === 0 ? " empty" : "")}
                    onClick={() => toggleCheck(key)}
                    title={def.description || def.label}
                  >
                    <span className="label">{def.label}</span>
                    <span className="count">{c.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>

            <div className="warnings-summary">
              Showing <strong>{filtered.length.toLocaleString()}</strong> of{" "}
              <strong>{treeScoped.length.toLocaleString()}</strong> item{treeScoped.length === 1 ? "" : "s"}
              {totalPages > 1 && (
                <span className="pager">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹ Prev</button>
                  <span className="pageinfo">Page {page} / {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next ›</button>
                </span>
              )}
            </div>

            <table className="summary warnings quality">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort("name")}>
                    Name {sortIcon("name")}
                  </th>
                  <th className="sortable" onClick={() => toggleSort("tkv")}>
                    Category {sortIcon("tkv")}
                  </th>
                  <th>Wikidata</th>
                  <th className="sortable" onClick={() => toggleSort("issues")}>
                    Issues {sortIcon("issues")}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <ItemRow key={r.item.id} row={r} selectedChecks={selectedChecks} />
                ))}
                {!pageRows.length && (
                  <tr><td colSpan={5} className="nowarn">No items match the current filters.</td></tr>
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="warnings-summary">
                <span className="pager">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹ Prev</button>
                  <span className="pageinfo">Page {page} / {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next ›</button>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}


const ItemRow = ({ row, selectedChecks }) => {
  const { item, tree, k, v, tkv, qid, wd, issues } = row;
  const nsiLink = `index.html?t=${tree}&k=${k}&v=${v}&id=${item.id}#${item.id}`;
  const website = wd?.officialWebsites?.[0];

  return (
    <tr className="quality-row">
      <td className="qname">
        <div className="name">{item.displayName}</div>
        <div className="id"><code>{item.id}</code></div>
      </td>
      <td className="type">
        <code>{tkv}</code>
      </td>
      <td className="qid">
        {qid ? (
          <a href={`https://www.wikidata.org/wiki/${qid}`} target="_blank" rel="noreferrer">{qid}</a>
        ) : (
          <span className="missing">—</span>
        )}
      </td>
      <td className="msg">
        <div className="badges">
          {issues.map((key) => {
            const def = CHECKS[key];
            const emphasized = selectedChecks.has(key);
            return (
              <span key={key} className={"badge " + key + (emphasized ? " emphasized" : "")} title={def.description || def.label}>
                {def.label}
              </span>
            );
          })}
        </div>
      </td>
      <td className="actions">
        <a href={nsiLink} title="Open on nsi.guide">nsi.guide <FontAwesomeIcon icon={faExternalLinkAlt} size="xs" /></a>
        {qid && (
          <>
            {" · "}
            <a href={`https://www.wikidata.org/wiki/${qid}`} target="_blank" rel="noreferrer" title="Edit on Wikidata">
              edit <FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />
            </a>
          </>
        )}
        {website && (
          <>
            {" · "}
            <a href={website} target="_blank" rel="noreferrer" title={website}>
              website <FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />
            </a>
          </>
        )}
      </td>
    </tr>
  );
}
