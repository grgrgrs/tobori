import React, { useEffect, useState, useRef } from "react";


import ReactFlow, {
  MiniMap,
  Controls,
  useReactFlow,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";

import { Handle, Position } from "reactflow";

import { getTagFrequencies } from './utils/getTagFrequencies';
//import TagCloud from './components/TagCloudClient';
import { getRelatedArticles } from "./dataService";

import { loadGraphData, loadRelatedData } from './dataService';
//import { ReactFlowProvider } from 'reactflow';

import "./GraphApp.css";

// --- arrangeChildren: Lay out child nodes centered under a parent node ---
function arrangeChildren(parentNode, children, overrideStartX, numRows=1) {
  if (!parentNode || children.length === 0) return [];
  console.log ("In arrangeChildren ------------------------------------------");
  console.log("numRows: ", numRows);
  const baseX = overrideStartX !== undefined ? overrideStartX : parentNode.position?.x || 0;
  const baseY = parentNode.position?.y || 0;
  const spacingX = 225;
  const spacingY = 150;
  const rowThreshold = 4;

  const result = [];
  //const numRows = children.length >= rowThreshold ? 2 : 1;
  const rows = Array.from({ length: numRows }, () => []);



  const maxPerRow = Math.ceil(children.length / numRows);
  children.forEach((child, i) => {
    const rowIndex = Math.floor(i / maxPerRow);
    rows[rowIndex].push(child);
  });


  const startX = baseX;
  rows.forEach((rowNodes, rowIndex) => {
    rowNodes.forEach((child, colIndex) => {
      let totalWidth = (rowNodes.length - 1) * spacingX;
      let x = startX + colIndex * spacingX;
      let y = baseY + spacingY * (rowIndex + 1);
      //if (numRows > 1 && rowIndex % 2 === 1) {
      //  y += spacingY / 2;
      //  x += spacingX / 2;
      //}
      console.log("final x: ", x, " y: ", y);
      result.push({
        ...child,
        position: { x, y },
        hidden: false,
        type: "custom",
      });
    });
  });

  return result;
}




const CustomNode = ({ data }) => {
  const type = data?.type ?? "unknown";
  const label = data?.label ?? "";
  const articleCount = data?.articleCount ?? null;

  const isDimmed = (type === "category" || type === "theme") && articleCount === 0;
  const isRelated = data?.related;
  const isSelected = data?.selected;

  const classList = [
    "custom-node",
    `${type}-node`,
    isDimmed && "dimmed-node",
    isRelated && "related-node",
    isSelected && "selected-node",
    data.clickable && "clickable",
  ].filter(Boolean).join(" ");

  //console.log("Rendering node:", { label, type, isRelated, classList });

  return (
    <>
      <Handle type="target" position={Position.Top} />

      <div
        className={classList}
        title={
          articleCount !== null && type !== "article"
            ? `${articleCount} article${articleCount === 1 ? "" : "s"}`
            : undefined
        }
      >
        {label}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </>
  );
};


const nodeTypes = {
  custom: CustomNode,
};


function layoutParentWithChildren(parentNode, children, options = {}, graphWidthOverride = null)
{
  const topPadding = 100; // leave room for parent
  const {
    spacingX = 0,
    spacingY = 100,
    rowThreshold = 4,
    initialYOffset = topPadding
  } = options;
  const childCount = children.length;

  let numRows = 1;
  if (childCount > 4 && childCount <= 8) {
    numRows = 2;
  } else if (childCount > 8) {
    numRows = 3;
  }


  const numCols = Math.ceil(children.length / numRows);
  const totalBlockWidth = (numCols - 1) * spacingX;

  const graphWidth = graphWidthOverride ?? (window.innerWidth - window.innerWidth * 0.18);
  const parentNodeWidth = 150; // approx
  const centerX = (graphWidth / 2) - parentNodeWidth/2;


  console.log("graphWidth: ", graphWidth, "centerX: ", centerX)

  // Position the parent node centered above the block
  const parent = {
    ...parentNode,
    hidden: false,
    type:  "custom",
    position: { x: centerX, y: initialYOffset },
  };

  const laidOutChildren = arrangeChildren(parent, children.map(c => ({ ...c })), 0, numRows);
  console.log("leaving layout, parent: ", parent);
  console.log("and children: ", laidOutChildren);
  return {
    parent,
    children: laidOutChildren
  };
}

function getParentNode(childNode, allNodes) {
  if (!childNode?.data) return null;

  const { type, theme, category, category_id } = childNode.data;
  let parentId;

  if (type === "category" && theme) {
    parentId = theme;
  } else if (type === "article" && category_id) {
    parentId = category_id;
  } else if (type === "theme") {
    parentId = "root";
  } else {
    return null;
  }

  return allNodes.find(n => n.id === parentId) || null;
}


// --- Main Inner Component that uses ReactFlow context ---
// --- Main Component ---
export default function GraphCanvas() {
  const [relatedData, setRelatedData] = useState({});
  const [flatData, setFlatData] = useState(null); // ✅ CORRECT LOCATION
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodeMap, setNodeMap] = useState({});
  const [selectedArticle, setSelectedArticle] = useState(null);
  const { fitView, getNode } = useReactFlow();
  const [selectedNode, setSelectedNode] = useState(null);
  const [categoryArticleCount, setCategoryArticleCount] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState(null);
  const [publishedFilter, setPublishedFilter] = useState("");
  const [availableDates, setAvailableDates] = useState([]);
  const [showRelated, setShowRelated] = useState(true);
  const summaryRef = useRef(null);
  const graphRef = useRef(null);
  const [graphWidth, setGraphWidth] = useState(0);

  useEffect(() => {
    async function loadAll() {
      const [graph, related] = await Promise.all([
        loadGraphData(),
        loadRelatedData(),
      ]);
      setFlatData(graph);
      setRelatedData(related); // <- ✅ this is the critical line
    }
    loadAll();
  }, []);



  useEffect(() => {
    if (!flatData) return;

    const map = Object.fromEntries(flatData.nodes.map((n) => [n.id, n]));
    setNodeMap(map);
    const root = map["root"];
    setNodes([{ ...root, hidden: false, 
      type: "custom",
      }]);
    setEdges([]);
  }, [flatData]);  // ✅ listen for flatData updates

  useEffect(() => {
    if (nodes.length > 0) {
      const mainNodes = nodes.filter(n => !n.data?.related); // or all nodes if needed
      fitView({ nodes: mainNodes, padding: 0.2 });
    }
  }, [nodes]);

  useEffect(() => {
    if (!flatData) return;
    if (lastSelectedNodeId) {
      showNodeById(lastSelectedNodeId);
    }
  }, [filterText, publishedFilter]);  // 👈 add publishedFilter here


  useEffect(() => {
    if (!flatData) return;
    const articles = flatData.nodes.filter(n => n.data?.type === "article");
    const allDates = [...new Set(
      articles.map(n => n.data.published_date?.slice(0, 10))
    )].filter(Boolean);
    //console.log("allDates: ", allDates)
    const sortedDates = allDates.sort((a, b) => new Date(b) - new Date(a));
    const topDates = sortedDates.slice(0, 7); // latest 7
    setAvailableDates(topDates);
    //console.log(topDates)
  }, []);

  useEffect(() => {
    if (!flatData) return;
    const node = nodeMap[lastSelectedNodeId];
    if (node?.data?.type === "article") {
      showNodeById(lastSelectedNodeId);
    }
  }, [showRelated]);

  useEffect(() => {
    if (summaryRef.current) {
      summaryRef.current.scrollTop = 0;
    }
  }, [selectedArticle]);

  useEffect(() => {
    console.log("🔁 Current visible nodes:", nodes.map(n => n.id));
  }, [nodes]);

  useEffect(() => {
    if (!flatData || Object.keys(nodeMap).length === 0) return;

    const rootNode = flatData.nodes.find(n => n.data?.type === "root");
    if (rootNode) {
      showNodeById(rootNode);  // ✅ Now runs only when everything is ready
    }
  }, [flatData, nodeMap]);

  useEffect(() => {
    if (graphRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
          setTimeout(() => {
            setGraphWidth(entry.contentRect.width);
          }, 20); // allow layout to stabilize
        }
      });
      resizeObserver.observe(graphRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    if (graphRef.current) {
      const rect = graphRef.current.getBoundingClientRect();
      console.log("✅ graphRef bounding box:", rect);
      setGraphWidth(rect.width);
    }
  }, []);



function styleSummary() {
  if (!selectedArticle?.data) return null;
  const rawSummary = selectedArticle.data.summary || "";
  const url = selectedArticle.data.url || "";
  const label = selectedArticle.data.label || "";

  // 1. Remove disallowed tags but keep basic formatting
  let cleanedSummary = rawSummary
    // remove layout/style tags but keep b/i/strong/em/a
    .replace(/<\/?(h\d|p|div|section|header|article|span|style|script)[^>]*>/gi, "")
    // normalize breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\n{3,}/g, "\n\n");

  // 2. Auto-indent list-style lines
  cleanedSummary = cleanedSummary
    .split("\n")
    .map((line) =>
      /^\s*(Person [A-Z]:|[-*•])/.test(line) ? "  " + line : line
    )
    .join("\n");

  // 3. Replace newlines with <br />
  const summaryWithLineBreaks = cleanedSummary.replace(/\n/g, "<br />");

  // 4. Add thumbnail styling for <img> tags
  const finalSummary = summaryWithLineBreaks.replace(
    /<img[^>]*src="([^"]+)"[^>]*>/gi,
    '<img src="$1" style="display: block; max-width: 120px; max-height: 80px; width: auto; height: auto; margin: 0 auto 10px;" />'
  );

  return (
    <div
      style={{
        padding: "1rem",
        fontSize: "12px",
        lineHeight: "1.3em",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ marginBottom: "0.5rem" }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          style={{
            fontWeight: "bold",
            fontSize: "12px",
            textDecoration: "none",
            color: "#0066cc",
          }}
        >
          {label}
        </a>
      </div>

      <div
        style={{
          whiteSpace: "normal",
          wordBreak: "break-word",
          lineHeight: "1.3em",
        }}
        dangerouslySetInnerHTML={{ __html: finalSummary }}
      ></div>
    </div>
  );
}


function controlsAndMoreInfo() {
  if (selectedArticle?.data?.type === "article") {
    return styleSummary();  
  }

  if (!selectedArticle || selectedArticle.data?.type === "root" || selectedArticle.data?.type === "theme" || selectedArticle.data?.type === "category") {
    return (
          <div style={{ fontSize: "12px", lineHeight: "1.35", color: "#333", padding: ".5rem" }}>

            <p>
              Click <strong>Articles</strong> to start, then a <strong>Theme</strong> to explore its <strong>Categories</strong>, and the <strong>Articles</strong> under a Category. 
            </p>
            <p>
              There are controls above to filter articles by a <strong>keyword</strong> or <strong>date range</strong>. A keyword filter will select any article with that word in its title or summary.
            </p>
            <p>
              When you select an article its <strong>summary</strong> is displayed.
            </p>
            <p>
              When an article is selected it will optionally (checkbox above) show <strong>related articles</strong> (with dotted line connections). These related articles (perhaps not in the same Theme or Category) are flagged as addressing simiar topics by a <strong>semantic search</strong>.
            </p>
          </div>
        );
      
  }



  return null;
}

function getFilteredArticles(categoryId) {
  const lowerFilter = filterText.trim().toLowerCase();
  const now = new Date();
  if (!flatData?.nodes) return;
  let matchingArticles = flatData.nodes.filter(n =>
    n.data?.type === "article" &&
    (categoryId ? n.data.category_id === categoryId : true)
  );

  // Apply published date filter
  if (publishedFilter) {
    matchingArticles = matchingArticles.filter((n) => {
      const rawDate = n.data.published_date?.slice(0, 10);  // "YYYY-MM-DD"
      if (!rawDate) return false;

      const articleDate = new Date(rawDate);

      if (publishedFilter === "recent") {
        return articleDate >= new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      }

      if (publishedFilter === "week") {
        return articleDate >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      if (publishedFilter === "month") {
        return articleDate >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      if (publishedFilter === "older") {
        return !availableDates.includes(rawDate);
      }

      // fallback: exact match
      return rawDate === publishedFilter;
    });
  }

  // Apply text filter (title or tags)
  if (lowerFilter) {
    matchingArticles = matchingArticles.filter((n) => {
      const title = n.data.label?.toLowerCase() || "";
      const semantic_tags = (n.data.semantic_tags || []).map((t) => t.toLowerCase()).join(" ");
      return title.includes(lowerFilter) || semantic_tags.includes(lowerFilter);
    });
  }
  return matchingArticles
    .sort((a, b) => (b.data?.confidence || 0) - (a.data?.confidence || 0));
}


function applyArticleCountsToNodes(nodes) {

  return nodes.map((n) => {
    const baseData = n.data || {};
    const type = baseData.type;

    if (type === "category") {
      const count = getFilteredArticles(n.id).length;
      return {
        ...n,
        data: {
          ...baseData,
          articleCount: count,
          clickable: true,
        },
      };
    } else if (type === "theme") {
      const relatedCategories = flatData.nodes.filter(
        (c) => c.data?.type === "category" && c.data.theme === n.id
      );
      const totalCount = relatedCategories.reduce((sum, cat) => {
        return sum + getFilteredArticles(cat.id).length;
      }, 0);

      return {
        ...n,
        data: {
          ...baseData,
          articleCount: totalCount,
          clickable: true,
        },
      };
    }

    // Ensure related flag is preserved for all other types
    return {
      ...n,
      data: {
        ...baseData,
        related: baseData.related || false,
        clickable: true,
      },
    };
  });
}





function showNodeById(node) {
  if (!node || !node.data) {
    console.warn("❌ showNodeById called with invalid node:", node);
    return;
  }

  if (!node) return;

  let revealNodes = [];
  let relatedEdges = [];
  let visibleNodeIds = new Set();

  // --- Root clicked ---
  if (node.data?.type === "root") {
    const themes = flatData.nodes.filter(n => n.data?.type === "theme");
    const { parent, children } = layoutParentWithChildren(node, themes, {}, graphWidth);
    revealNodes = [parent, ...children];
    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedArticle(null);
  }

  // --- Theme clicked ---
  else if (node.data?.type === "theme") {
    const categories = flatData.nodes.filter(
      n => n.data?.type === "category" && n.data.theme === node.data.label
    );

    const { parent, children } = layoutParentWithChildren(node, categories, {}, graphWidth);

    // Create synthetic Root node above the Theme
    const rootNode = {
      id: "root",
      data: { label: "Articles", type: "root", clickable: true, },
      type: "custom",
      position: {
        x: parent.position.x,
        y: parent.position.y - 75,
      },
      hidden: false,
    };

    revealNodes = [rootNode, parent, ...children];
    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedArticle(null);
  }


  // --- Category clicked ---


  else if (node.data?.type === "category") {
    const MAX_ARTICLES = 9;
    const lowerFilter = filterText.trim().toLowerCase();

    const articles = flatData.nodes
      .filter(n => {
        if (n.data?.type !== "article") return false;
        if (n.data.category_id !== node.id) return false;
        if (!lowerFilter) return true;

        const title = n.data.label?.toLowerCase() || "";
        const summary = n.data.summary?.toLowerCase() || "";
        return title.includes(lowerFilter) || summary.includes(lowerFilter);
      })
      .slice(0, MAX_ARTICLES);

    const { parent, children } = layoutParentWithChildren(node, articles, {}, graphWidth);

    // 🔼 Add the Theme above the Category
    const themeId = node.data.theme;
    const themeNode = flatData.nodes.find(n => n.id === themeId);

    const topThemeNode = themeNode
      ? {
          ...themeNode,
          position: {
            x: parent.position.x,
            y: parent.position.y - 75,
          },
          hidden: false,
          type: "custom",
        }
      : null;

    revealNodes = topThemeNode ? [topThemeNode, parent, ...children] : [parent, ...children];
    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedNode(node);
    setSelectedArticle(null);
  }




  // --- Article clicked ---



  else if (node.data?.type === "article") {
    const sidebarWidth = window.innerWidth * 0.18;
    const graphWidth = window.innerWidth - sidebarWidth;
    const fallbackPosition = {
      x: graphWidth / 2,
      y: window.innerHeight / 2,
    };

    const parentOfNode = flatData.nodes.find(n => n.id === node.data.category_id);
    const articleNode = {
      ...node,
      position: fallbackPosition,
      hidden: false,
      type: "custom",
    };

    // Use shared layout function to place category (parent) above article
    const parentLayout = parentOfNode
      ? layoutParentWithChildren(
          parentOfNode,
          [articleNode],
          { spacingY: 100, initialYOffset: 40 },
          graphWidth
        )
      : { parent: null, children: [articleNode] };

    revealNodes = [
      ...(parentLayout.parent ? [parentLayout.parent] : []),
      ...parentLayout.children
    ];

    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedArticle(node);

    const candidateId = node.data?.url || node.id;
    const matchingKey = Object.keys(relatedData || {}).find(key => key === candidateId);

    if (showRelated && matchingKey && relatedData[matchingKey]) {
      const relatedArticles = relatedData[matchingKey]
        .map(({ id: relatedId }) => {
          const relatedNode = flatData.nodes.find(n => n.id === relatedId);
          if (!relatedNode) {
            console.warn("⚠️ Could not find related node with ID:", relatedId);
            return null;
          }
          return {
            ...relatedNode,
            data: {
              ...relatedNode.data,
              related: true,
              type: "article",
              clickable: true,
            }
          };
        })
        .filter(Boolean);

      // Layout related nodes under the positioned article node
      const articleY = parentLayout.children[0]?.position?.y || fallbackPosition.y;
      const {
        parent: centeredArticleNode,
        children: laidOutRelated
      } = layoutParentWithChildren(
        articleNode,
        relatedArticles,
        {
          spacingY: 100,
          rowThreshold: 4,
          initialYOffset: articleY,  // layout function handles spacing
        },
        graphWidth
      );

      // Replace original articleNode with centered version
      revealNodes = revealNodes.map(n =>
        n.id === articleNode.id ? centeredArticleNode : n
      );
      revealNodes.push(...laidOutRelated);


      relatedEdges = relatedArticles.map(r => ({
        id: `edge-${node.id}->${r.id}`,
        source: node.id,
        target: r.id,
        type: "default",
        style: { strokeDasharray: "4 2", stroke: "#ddd", strokeWidth: 1 },
      }));

      relatedArticles.forEach(r => visibleNodeIds.add(r.id));
    }
  }

  const relatedNodeIds = new Set(
    revealNodes.filter(n => n.data?.related).map(n => n.id)
    );  
  // --- Static edges between visible nodes ---
  const staticEdges = flatData.edges
    .filter(
      e =>
        visibleNodeIds.has(e.source) &&
        visibleNodeIds.has(e.target) &&
        !relatedNodeIds.has(e.target) // ✅ skip edges into related articles
    )
    .map(e => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: "default",
      style: {
        stroke: "#ddd",      // change this to adjust line color
        strokeWidth: 1     // increase/decrease thickness
      }
    }));


  const allEdges = staticEdges.concat(
    node.data?.type === "article" && showRelated ? relatedEdges : []
  );

  console.log("🔍 revealNodes before styling:", revealNodes.map(n => n.id));

  const newNodes = applyArticleCountsToNodes(revealNodes).map(n => ({
    ...n,
    type: "custom",
  }));

  // Optional: debug duplicate nodes
  const seen = new Set();
  const dups = newNodes.filter(n => {
    if (seen.has(n.id)) return true;
    seen.add(n.id);
    return false;
  });
  if (dups.length > 0) {
    console.warn("⚠️ Duplicate IDs in newNodes:", dups.map(d => n.id));
  }

  setNodes(newNodes);
  setEdges(allEdges);

  setTimeout(() => {
    fitView({ padding: 100 });
  }, 0);
}

console.log("Rendering ReactFlow with", nodes.length, "nodes");

return (
  <ReactFlowProvider>
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <div style={{ flex: "4", display: "flex", flexDirection: "column", height: "100%" }}>
        <div
          style={{
            flex: 1,
            position: "relative",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div ref={graphRef} style={{ width: "100%", height: "100%" }}>


              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}

                onNodeClick={(_, clickedNode) => {
                  const fullNode = nodeMap[clickedNode.id];
                  if (fullNode) {
                    setLastSelectedNodeId(fullNode.id);
                    showNodeById(fullNode);
                  } else {
                    console.warn("⚠️ Could not find node in nodeMap for", clickedNode.id);
                  }
                }}

                maxZoom={1.2}
                style={{ width: "100%", height: "100%" }}
                >
                  <Controls />
                </ReactFlow>


          </div>
        </div>

        <div
          style={{
            height: "20px",
            backgroundColor: "#f0f0f0",
            borderTop: "1px solid #ccc",
            padding: "2px 10px",
            fontSize: "12px",
            color: "#555",
          }}
        >
          {/* Breadcrumbs will go here */}
        </div>
      </div>

      <div
        style={{
          width: "18vw",
          minWidth: "150px",
          maxWidth: "300px",
          borderLeft: "1px solid #ccc",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#fafafa",
          height: "100%",
        }}
      >
        <div style={{ flex: 1, borderBottom: "1px solid #ddd", padding: "1rem" }}>
          <div style={{ marginTop: "0.5rem", fontSize: "12px" }}>
            <label htmlFor="articleFilter">Keyword search</label>
            <input
              id="articleFilter"
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Enter text..."
              style={{
                width: "100%",
                marginTop: "4px",
                fontSize: "12px",
                padding: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginTop: "1rem", fontSize: "12px" }}>
            <label htmlFor="publishedFilter">Date range</label>
            <select
              id="publishedFilter"
              value={publishedFilter}
              onChange={(e) => setPublishedFilter(e.target.value)}
              style={{
                width: "100%",
                marginTop: "4px",
                fontSize: "12px",
                padding: "4px",
                boxSizing: "border-box",
              }}
            >
              <option value="">All Dates</option>
              <option value="recent">Recent</option>
              <option value="week">In Last Week</option>
              <option value="month">In Last Month</option>
            </select>
          </div>

          <div style={{ marginTop: "1rem", marginBottom: "0rem", fontSize: "12px" }}>
            <label>
              <input
                type="checkbox"
                checked={showRelated}
                onChange={(e) => setShowRelated(e.target.checked)}
              />{" "}
              Show related articles
            </label>
          </div>

          <hr
            style={{ marginTop: "1rem", marginBottom: "0rem", borderColor: "#ccc" }}
          />
        </div>

        <div
          ref={summaryRef}
          style={{
            flex: 2,
            padding: "0rem",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          <div style={{ marginTop: 0 }}>
            {controlsAndMoreInfo()}
          </div>
        </div>
      </div>
    </div>
  </ReactFlowProvider>
);


}

