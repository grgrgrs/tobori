import React, { useEffect, useState, useRef } from "react";


import ReactFlow, {
  MiniMap,
  Controls,
  useReactFlow,
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";

//import flatData from "/flat_graph_data.json";
import { Handle, Position } from "reactflow";

import { getTagFrequencies } from './utils/getTagFrequencies';
//import TagCloud from './components/TagCloudClient';
import { getRelatedArticles } from "./dataService";

import { loadGraphData, loadRelatedData } from './dataService';




// --- arrangeChildren: Lay out child nodes centered under a parent node ---
function arrangeChildren(parentNode, children, overrideStartX) {
  if (!parentNode || children.length === 0) return [];

  const baseX = overrideStartX !== undefined ? overrideStartX : parentNode.position?.x || 0;
  const baseY = parentNode.position?.y || 0;
  const spacingX = 240;
  const spacingY = 150;
  const rowThreshold = 5;

  const result = [];
  const numRows = children.length >= rowThreshold ? 2 : 1;
  const rows = Array.from({ length: numRows }, () => []);



  children.forEach((child, i) => {
    rows[i % numRows].push(child);
  });

  rows.forEach((rowNodes, rowIndex) => {
    const totalWidth = (rowNodes.length - 1) * spacingX;
    //const startX = baseX - totalWidth / 2;
    const startX = baseX

    rowNodes.forEach((child, colIndex) => {
      let x = startX + colIndex * spacingX;
      let y = baseY + spacingY * (rowIndex + 1);
      if (numRows > 1 && rowIndex % 2 === 1) {
        y += spacingY / 2;
        x += spacingX / 2;
      }

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

// --- CustomNode Component ---
const CustomNode = ({ data }) => {
  const type = data.type;
  const articleCount = data.articleCount ?? null;

  const isDimmed = (type === "category" || type === "theme") && articleCount === 0;

  // Font weight logic: heavier for more articles
  const fontWeight =
    type === "article"
      ? 500
      : articleCount === 0
      ? 100
      : articleCount < 4
      ? 300
      : articleCount < 9
      ? 400
      : 540;
  const fontColor = isDimmed ? "#bbb" : "#222";
  const isRelated = data.related;
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          padding: "6px 10px",
          border: data.selected ? "1px solid #999" : "none",
          borderRadius: "4px",
          background: "transparent",
          maxWidth: "220px",
          textAlign: "center",
          wordWrap: "break-word",
          fontSize: type === "article"
            ? data.related ? "12px" : "15px"
            : "16px",

          fontWeight,
          lineHeight: "1.2em",
          position: "relative",
          color: fontColor,
        }}
        title={
          articleCount !== null && type !== "article"
            ? `${articleCount} article${articleCount === 1 ? "" : "s"}`
            : undefined
        }
      >
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
};



function layoutParentWithChildren(parentNode, children, options = {}) {
  const {
    spacingX = 240,
    spacingY = 150,
    rowThreshold = 5,
    initialYOffset = 0
  } = options;

  const numRows = children.length >= rowThreshold ? 2 : 1;
  const numCols = Math.ceil(children.length / numRows);
  const totalBlockWidth = (numCols - 1) * spacingX;

  const centerX = window.innerWidth / 2;
  const startX = centerX - totalBlockWidth / 2;


  // Position the parent node centered above the block
  const parent = {
    ...parentNode,
    hidden: false,
    type: "custom",
    position: { x: centerX, y: initialYOffset },
  };

  const laidOutChildren = arrangeChildren(parent, children.map(c => ({ ...c })), startX, spacingX, spacingY, numRows);

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
    parentId = "ROOT";
  } else {
    return null;
  }

  return allNodes.find(n => n.id === parentId) || null;
}


// --- Main Inner Component that uses ReactFlow context ---
function GraphCanvas() {
  const [flatData, setFlatData] = useState(null); // ✅ CORRECT LOCATION
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodeMap, setNodeMap] = useState({});
  const [selectedArticle, setSelectedArticle] = useState(null);
  const { fitView } = useReactFlow();

  const [categoryArticleCount, setCategoryArticleCount] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [lastSelectedNodeId, setLastSelectedNodeId] = useState(null);
  //const [tagCloudData, setTagCloudData] = useState([]);
  const [publishedFilter, setPublishedFilter] = useState("");
  const [availableDates, setAvailableDates] = useState([]);
  const [showRelated, setShowRelated] = useState(true);
  const summaryRef = useRef(null);


  useEffect(() => {
    loadGraphData()
      .then(setFlatData)
      .catch(console.error);

    loadRelatedData()
      .catch(console.error);
  }, []);



  useEffect(() => {
    if (!flatData) return;

    const map = Object.fromEntries(flatData.nodes.map((n) => [n.id, n]));
    setNodeMap(map);
    const root = map["ROOT"];
    setNodes([{ ...root, hidden: false, type: "custom" }]);
    setEdges([]);
  }, [flatData]);  // ✅ listen for flatData updates


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
    console.log("allDates: ", allDates)
    const sortedDates = allDates.sort((a, b) => new Date(b) - new Date(a));
    const topDates = sortedDates.slice(0, 7); // latest 7
    setAvailableDates(topDates);
    console.log(topDates)
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

  if (!selectedArticle || selectedArticle.data?.type === "ROOT" || selectedArticle.data?.type === "theme" || selectedArticle.data?.type === "category") {
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
  console.log("In getFilteredArticles -----------------------------")
  const lowerFilter = filterText.trim().toLowerCase();
  const now = new Date();
  if (!flatData?.nodes) return;
  console.log("Applying filter -------------")
  let matchingArticles = flatData.nodes.filter(n =>
    n.data?.type === "article" &&
    (categoryId ? n.data.category_id === categoryId : true)
  );

  // Apply published date filter
  if (publishedFilter) {
    console.log("Applying date filter ----------------------------")
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
  console.log("Returning matching articles")
  return matchingArticles
    .sort((a, b) => (b.data?.confidence || 0) - (a.data?.confidence || 0));
}


function applyArticleCountsToNodes(nodes) {
  return nodes.map((n) => {
    if (n.data?.type === "category") {
      const count = getFilteredArticles(n.id).length;
      return {
        ...n,
        data: {
          ...n.data,
          articleCount: count,
        },
      };
    } else if (n.data?.type === "theme") {
      const relatedCategories = flatData.nodes.filter(
        (c) => c.data?.type === "category" && c.data.theme === n.id
      );

      const totalCount = relatedCategories.reduce((sum, cat) => {
        return sum + getFilteredArticles(cat.id).length;
      }, 0);

      return {
        ...n,
        data: {
          ...n.data,
          articleCount: totalCount,
        },
      };
    }

    return n;
  });
}


const showNodeById = (nodeId) => {
  const node = nodeMap[nodeId];
  setLastSelectedNodeId(nodeId);
  // Always clear selectedArticle unless it's being explicitly set later
  setSelectedArticle(null);

  if (!node || !node.data) return;

  let revealNodes = [];
  let visibleNodeIds = new Set();
  const rowThreshold = 5;
  const spacingX = 240;
  const spacingY = 150;
  const initialYOffset = 0;
  let positionedRelated = [];
  let relatedEdges = [];

  // --- ROOT clicked ---
  console.log("---checking node data type");
  if (node.id === "ROOT") {
    console.log("Clicked root node:", node.id, "----------------------");
    // Also clear any related edges
    setEdges(prev => prev.filter(e => !e.id.startsWith("edge-")));
    setNodes(prev => prev.filter(n => !n.data?.related));

    if (!flatData) {
      return <div>Loading...</div>;
    }
    const themes = flatData.nodes.filter(n => n.data?.type === "theme");

    const { parent, children } = layoutParentWithChildren(node, themes, {
      spacingX,
      spacingY,
      rowThreshold,
      initialYOffset
    });

    revealNodes = [parent, ...children];
    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedArticle(null);
  }


  // --- THEME clicked ---
  else if (node.data?.type === "theme") {
    console.log("Clicked theme:", node.id, "----------------------");
    // Also clear any related edges
    setEdges(prev => prev.filter(e => !e.id.startsWith("edge-")));
    setNodes(prev => prev.filter(n => !n.data?.related));

    const categories = flatData.nodes.filter(
      n => n.data?.type === "category" && n.data.theme === node.id
    );

    const { parent, children } = layoutParentWithChildren(node, categories, {
      spacingX,
      spacingY,
      rowThreshold,
      initialYOffset
    });

    let positionedParent = null;
    const parentOfNode = getParentNode(node, flatData.nodes);
    if (parentOfNode) {
      positionedParent = {
        ...parentOfNode,
        hidden: false,
        type: "custom",
        position: {
          x: parent.position.x,
          y: parent.position.y - spacingY  // move one level up
        }
      };
    }
    revealNodes = positionedParent ? [positionedParent, parent, ...children] : [parent, ...children];
    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedArticle(node);
  }

  // --- CATEGORY clicked ---
  else if (node.data?.type === "category") {
    console.log("Clicked category:", node.id, "-------------------------");
    // Also clear any related edges
    setEdges(prev => prev.filter(e => !e.id.startsWith("edge-")));
    setNodes(prev => prev.filter(n => !n.data?.related));

    const MAX_ARTICLES = 9;

    const matchingArticles = getFilteredArticles (node.id)

    const articles = matchingArticles
      .sort((a, b) => (b.data?.confidence || 0) - (a.data?.confidence || 0))
      .slice(0, MAX_ARTICLES);

    const { parent, children } = layoutParentWithChildren(node, articles, {
      spacingX,
      spacingY,
      rowThreshold,
      initialYOffset
    });

    let positionedParent = null;
    const parentOfNode = getParentNode(node, flatData.nodes);
    if (parentOfNode) {
      positionedParent = {
        ...parentOfNode,
        hidden: false,
        type: "custom",
        position: {
          x: parent.position.x,
          y: parent.position.y - spacingY  // move one level up
        }
      };
    }

    revealNodes = positionedParent ? [positionedParent, parent, ...children] : [parent, ...children];
    visibleNodeIds = new Set(revealNodes.map(n => n.id));
    setSelectedArticle(node);
  }



  // --- ARTICLE clicked ---
  else if (node.data?.type === "article") {
  console.log("Clicked article:", node.id, "-------------------------");

  let positionedParent = null;
  const parentOfNode = getParentNode(node, flatData.nodes); // should be the category

  if (parentOfNode) {
    positionedParent = {
      ...parentOfNode,
      hidden: false,
      type: "custom",
      position: {
        x: node.position.x,
        y: node.position.y - spacingY  // move one level up
      }
    };
  }

  // Base article display
  revealNodes = positionedParent ? [positionedParent, node] : [node];
  visibleNodeIds = new Set(revealNodes.map(n => n.id));


  if (showRelated) {
    // --- Related Articles ---
    console.log("Article clicked:", node.id, typeof node.id);
    console.log("SHOW NODE: id =", node.id, "type =", typeof node.id);

    const relatedObjects = getRelatedArticles(node.id);
    console.log("relatedObjects raw:", relatedObjects);

    const relatedCandidates = relatedObjects
      .map(obj => typeof obj === "string" ? obj : obj.id)  // handles both formats
      .map(id => nodeMap[id])
      .filter(Boolean);

    console.log("relatedCandidates: ", relatedCandidates)
    const filtered = getFilteredArticles();  // All filtered articles
    const filteredIds = new Set(filtered.map(a => a.id));

    const visibleRelated = relatedCandidates.filter(n => filteredIds.has(n.id)).slice(0, 8);
    console.log("visibleRelated: ", visibleRelated)

    const baseX = (node.position?.x)|| 0;
    const baseY = (node.position?.y+100) || 0;
    const spacingY2 = 80;

    positionedRelated = visibleRelated.map((n, idx) => ({
      ...n,
      id: n.id,  // Use original article ID
      type: "custom",
      position: {
        x: baseX + (idx < 4 ? -200 : 200),
        //y: baseY + (idx % 4 - 1.5) * spacingY2,
        y: baseY + (idx % 4) * spacingY2,
      },
      data: { ...n.data, related: true }
    }));

    relatedEdges = positionedRelated.map(relatedNode => ({
      id: `edge-${node.id}-${relatedNode.id}`,
      source: node.id,
      target: relatedNode.id,
      //type: "default",
      style: { strokeDasharray: "4 2", stroke: "#888" }
      })
      );

    revealNodes = [...revealNodes, ...positionedRelated];
    positionedRelated.forEach(n => visibleNodeIds.add(n.id));
    }
  console.log("Final positionedRelated:", positionedRelated);
  console.log("relatedEdges (final)", relatedEdges);

  setSelectedArticle(node);
}



if (node.data?.type === "category") {
  // Use filtered articles for this specific category
  const matchingArticles = getFilteredArticles(node.id);
  //const tagFrequencies = getTagFrequencies(matchingArticles);
  //setTagCloudData(tagFrequencies);
}

else if (node.data?.type === "theme") {
  // Find all category nodes under this theme
  const relatedCategories = flatData.nodes.filter(
    (n) => n.data?.type === "category" && n.data.theme === node.id
  );

  // Combine filtered articles from all categories in the theme
  const matchingArticles = relatedCategories.flatMap((cat) =>
    getFilteredArticles(cat.id)
  );
  
  console.log("-------- FIRST CALL TO getTagFrequencies)--------------")
  //const tagFrequencies = getTagFrequencies(matchingArticles);
  //setTagCloudData(tagFrequencies);
}




  const relatedNodeIds = new Set(
    revealNodes.filter(n => n.data?.related).map(n => n.id)
  );

  const staticEdges = flatData.edges
    .filter(e =>
      visibleNodeIds.has(e.source) &&
      visibleNodeIds.has(e.target) &&
      !relatedNodeIds.has(e.target)  // ❌ block edges into related nodes
    )
    .map(e => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: "default",
    }));

  console.log("Is article node?", node.data?.type === "article");
  console.log("relatedEdges length:", relatedEdges.length);

  const allEdges = staticEdges.concat(
    node.data?.type === "article" ? relatedEdges : []
  );

  const newNodes = applyArticleCountsToNodes(revealNodes).map(n => ({
    ...n,
    type: "custom",
  }));



  setNodes(newNodes);
  console.log("Edges to set:", allEdges);
  console.log("Node IDs in graph:", newNodes.map(n => n.id));
  console.log("allEdges", allEdges.map(e => [e.id, e.source, e.target]));

  setEdges(allEdges);
  setTimeout(() => fitView({ padding: 0.2 }), 0);
};

return (
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
        <div style={{ width: "100%", height: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={{ custom: CustomNode }}
            onNodeClick={(_, node) => {
              const realId = node.id;
              showNodeById(realId);

              if (node.type === 'theme' || node.type === 'category') {
                const matchingArticles = flatData.nodes.filter(
                  n => n.type === 'article' && (
                    (node.type === 'theme' && n.data.theme === node.data.label) ||
                    (node.type === 'category' && n.data.category === node.data.label)
                  )
                );
                //const tagFrequencies = getTagFrequencies(matchingArticles);
                //setTagCloudData(tagFrequencies);
              }
            }}
            fitView
            maxZoom={1.2} 
            style={{ width: "100%", height: "100%" }}
          >
            {/*<MiniMap />*/}
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
);

}


// --- Outer App Component with Provider ---
export default function GraphApp() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}